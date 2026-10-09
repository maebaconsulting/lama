import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { validateDriveRemote } from "../settings.ts";
import { recordBackup } from "./backup.ts";
import { coded } from "../messages.ts";

export type Exec = (cmd: string, args: string[]) => Promise<{ code: number; stderr: string }>;
export interface DrivePayload { file: string; name: string; remote: string; monthly: boolean }

// Options appliquées à chaque appel `rclone`, avant le `--` qui sépare les
// options des arguments positionnels (chemins) : un connecteur qui pend ne
// doit jamais retenir un appel plus de quelques minutes.
export const RCLONE_OPTS = ["--contimeout", "30s", "--timeout", "5m", "--retries", "1"];

// Délai maximal de 10 minutes sur le processus lui-même : une dernière
// bride, au cas où `rclone` ignorerait ses propres options réseau, pour que
// l'essai ne retienne jamais la file d'envoi indéfiniment.
export const execRclone: Exec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: 10 * 60_000 }, (error, _stdout, stderr) => {
    resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stderr: String(stderr) });
  });
});

const NOT_CONFIGURED = /didn't find section in config file|config file .* not found|unauthorized_client|invalid_grant/i;

export function createDriveHandler(d: { exec: Exec; now: () => number }) {
  const rclone = async (...args: string[]) => {
    const result = await d.exec("rclone", args);
    if (result.code === 0) return;
    // `||` et non `??` : une sortie d'erreur vide donne "" (rclone absent), jamais `undefined`.
    const message = result.stderr.trim().split("\n").pop() || coded("drive.rclone_code", { code: result.code });
    if (NOT_CONFIGURED.test(result.stderr)) throw new PermanentError(coded("drive.non_configure", { detail: message }));
    throw new TemporaryError(coded("drive.envoi_impossible", { detail: message }));
  };
  return async (p: DrivePayload): Promise<void> => {
    // Revalidé à l'usage (et non seulement à l'écriture du réglage) : le
    // remote traverse la file d'envoi dans la charge, et pourrait provenir
    // d'une ligne modifiée directement en base.
    const problem = validateDriveRemote(p.remote);
    if (problem) throw new PermanentError(coded("sauvegarde.drive_invalide", { detail: problem }));
    await rclone("copyto", ...RCLONE_OPTS, "--", p.file, `${p.remote}/quotidiennes/${p.name}`);
    if (p.monthly) await rclone("copyto", ...RCLONE_OPTS, "--", p.file, `${p.remote}/mensuelles/${p.name}`);
    await rclone("delete", "--min-age", "15d", ...RCLONE_OPTS, "--", `${p.remote}/quotidiennes`);
    await rclone("delete", "--min-age", "366d", ...RCLONE_OPTS, "--", `${p.remote}/mensuelles`);
    rmSync(p.file, { force: true });
    await recordBackup({ destination: "drive", status: "ok", file: p.name, now: d.now() });
  };
}

/**
 * Envoi Drive abandonné par la file (erreur définitive ou 24 h d'échecs) :
 * l'échec est inscrit dans l'historique des sauvegardes et le fichier chiffré
 * en attente est supprimé, pour ne pas remplir le disque d'une copie par nuit.
 */
export function createDriveGiveUp(d: { now: () => number }) {
  return async (p: DrivePayload, message: string): Promise<void> => {
    if (typeof p?.file === "string" && p.file) rmSync(p.file, { force: true });
    await recordBackup({ destination: "drive", status: "failed", file: String(p?.name ?? ""), message, now: d.now() });
  };
}
