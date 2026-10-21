import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get, query, run } from "@clawnify/db";
import { clientIp, currentAccount, requireConfirmation, setMaintenance } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { publishMaintenance } from "../realtime.ts";
import { getSetting, validateDriveRemote } from "../settings.ts";
import { decryptBackup, prepareRestore, runBackup, writeRestoreNote } from "./backup.ts";
import { RCLONE_OPTS, type Exec } from "./drive.ts";
import { localize, MessageError, msg } from "../messages.ts";
import { estFormation } from "../formation/mode.ts";
import { refusFormation } from "../formation/coupures.ts";

export interface BackupEnv { usbDir: string; tmpDir: string; dataDir: string; recipient: string; exec: Exec; requestRestart: () => void }
const ALERT_AFTER_MS = 36 * 3600e3;
const NAME = /^lama-\d{8}-\d{4}\.db\.gz\.age$/;

let sauvegardesManuelles = 0;
/** Vrai pendant « Sauvegarder maintenant » (la sauvegarde de nuit se lit dans systemd, mise-a-jour/systeme.ts). */
export function sauvegardeManuelleEnCours(): boolean {
  return sauvegardesManuelles > 0;
}

function env(c: Context): BackupEnv {
  const b = (c.env as { BACKUP?: BackupEnv }).BACKUP;
  if (!b) throw new MessageError("sauvegarde.non_configurees");
  return b;
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse() : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountBackupRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/backups/status", async (c) => {
    // L'alerte est calculée par destination : une copie hors site (Drive) en
    // échec depuis 36 h doit alerter même si le disque USB réussit chaque nuit.
    // Google Drive n'est surveillé qu'une fois sa destination réglée par
    // l'administrateur : sinon le bandeau resterait allumé en permanence.
    const driveConfigured = (await get("SELECT key FROM settings WHERE key = 'technique.drive_remote'")) != null;
    // Base installée depuis moins de 36 h (premier compte créé) : rien n'a encore pu être sauvegardé, aucune alerte.
    const installee = await get<{ at: number | null }>("SELECT MIN(created_at) AS at FROM accounts");
    const neuve = installee?.at == null || nowOf(c) - installee.at < ALERT_AFTER_MS;
    const destinations: Record<string, { last_ok_at: number | null; alert: boolean; configured: boolean }> = {};
    for (const destination of ["usb", "drive"]) {
      const configured = destination === "usb" || driveConfigured;
      const last = await get<{ at: number | null }>("SELECT MAX(at) AS at FROM backups WHERE status = 'ok' AND destination = ?", [destination]);
      const lastOk = last?.at ?? null;
      destinations[destination] = { last_ok_at: lastOk, alert: !estFormation() && !neuve && configured && (lastOk === null || nowOf(c) - lastOk > ALERT_AFTER_MS), configured };
    }
    const okTimes = Object.values(destinations).filter((d) => d.configured).map((d) => d.last_ok_at).filter((at): at is number => at !== null);
    return c.json({
      last_ok_at: okTimes.length ? Math.max(...okTimes) : null,
      // Base de formation (D-17) : aucune sauvegarde, donc jamais d'alerte, ni globale ni par destination.
      alert: Object.values(destinations).some((d) => d.alert),
      destinations,
    });
  });

  app.get("/api/backups", async (c) => {
    const b = env(c);
    const history = await query<{ message: string }>("SELECT at, destination, status, file, message FROM backups ORDER BY at DESC, id DESC LIMIT 30");
    return c.json({
      history: history.map((h) => ({ ...h, message: localize(c, h.message) })),
      files: { quotidiennes: listDir(join(b.usbDir, "quotidiennes")), mensuelles: listDir(join(b.usbDir, "mensuelles")) },
    });
  });

  app.post("/api/backups/run", async (c) => {
    // Second verrou (D-17), indépendant de la liste des coupures : aucune sauvegarde en formation.
    const formation = refusFormation(c);
    if (formation) return formation;
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const b = env(c);
    // Le remote n'est pas revalidé ici : une valeur invalide ne doit pas
    // empêcher la copie USB. L'envoi Drive le revalide (drive.ts) et, s'il est
    // invalide, l'échec Drive est enregistré dans l'historique.
    // Même règle que la sauvegarde de nuit (décision 15) : sans destination réglée, pas d'envoi Drive.
    const driveConfigured = (await get("SELECT key FROM settings WHERE key = 'technique.drive_remote'")) != null;
    const remote = driveConfigured ? await getSetting<string>("technique.drive_remote") : null;
    sauvegardesManuelles++;
    let result: Awaited<ReturnType<typeof runBackup>>;
    try {
      result = await runBackup({
        run: (sql, params) => run(sql, params), recipient: b.recipient, usbDir: b.usbDir, tmpDir: b.tmpDir,
        remote, now: nowOf(c),
      });
    } finally {
      sauvegardesManuelles--;
    }
    await logAudit({ accountId: currentAccount(c).id, action: "sauvegarde", ip: clientIp(c), now: nowOf(c) });
    return c.json(result);
  });

  app.post("/api/backups/restore", async (c) => {
    // Second verrou (D-17) : jamais de restauration (rclone, vraie sauvegarde) en formation.
    const formation = refusFormation(c);
    if (formation) return formation;
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const b = env(c);
    const body = (await c.req.json().catch(() => ({}))) as { source?: string; name?: string; identity?: string };
    const name = String(body.name ?? "");
    if (!NAME.test(name)) return c.json({ error: msg(c, "sauvegarde.nom_invalide") }, 400);
    if (body.source !== "usb" && body.source !== "drive") {
      return c.json({ error: msg(c, "sauvegarde.source_invalide") }, 400);
    }
    let data: Uint8Array;
    if (body.source === "drive") {
      const remote = await getSetting<string>("technique.drive_remote");
      const problem = validateDriveRemote(remote);
      if (problem) return c.json({ error: msg(c, "sauvegarde.drive_invalide", { detail: localize(c, problem) }) }, 400);
      const target = join(b.tmpDir, `telechargement-${name}`);
      try {
        // Essaie d'abord les quotidiennes, puis les mensuelles : le nom seul
        // ne dit pas de quel dossier `rclone` vient la sauvegarde demandée.
        let got = await b.exec("rclone", ["copyto", ...RCLONE_OPTS, "--", `${remote}/quotidiennes/${name}`, target]);
        if (got.code !== 0) got = await b.exec("rclone", ["copyto", ...RCLONE_OPTS, "--", `${remote}/mensuelles/${name}`, target]);
        if (got.code !== 0) return c.json({ error: msg(c, "sauvegarde.telechargement", { detail: got.stderr.trim() }) }, 502);
        data = readFileSync(target);
      } finally {
        // Le fichier téléchargé est temporaire : il ne doit pas rester, que le
        // téléchargement ait réussi ou échoué.
        rmSync(target, { force: true });
      }
    } else {
      const file = [join(b.usbDir, "quotidiennes", name), join(b.usbDir, "mensuelles", name)].find(existsSync);
      if (!file) return c.json({ error: msg(c, "sauvegarde.introuvable_disque") }, 404);
      data = readFileSync(file);
    }
    // La clé privée reçue ici (`body.identity`) ne doit jamais être journalisée,
    // stockée ni renvoyée : elle ne sert qu'à cet appel de `decryptBackup`.
    try {
      prepareRestore(await decryptBackup(data, String(body.identity ?? "")), b.dataDir);
    } catch (error) {
      return c.json({ error: localize(c, (error as Error).message) }, 400);
    }
    const actor = currentAccount(c);
    // Inscrite aussi dans la base restaurée au redémarrage (voir writeRestoreNote) ;
    // l'entrée ci-dessous reste dans la base mise de côté.
    writeRestoreNote(b.dataDir, { accountId: actor.id, login: actor.login, name, ip: clientIp(c), at: nowOf(c) });
    await logAudit({ accountId: actor.id, action: "restauration", target: name, ip: clientIp(c), now: nowOf(c) });
    setMaintenance(true);
    // Diffusée avant l'arrêt du serveur : les écrans déjà ouverts (pas
    // seulement celui qui a demandé la restauration) affichent la maintenance
    // sans attendre leur prochaine requête.
    publishMaintenance();
    b.requestRestart();
    return c.json({ ok: true, restart: true });
  });
}
