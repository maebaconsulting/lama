import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { setupApp } from "../test-support.ts";
import type { Exec } from "./drive.ts";
import { RESTORE_NOTE, USB_MARKER } from "./backup.ts";

async function withBackup(t: Parameters<typeof setupApp>[0], exec: Exec = async () => ({ code: 0, stderr: "" })) {
  const ctx = await setupApp(t);
  const dir = mkdtempSync(join(tmpdir(), "lama-api-sauv-"));
  mkdirSync(join(dir, "usb"));
  writeFileSync(join(dir, "usb", USB_MARKER), "");
  const identity = await generateIdentity();
  let restarts = 0;
  Object.assign(ctx.env, {
    BACKUP: {
      usbDir: join(dir, "usb"), tmpDir: join(dir, "attente"), dataDir: join(dir, "data"),
      recipient: await identityToRecipient(identity), exec, requestRestart: () => { restarts++; },
    },
  });
  return { ctx, dir, identity, restarts: () => restarts };
}

test("état des sauvegardes : alerte après 36 h sans succès", async (t) => {
  const { ctx } = await withBackup(t);
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("GET", "/api/backups/status")).body.alert, true, "jamais sauvegardé");
  ctx.db.prepare("INSERT INTO backups (at, destination, status, file) VALUES (?, 'usb', 'ok', 'x')").run(ctx.clock.now - 35 * 3600e3);
  ctx.db.prepare("INSERT INTO backups (at, destination, status, file) VALUES (?, 'drive', 'ok', 'x')").run(ctx.clock.now - 35 * 3600e3);
  assert.equal((await gerante("GET", "/api/backups/status")).body.alert, false);
  ctx.clock.now += 2 * 3600e3;
  assert.equal((await gerante("GET", "/api/backups/status")).body.alert, true);
});

function configureDrive(ctx: Awaited<ReturnType<typeof setupApp>>) {
  ctx.db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('technique.drive_remote', ?, 0, ?)").run(JSON.stringify("gdrive:lama"), ctx.clock.now);
}

test("alerte des 36 h : Google Drive ignoré tant que sa destination n'est pas configurée", async (t) => {
  const { ctx } = await withBackup(t);
  const gerante = await ctx.as("manager");
  ctx.db.prepare("INSERT INTO backups (at, destination, status, file) VALUES (?, 'usb', 'ok', 'x')").run(ctx.clock.now - 3600e3);
  ctx.db.prepare("INSERT INTO backups (at, destination, status, file, message) VALUES (?, 'drive', 'failed', 'x', 'non configuré')").run(ctx.clock.now - 3600e3);
  const before = (await gerante("GET", "/api/backups/status")).body;
  assert.equal(before.alert, false, "pas de bandeau permanent avant la configuration de Drive");
  assert.equal(before.destinations.drive.alert, false);
  assert.equal(before.destinations.drive.configured, false);
  configureDrive(ctx);
  const after = (await gerante("GET", "/api/backups/status")).body;
  assert.equal(after.alert, true);
  assert.equal(after.destinations.drive.alert, true);
  assert.equal(after.destinations.drive.configured, true);
});

test("alerte des 36 h par destination : Google Drive en échec déclenche l'alerte même si l'USB réussit", async (t) => {
  const { ctx } = await withBackup(t);
  configureDrive(ctx);
  const gerante = await ctx.as("manager");
  for (let day = 3; day >= 0; day--) {
    const at = ctx.clock.now - day * 24 * 3600e3;
    ctx.db.prepare("INSERT INTO backups (at, destination, status, file) VALUES (?, 'usb', 'ok', 'x')").run(at);
    ctx.db.prepare("INSERT INTO backups (at, destination, status, file, message) VALUES (?, 'drive', 'failed', 'x', 'invalid_grant')").run(at);
  }
  const status = (await gerante("GET", "/api/backups/status")).body;
  assert.equal(status.alert, true);
  assert.equal(status.destinations.usb.alert, false);
  assert.equal(status.destinations.drive.alert, true);
  assert.equal(status.destinations.drive.last_ok_at, null);
});

test("une destination Drive invalide en base ne bloque pas la sauvegarde USB", async (t) => {
  const { ctx } = await withBackup(t);
  ctx.db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('technique.drive_remote', ?, 0, 0)").run(JSON.stringify("-x:bad"));
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const res = await admin("POST", "/api/backups/run");
  assert.equal(res.status, 200);
  assert.equal(res.body.usb, "ok");
});

test("sauvegarde manuelle puis restauration : confirmation requise, maintenance, redémarrage demandé", async (t) => {
  const { ctx, dir, identity, restarts } = await withBackup(t);
  const admin = await ctx.as("admin");
  assert.equal((await admin("POST", "/api/backups/run")).body.code, "confirmation");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const run = await admin("POST", "/api/backups/run");
  assert.equal(run.status, 200);
  assert.equal(run.body.usb, "ok");
  const list = await admin("GET", "/api/backups");
  const name = list.body.files.quotidiennes[0];
  assert.match(name, /^lama-\d{8}-\d{4}\.db\.gz\.age$/);
  const wrong = await admin("POST", "/api/backups/restore", { source: "usb", name, identity: await generateIdentity() }, { "Accept-Language": "fr" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /clé privée/);
  const ok = await admin("POST", "/api/backups/restore", { source: "usb", name, identity });
  assert.equal(ok.status, 200);
  assert.ok(existsSync(join(dir, "data", "lama.db.restauration")));
  const note = JSON.parse(readFileSync(join(dir, "data", RESTORE_NOTE), "utf8"));
  assert.deepEqual({ login: note.login, name: note.name, at: note.at }, { login: "admin", name, at: ctx.clock.now });
  assert.equal(restarts(), 1);
  assert.equal((await admin("GET", "/api/auth/me")).status, 503, "maintenance");
});

async function readEvents(res: Response, until: (events: { event: string; data: string }[]) => boolean, timeoutMs = 2000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: string }[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (!until(events) && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now())),
    ]);
    if (done || !value) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "";
      events.push({ event, data });
    }
  }
  await reader.cancel();
  return events;
}

