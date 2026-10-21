import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { avecFormation, bundleOf, cliBundle, setupApp } from "../test-support.ts";
import { USB_MARKER } from "../backup/backup.ts";
import { runMigrations } from "../migrations.ts";
import { openDatabase } from "../storage.ts";
import { mountBackupRoutes } from "../backup/routes.ts";
import { coupeeEnFormation } from "./coupures.ts";

/** Coupures imposées par le serveur en formation (distribution D-17) : rien ne part, rien n'est sauvegardé, l'heure du système n'est pas touchée. */

// Chemin relatif à test-support.ts (src/server), comme dans les autres essais.
const { start } = await import(await bundleOf("./boot.ts"));

test("routes coupées : sauvegarde, restauration, heure du système, session et essais WhatsApp ou SMS, envoi à la main ; le reste passe", () => {
  for (const [method, path] of [
    ["POST", "/api/backups/run"], ["POST", "/api/backups/restore"], ["POST", "/api/heure"],
    ["POST", "/api/whatsapp/session/start"], ["POST", "/api/whatsapp/session/logout"], ["GET", "/api/whatsapp/qr"],
    ["POST", "/api/whatsapp/manual/12/open"], ["POST", "/api/sms/test"],
    ["POST", "/api/backups/run/"], ["POST", "/api/whatsapp/manual/1e0/open"], ["POST", "/api/whatsapp/manual/%31/open"],
  ]) assert.equal(coupeeEnFormation(method, path), true, `${method} ${path}`);
  for (const [method, path] of [
    ["GET", "/api/backups/status"], ["GET", "/api/heure"], ["POST", "/api/whatsapp/manual/12"], ["POST", "/api/whatsapp/documents"],
    ["POST", "/api/clients/3/whatsapp"], ["POST", "/api/campaigns"], ["POST", "/api/print/documents"], ["POST", "/api/sales"],
  ]) assert.equal(coupeeEnFormation(method, path), false, `${method} ${path}`);
});

test("WhatsApp Business : test de connexion, message d'essai et vérification des modèles coupés ; la liste des modèles passe", () => {
  for (const path of ["/api/whatsapp/meta/tester", "/api/whatsapp/meta/essai", "/api/whatsapp/meta/modeles/verifier", "/api/whatsapp/meta/essai/"]) {
    assert.equal(coupeeEnFormation("POST", path), true, path);
  }
  assert.equal(coupeeEnFormation("GET", "/api/whatsapp/meta/modeles"), false);
});

test("API en formation : refus 409 lisible, aucun fichier de sauvegarde écrit, horloge jamais appelée ; aucune alerte de sauvegarde", async (t) => {
  await avecFormation(true, async () => {
    const usb = mkdtempSync(join(tmpdir(), "lama-coupures-usb-"));
    t.after(() => rmSync(usb, { recursive: true, force: true }));
    writeFileSync(join(usb, USB_MARKER), "");
    let reglages = 0;
    const HORLOGE = { regler: async () => { reglages++; return { ok: true as const }; } };
    const BACKUP = { usbDir: usb, tmpDir: join(usb, "tmp"), dataDir: usb, recipient: "", exec: async () => ({ code: 0, stdout: "", stderr: "" }), requestRestart: () => undefined };
    const ctx = await setupApp(t, { demo: false, bindings: { HORLOGE, BACKUP } });
    const admin = await ctx.as("admin");
    const reception = await ctx.as("reception");
    await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
    for (const [method, path, body] of [["POST", "/api/backups/run", {}], ["POST", "/api/backups/restore", { source: "usb", name: "lama-20261005-0200.db.gz.age", identity: "x" }], ["POST", "/api/heure", { heure: Date.parse("2026-10-05T10:00:00Z") }], ["POST", "/api/sms/test", { to: "+237677000000" }], ["POST", "/api/whatsapp/session/start", {}]] as const) {
      const r = await admin(method, path, body, { "accept-language": "fr" });
      assert.equal(r.status, 409, path);
      assert.equal(r.body.code, "formation", path);
      assert.match(r.body.error, /^Base de formation\u00a0: rien ne part de cette base/, path);
    }
    // Hono route sur le chemin décodé, pas sur le chemin encodé ni sur `\\d+` : ces variantes atteignaient les routes.
    for (const [method, path, body] of [["POST", "/api/backups/%72un", {}], ["POST", "/api/backups/rest%6Fre", { source: "drive", name: "x.db.gz.age", identity: "x" }], ["POST", "/api/backups/run/", {}]] as const) {
      const r = await admin(method, path, body);
      assert.deepEqual([r.status, r.body.code], [409, "formation"], path);
    }
    for (const path of ["/api/whatsapp/manual/1e0/open", "/api/whatsapp/manual/%31/open"]) {
      const r = await reception("POST", path);
      // Refusé, que ce soit par les permissions (403, qui lisent `\\d+`) ou par la coupure (409) : jamais exécuté.
      assert.ok(r.status === 403 || (r.status === 409 && r.body.code === "formation"), `${path} : ${r.status}`);
    }
    assert.deepEqual(readdirSync(usb), [USB_MARKER], "aucune sauvegarde écrite");
    assert.equal(reglages, 0, "horloge du système jamais appelée");
    const ouvrir = await reception("POST", "/api/whatsapp/manual/1/open");
    assert.deepEqual([ouvrir.status, ouvrir.body.code], [409, "formation"], "la tablette n'ouvre ni WhatsApp ni les SMS");
    // Drive réglé : sans la coupure, il alerterait (jamais sauvegardé), comme l'USB.
    ctx.db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('technique.drive_remote', ?, 0, ?)").run(JSON.stringify("gdrive:lama"), ctx.clock.now);
    const statut = (await admin("GET", "/api/backups/status")).body;
    assert.equal(statut.destinations.drive.configured, true);
    assert.deepEqual([statut.alert, statut.destinations.usb.alert, statut.destinations.drive.alert], [false, false, false], "aucune sauvegarde, aucune alerte, par destination non plus");
  });
});