test("restauration : la maintenance est diffusée sans attendre aux écrans déjà ouverts (pas seulement celui qui restaure)", async (t) => {
  const { ctx, identity } = await withBackup(t);
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  await admin("POST", "/api/backups/run");
  const list = await admin("GET", "/api/backups");
  const name = list.body.files.quotidiennes[0];
  // Second écran, déjà ouvert avant la restauration, avec sa propre session.
  const login = await ctx.raw("POST", "/api/auth/login", { login: "admin", password: "mot-de-passe-test" }, { "X-Lama": "1" });
  const session = login.headers.getSetCookie().find((c) => c.startsWith("lama_session="))!.split(";")[0];
  const stream = await ctx.app.request("/api/events", { headers: { cookie: session } }, ctx.env);
  assert.equal(stream.status, 200);
  const started = Date.now();
  setTimeout(() => void admin("POST", "/api/backups/restore", { source: "usb", name, identity }), 50);
  const events = await readEvents(stream, (evs) => evs.some((e) => e.event === "maintenance"));
  assert.ok(events.some((e) => e.event === "maintenance"), "l'écran resté ouvert reçoit le signal de maintenance");
  assert.ok(Date.now() - started < 2000);
});

test("restauration : une clé valide altérée d'un caractère est refusée sans fuite ni fichier laissé", async (t) => {
  const { ctx, dir, identity } = await withBackup(t);
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  await admin("POST", "/api/backups/run");
  const list = await admin("GET", "/api/backups");
  const name = list.body.files.quotidiennes[0];
  // `addIdentity` lève de façon synchrone sur ce genre de clé (checksum
  // invalide) : c'est exactement le chemin corrigé (la clé fuitait dans le
  // message avant la correction 1).
  const altered = identity.slice(0, -1) + (identity.at(-1) === "0" ? "1" : "0");
  const res = await admin("POST", "/api/backups/restore", { source: "usb", name, identity: altered });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Cannot decrypt: the private key does not match this backup.");
  assert.ok(!JSON.stringify(res.body).includes(altered), "la réponse ne contient pas la clé");
  assert.ok(!existsSync(join(dir, "data", "lama.db.restauration")), "aucun fichier de restauration laissé");
});

test("source de restauration invalide : 400 lisible, en anglais sans langue indiquée", async (t) => {
  const { ctx } = await withBackup(t);
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const res = await admin("POST", "/api/backups/restore", { source: "cloud", name: "lama-20261001-0200.db.gz.age", identity: "x" });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Invalid restore source: “usb” or “drive” expected.");
});

test("restauration depuis Drive : bascule des quotidiennes vers les mensuelles si les quotidiennes échouent", async (t) => {
  const calls: string[][] = [];
  const { ctx, dir } = await withBackup(t, async (_cmd, args) => {
    calls.push(args);
    if (args.some((a) => a.includes("/quotidiennes/"))) return { code: 1, stderr: "directory not found" };
    // Mensuelles : le téléchargement « réussit » ; le contenu importe peu ici,
    // seul l'ordre des tentatives et le nettoyage du fichier temporaire comptent.
    const target = args.at(-1)!;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "contenu");
    return { code: 0, stderr: "" };
  });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const name = "lama-20261001-0200.db.gz.age";
  const res = await admin("POST", "/api/backups/restore", { source: "drive", name, identity: "peu importe" });
  assert.equal(calls.length, 2, "quotidiennes, puis mensuelles seulement en cas d'échec");
  assert.ok(calls[0].some((a) => a.includes("/quotidiennes/")));
  assert.ok(calls[1].some((a) => a.includes("/mensuelles/")));
  assert.equal(res.status, 400, "le contenu téléchargé n'est pas une sauvegarde valide, mais la bascule a eu lieu");
  assert.ok(!existsSync(join(dir, "attente", `telechargement-${name}`)), "fichier temporaire supprimé après usage");
});

test("sauvegarde manuelle sans Google Drive réglé : rien en file ni au tableau ; une fois réglé, envoi en file (V1-75)", async (t) => {
  const { ctx } = await withBackup(t);
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const count = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
  const first = await admin("POST", "/api/backups/run");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { usb: "ok", drive: "none" });
  assert.equal(count("SELECT COUNT(*) AS n FROM backups WHERE destination = 'drive'"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'sauvegarde.drive'"), 0);
  configureDrive(ctx);
  ctx.clock.now += 60_000; // autre minute, donc autre nom de sauvegarde
  const second = await admin("POST", "/api/backups/run");
  assert.deepEqual(second.body, { usb: "ok", drive: "pending" });
  assert.equal(count("SELECT COUNT(*) AS n FROM backups WHERE destination = 'drive' AND status = 'pending'"), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM outbox WHERE kind = 'sauvegarde.drive'"), 1);
});