test("API en formation : WhatsApp et SMS réglés quand même, aucun fournisseur (état « aucun », jamais contacté)", async (t) => {
  await avecFormation(true, async () => {
    const ctx = await setupApp(t, { demo: false });
    const reglage = ctx.db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES (?, ?, 0, 0)");
    reglage.run("whatsapp.fournisseur", JSON.stringify("waha"));
    reglage.run("sms.fournisseur", JSON.stringify("passerelle"));
    reglage.run("sms.adresse", JSON.stringify("http://192.168.1.30:8080"));
    const admin = await ctx.as("admin");
    assert.deepEqual((await admin("GET", "/api/whatsapp/status")).body, { provider: "aucun" });
    assert.deepEqual((await admin("GET", "/api/sms/status")).body, { provider: "aucun" });
  });
});

test("second verrou : les routes de sauvegarde refusent d'elles-mêmes en formation, sans le middleware de coupure", async () => {
  const app = new OpenAPIHono();
  mountBackupRoutes(app);
  await avecFormation(true, async () => {
    for (const path of ["/api/backups/run", "/api/backups/restore"]) {
      const r = await app.request(path, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
      assert.equal(r.status, 409, path);
      assert.equal(((await r.json()) as { code: string }).code, "formation", path);
    }
  });
});

/** Prépare un dossier de données avec un envoi « en cours » et une copie de sécurité en clair si demandée, puis démarre lama. */
async function demarrer(formation: boolean, copie = false) {
  const dir = mkdtempSync(join(tmpdir(), "lama-coupures-file-"));
  mkdirSync(join(dir, "config"));
  writeFileSync(join(dir, "config", "master.key"), randomBytes(32).toString("base64"), { mode: 0o600 });
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.prepare("INSERT INTO outbox (kind, payload, dedupe_key, status, next_attempt_at, created_at) VALUES ('whatsapp', '{}', 'essai', 'sending', 0, ?)").run(Date.now());
  db.close();
  if (copie) {
    writeFileSync(join(dir, "avant-migration-20261005-0100.db"), "copie en clair");
    chmodSync(join(dir, "avant-migration-20261005-0100.db"), 0o644);
  }
  const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb"), tlsDir: null, httpPort: null, formation });
  return { dir, running };
}

async function arreter({ dir, running }: Awaited<ReturnType<typeof demarrer>>) {
  running.stopWorker();
  running.server.close();
  running.db.close();
  rmSync(dir, { recursive: true, force: true });
}

const etat = (running: { db: { prepare: (s: string) => { get: () => unknown } } }) => (running.db.prepare("SELECT status FROM outbox").get() as { status: string } | undefined)?.status ?? "retiré";

test("démarrage : en formation, la file d'envoi ne tourne pas (un envoi « en cours » le reste) ; dans la vraie base, elle reprend", async () => {
  await avecFormation(false, async () => {
    const formation = await demarrer(true);
    try {
      await new Promise((ok) => setTimeout(ok, 300));
      assert.equal(etat(formation.running), "sending", "formation : le travailleur n'est jamais lancé");
    } finally {
      await arreter(formation);
    }
  });
  await avecFormation(false, async () => {
    const vraie = await demarrer(false);
    try {
      // Le travailleur remet l'envoi en attente puis le tente (message vide : échec), mais jamais « en cours » : interrogé jusqu'à 3 s.
      const limite = Date.now() + 3000;
      while (etat(vraie.running) === "sending" && Date.now() < limite) await new Promise((ok) => setTimeout(ok, 50));
      assert.notEqual(etat(vraie.running), "sending", "vraie base : le travailleur reprend l'envoi interrompu");
    } finally {
      await arreter(vraie);
    }
  });
});

test("démarrage en formation : aucune copie de sécurité chiffrée (clé de sauvegarde vide), la copie en clair est seulement protégée", async () => {
  await avecFormation(false, async () => {
    const formation = await demarrer(true, true);
    try {
      assert.equal(formation.running.env.BACKUP.recipient, "");
      assert.ok(readdirSync(formation.dir).includes("avant-migration-20261005-0100.db"), "copie en clair conservée");
      assert.equal(readdirSync(formation.dir).some((f) => f.endsWith(".age")), false, "rien de chiffré");
      assert.equal(statSync(join(formation.dir, "avant-migration-20261005-0100.db")).mode & 0o777, 0o600);
    } finally {
      await arreter(formation);
    }
  });
});

test("cli en formation : la sauvegarde de 2 h n'a aucun effet (code 0), la restauration est refusée", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-coupures-cli-"));
  const env = { ...process.env, LAMA_DEV: "1", LAMA_FORMATION: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_BACKUP_DIR: join(dir, "usb"), LAMA_LANGUE: "fr" };
  const sauvegarde = spawnSync(process.execPath, ["--no-warnings", cliBundle(), "sauvegarder"], { env, encoding: "utf8" });
  assert.equal(sauvegarde.status, 0, sauvegarde.stderr);
  assert.match(sauvegarde.stdout, /^Base de formation\u00a0: aucune sauvegarde ni restauration\.\n$/);
  assert.deepEqual(readdirSync(dir), [], "ni base ouverte ni disque touché");
  const restauration = spawnSync(process.execPath, ["--no-warnings", cliBundle(), "restaurer", "a.db.gz.age", "cle"], { env, encoding: "utf8" });
  assert.equal(restauration.status, 1);
  rmSync(dir, { recursive: true, force: true });
});
