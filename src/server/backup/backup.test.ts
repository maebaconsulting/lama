import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { initDB, run } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { clearHandlers, enqueue, listOutbox, processDue, registerHandler } from "../outbox/outbox.ts";
import { applyPendingRestore, backupFileName, decryptBackup, isFirstOfMonth, makeEncryptedSnapshot, prepareRestore, pruneDir, runBackup, USB_MARKER } from "./backup.ts";
import { createDriveGiveUp, createDriveHandler, RCLONE_OPTS } from "./drive.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { decode } from "../messages.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { preparePrintImage, saveLogo } from "../institut/logos.ts";
import { saveProductImage } from "../produits/images.ts";

const NOW = Date.parse("2026-10-01T01:00:00Z"); // 2 h à Douala, le 1er du mois

test("nom de fichier et premier du mois à l'heure de Douala", () => {
  assert.equal(backupFileName(NOW), "lama-20261001-0200.db.gz.age");
  assert.equal(isFirstOfMonth(NOW), true);
  assert.equal(isFirstOfMonth(Date.parse("2026-09-30T22:00:00Z")), false, "23 h à Douala le 30");
});

test("aller-retour complet : copie, chiffrement, restauration, contenu identique", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.exec("INSERT INTO clients (name, phone) VALUES ('Aïcha Mbarga', '6 77 12 34 01')");
  initDB({ STORAGE: sqliteStorage(db) });
  const identity = await generateIdentity();
  const snapshot = await makeEncryptedSnapshot({ run: (sql, p) => run(sql, p), recipient: await identityToRecipient(identity), tmpDir: dir, now: NOW });
  const encrypted = readFileSync(snapshot.file);
  assert.ok(!encrypted.includes(Buffer.from("Aïcha")), "chiffré");
  const plain = await decryptBackup(encrypted, identity);
  const dataDir = join(dir, "restauration");
  mkdirSync(dataDir);
  writeFileSync(join(dataDir, "lama.db"), "ancienne base");
  prepareRestore(plain, dataDir);
  const aside = applyPendingRestore(dataDir, NOW);
  assert.match(aside!, /^avant-restauration-20261001-0200\.db$/);
  const restored = new DatabaseSync(join(dataDir, "lama.db"));
  // node:sqlite renvoie des lignes à prototype nul (comme storage.ts le
  // normalise déjà pour l'API) : on compare des objets simples.
  assert.deepEqual(restored.prepare("SELECT name FROM clients").all().map((r) => ({ ...r })), [{ name: "Aïcha Mbarga" }]);
  restored.close();
  db.close();
});

test("la sauvegarde contient les logos de l'institut (octets, version et image d'impression), restaurés à l'identique", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-logo-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  const impression = preparePrintImage(PNG_1PX, "image/png");
  assert.equal(await saveLogo("clair", "image/png", PNG_1PX, impression, NOW), 1);
  assert.equal(await saveLogo("sombre", "image/png", PNG_1PX, null, NOW), 1);
  const identity = await generateIdentity();
  const snapshot = await makeEncryptedSnapshot({ run: (sql, p) => run(sql, p), recipient: await identityToRecipient(identity), tmpDir: dir, now: NOW });
  const plain = await decryptBackup(readFileSync(snapshot.file), identity);
  const dataDir = join(dir, "restauration");
  mkdirSync(dataDir);
  prepareRestore(plain, dataDir);
  const copy = new DatabaseSync(join(dataDir, "lama.db.restauration"));
  const rows = copy.prepare("SELECT variante, type, octets, version, impression FROM institut_logos ORDER BY variante").all() as Array<{ variante: string; type: string; octets: Uint8Array; version: number; impression: Uint8Array | null }>;
  copy.close();
  db.close();
  assert.deepEqual(rows.map((r) => [r.variante, r.type, r.version]), [["clair", "image/png", 1], ["sombre", "image/png", 1]]);
  assert.deepEqual(Buffer.from(rows[0].octets), PNG_1PX);
  assert.deepEqual(Buffer.from(rows[0].impression!), impression);
  assert.equal(rows[1].impression, null);
});

test("la sauvegarde contient les photos des produits (octets et version), restaurées à l'identique", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-photo-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  db.exec("INSERT INTO products (id, name) VALUES (1, 'Sérum Karité')");
  assert.equal(await saveProductImage(1, "image/png", PNG_1PX, NOW), 1);
  const identity = await generateIdentity();
  const snapshot = await makeEncryptedSnapshot({ run: (sql, p) => run(sql, p), recipient: await identityToRecipient(identity), tmpDir: dir, now: NOW });
  const plain = await decryptBackup(readFileSync(snapshot.file), identity);
  const dataDir = join(dir, "restauration");
  mkdirSync(dataDir);
  prepareRestore(plain, dataDir);
  const copy = new DatabaseSync(join(dataDir, "lama.db.restauration"));
  const rows = copy.prepare("SELECT product_id, type, octets, version FROM product_images").all() as Array<{ product_id: number; type: string; octets: Uint8Array; version: number }>;
  copy.close();
  db.close();
  assert.deepEqual(rows.map((r) => [r.product_id, r.type, r.version]), [[1, "image/png", 1]]);
  assert.deepEqual(Buffer.from(rows[0].octets), PNG_1PX);
});

test("une clé privée erronée est refusée sans rien laisser", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  const snapshot = await makeEncryptedSnapshot({ run: (sql, p) => run(sql, p), recipient: await identityToRecipient(await generateIdentity()), tmpDir: dir, now: NOW });
  await assert.rejects(decryptBackup(readFileSync(snapshot.file), await generateIdentity()), /@sauvegarde\.dechiffrement/);
  assert.equal(applyPendingRestore(dir, NOW), null);
  db.close();
});

test("clé privée mal formée (une faute de frappe) : message fixe, jamais la clé elle-même", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  const snapshot = await makeEncryptedSnapshot({ run: (sql, p) => run(sql, p), recipient: await identityToRecipient(await generateIdentity()), tmpDir: dir, now: NOW });
  // `addIdentity` lève de façon SYNCHRONE sur une clé au checksum invalide
  // (une faute de frappe) : c'est le chemin qui faisait fuiter la clé avant
  // la correction (message « Invalid checksum in <clé complète> »).
  const identity = await generateIdentity();
  const altered = identity.slice(0, -1) + (identity.at(-1) === "0" ? "1" : "0");
  await assert.rejects(decryptBackup(readFileSync(snapshot.file), altered), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(decode("fr", error.message), "Impossible de déchiffrer\u00a0: la clé privée ne correspond pas à cette sauvegarde.");
    assert.ok(!error.message.includes(altered), "la clé ne doit jamais apparaître dans le message");
    return true;
  });
  assert.equal(applyPendingRestore(dir, NOW), null, "rien n'est laissé");
  db.close();
});

test("applyPendingRestore conserve le -wal et le -shm à côté de la base mise de côté", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-wal-"));
  writeFileSync(join(dir, "lama.db"), "base en service");
  writeFileSync(join(dir, "lama.db-wal"), "transactions non reportées");
  writeFileSync(join(dir, "lama.db-shm"), "index partagé");
  writeFileSync(join(dir, "lama.db.restauration"), "base restaurée");
  const aside = applyPendingRestore(dir, NOW)!;
  assert.equal(readFileSync(join(dir, aside), "utf8"), "base en service");
  assert.equal(readFileSync(join(dir, `${aside}-wal`), "utf8"), "transactions non reportées");
  assert.equal(readFileSync(join(dir, `${aside}-shm`), "utf8"), "index partagé");
  assert.equal(readFileSync(join(dir, "lama.db"), "utf8"), "base restaurée");
  assert.ok(!existsSync(join(dir, "lama.db-wal")), "plus de -wal sous le nom courant");
  assert.ok(!existsSync(join(dir, "lama.db-shm")), "plus de -shm sous le nom courant");
});

test("applyPendingRestore ne réutilise pas le nom d'une copie déjà chiffrée", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-scelle-"));
  writeFileSync(join(dir, "lama.db"), "base en service");
  writeFileSync(join(dir, "lama.db.restauration"), "base restaurée");
  const first = applyPendingRestore(dir, NOW)!;
  renameSync(join(dir, first), join(dir, `${first}.gz.age`));
  writeFileSync(join(dir, "lama.db.restauration"), "autre base");
  const second = applyPendingRestore(dir, NOW)!;
  assert.notEqual(second, first);
  assert.match(second, /-2\.db$/);
  assert.ok(existsSync(join(dir, `${first}.gz.age`)));
});

test("makeEncryptedSnapshot deux fois au même instant : la seconde copie remplace la première", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-snap-"));
  const db = openDatabase(join(dir, "lama.db"));
  const run = async (sql: string, params: unknown[]) => db.prepare(sql).run(...(params as string[]));
  const recipient = await identityToRecipient(await generateIdentity());
  const o = { run, recipient, tmpDir: join(dir, "attente"), now: NOW };
  const first = await makeEncryptedSnapshot(o);
  const second = await makeEncryptedSnapshot(o);
  assert.equal(second.file, first.file);
  assert.deepEqual(readdirSync(o.tmpDir), [first.name]);
  db.close();
});

test("un fichier qui n'est pas une base SQLite n'est pas préparé", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  assert.throws(() => prepareRestore(Buffer.from("pas une base"), dir), /@sauvegarde\.integrite/);
  assert.ok(!existsSync(join(dir, "lama.db.restauration")));
});

test("rotation : on garde les N plus récents", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-rot-"));
  for (let d = 1; d <= 5; d++) writeFileSync(join(dir, `lama-2026090${d}-0200.db.gz.age`), "x");
  assert.deepEqual(pruneDir(dir, 3), ["lama-20260902-0200.db.gz.age", "lama-20260901-0200.db.gz.age"]);
  assert.equal(readdirSync(dir).length, 3);
});

test("disque USB absent : échec USB enregistré, envoi Drive tout de même mis en file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  const result = await runBackup({
    run: (sql, p) => run(sql, p), recipient: await identityToRecipient(await generateIdentity()),
    usbDir: join(dir, "absent"), tmpDir: join(dir, "attente"), remote: "gdrive:lama", now: NOW,
  });
  assert.deepEqual(result, { usb: "failed", drive: "pending" });
  const usb = db.prepare("SELECT status, message FROM backups WHERE destination = 'usb'").get() as { status: string; message: string };
  assert.equal(usb.status, "failed");
  assert.match(decode("fr", usb.message), /Disque de sauvegarde introuvable/);
  assert.equal((await listOutbox("pending"))[0].kind, "sauvegarde.drive");
  db.close();
});

test("point de montage présent mais disque non monté (pas de témoin) : échec USB, aucune copie, Drive mis en file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  const mount = join(dir, "montage");
  mkdirSync(mount);
  const result = await runBackup({
    run: (sql, p) => run(sql, p), recipient: await identityToRecipient(await generateIdentity()),
    usbDir: mount, tmpDir: join(dir, "attente"), remote: "gdrive:lama", now: NOW,
  });
  assert.deepEqual(result, { usb: "failed", drive: "pending" });
  const usb = db.prepare("SELECT status, message FROM backups WHERE destination = 'usb'").get() as { status: string; message: string };
  assert.equal(usb.status, "failed");
  assert.match(decode("fr", usb.message), /Disque de sauvegarde introuvable/);
  assert.deepEqual(readdirSync(mount), [], "rien n'est écrit sur le disque système");
  assert.equal((await listOutbox("pending"))[0].kind, "sauvegarde.drive");
  db.close();
});

test("disque USB avec son témoin : copie quotidienne et mensuelle écrites", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  const usbDir = join(dir, "usb");
  mkdirSync(usbDir);
  writeFileSync(join(usbDir, USB_MARKER), "");
  const result = await runBackup({
    run: (sql, p) => run(sql, p), recipient: await identityToRecipient(await generateIdentity()),
    usbDir, tmpDir: join(dir, "attente"), remote: "gdrive:lama", now: NOW,
  });
  assert.equal(result.usb, "ok");
  assert.deepEqual(readdirSync(join(usbDir, "quotidiennes")), [backupFileName(NOW)]);
  assert.deepEqual(readdirSync(join(usbDir, "mensuelles")), [backupFileName(NOW)]);
  db.close();
});

test("envoi Drive : réussite, erreur passagère, remote non configuré", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-drive-"));
  const file = join(dir, "lama-20261001-0200.db.gz.age");
  writeFileSync(file, "chiffré");
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  const calls: string[][] = [];
  const ok = createDriveHandler({ exec: async (_cmd, args) => { calls.push(args); return { code: 0, stderr: "" }; }, now: () => NOW });
  await ok({ file, name: "lama-20261001-0200.db.gz.age", remote: "gdrive:lama", monthly: true });
  assert.deepEqual(calls[0], ["copyto", ...RCLONE_OPTS, "--", file, "gdrive:lama/quotidiennes/lama-20261001-0200.db.gz.age"]);
  assert.deepEqual(calls[1], ["copyto", ...RCLONE_OPTS, "--", file, "gdrive:lama/mensuelles/lama-20261001-0200.db.gz.age"]);
  assert.deepEqual(calls[2], ["delete", "--min-age", "15d", ...RCLONE_OPTS, "--", "gdrive:lama/quotidiennes"]);
  assert.deepEqual(calls[3], ["delete", "--min-age", "366d", ...RCLONE_OPTS, "--", "gdrive:lama/mensuelles"]);
  assert.ok(!existsSync(file), "fichier en attente supprimé après envoi");
  writeFileSync(file, "chiffré");
  const offline = createDriveHandler({ exec: async () => ({ code: 1, stderr: "dial tcp: lookup www.googleapis.com: no such host" }), now: () => NOW });
  await assert.rejects(offline({ file, name: "x", remote: "gdrive:lama", monthly: false }), TemporaryError);
  const unconfigured = createDriveHandler({ exec: async () => ({ code: 1, stderr: "didn't find section in config file" }), now: () => NOW });
  await assert.rejects(unconfigured({ file, name: "x", remote: "gdrive:lama", monthly: false }), PermanentError);
});

test("envoi Drive sans sortie d'erreur (rclone absent) : le message garde un détail, jamais « impossible pour l'instant : » seul", async () => {
  const silent = createDriveHandler({ exec: async () => ({ code: 127, stderr: "" }), now: () => NOW });
  const error = await silent({ file: "/inexistant", name: "x", remote: "gdrive:lama", monthly: false }).then(() => null, (e: Error) => e);
  assert.ok(error instanceof TemporaryError);
  assert.equal(decode("fr", error.message), "Envoi vers Google Drive impossible pour l'instant\u00a0: rclone a échoué (code 127)");
  assert.equal(decode("en", error.message), "Sending to Google Drive is not possible for now: rclone failed (code 127)");
});

test("applyPendingRestore : deux restaurations dans la même minute n'écrasent jamais la base mise de côté", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-double-"));
  writeFileSync(join(dir, "lama.db"), "prod");
  writeFileSync(join(dir, "lama.db-wal"), "wal prod");
  writeFileSync(join(dir, "lama.db.restauration"), "A");
  const first = applyPendingRestore(dir, NOW)!;
  writeFileSync(join(dir, "lama.db-wal"), "wal A");
  writeFileSync(join(dir, "lama.db.restauration"), "B");
  const second = applyPendingRestore(dir, NOW + 30_000)!;
  assert.notEqual(second, first);
  assert.match(first, /^avant-restauration-\d{8}-\d{4}\.db$/);
  assert.equal(readFileSync(join(dir, first), "utf8"), "prod", "la vraie base est toujours là");
  assert.equal(readFileSync(join(dir, `${first}-wal`), "utf8"), "wal prod");
  assert.equal(readFileSync(join(dir, second), "utf8"), "A");
  assert.equal(readFileSync(join(dir, `${second}-wal`), "utf8"), "wal A");
  assert.equal(readFileSync(join(dir, "lama.db"), "utf8"), "B");
});

function driveQueue(exec: (cmd: string, args: string[]) => Promise<{ code: number; stderr: string }>) {
  const dir = mkdtempSync(join(tmpdir(), "lama-drive-echec-"));
  const file = join(dir, "lama-20261001-0200.db.gz.age");
  writeFileSync(file, "chiffré");
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  registerHandler("sauvegarde.drive", createDriveHandler({ exec, now: () => NOW }), createDriveGiveUp({ now: () => NOW }));
  const payload = { file, name: "lama-20261001-0200.db.gz.age", remote: "gdrive:lama", monthly: false };
  const drive = () => db.prepare("SELECT status, message FROM backups WHERE destination = 'drive' ORDER BY id").all() as { status: string; message: string }[];
  return { db, file, payload, drive };
}

test("échec Drive définitif : enregistré « failed » avec un message clair, fichier en attente supprimé", async () => {
  const { db, file, payload, drive } = driveQueue(async () => ({ code: 1, stderr: "Failed to create file system: invalid_grant" }));
  await enqueue({ kind: "sauvegarde.drive", payload, dedupeKey: "d1", now: NOW });
  await processDue(NOW, true);
  assert.equal((await listOutbox("failed")).length, 1);
  const rows = drive();
  assert.equal(rows.at(-1)!.status, "failed");
  assert.match(decode("fr", rows.at(-1)!.message), /Google Drive n'est pas configuré/);
  assert.ok(!existsSync(file), "fichier en attente supprimé");
  db.close();
});

test("envoi Drive abandonné après 24 h d'erreurs passagères : enregistré « failed », fichier supprimé", async () => {
  const { db, file, payload, drive } = driveQueue(async () => ({ code: 1, stderr: "dial tcp: no such host" }));
  await enqueue({ kind: "sauvegarde.drive", payload, dedupeKey: "d2", now: NOW });
  await processDue(NOW + 23.99 * 3600e3, true);
  assert.equal(drive().length, 0, "encore des essais possibles");
  assert.ok(existsSync(file));
  await processDue(NOW + 25 * 3600e3, true);
  const rows = drive();
  assert.equal(rows.at(-1)!.status, "failed");
  assert.match(decode("fr", rows.at(-1)!.message), /24\u00a0h/);
  assert.ok(!existsSync(file), "fichier en attente supprimé");
  db.close();
});

test("sans Google Drive réglé (remote nul) : copie USB, aucune ligne Drive, rien en file (V1-75)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-sauv-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  const usbDir = join(dir, "usb");
  mkdirSync(usbDir);
  writeFileSync(join(usbDir, USB_MARKER), "");
  const result = await runBackup({
    run: (sql, p) => run(sql, p), recipient: await identityToRecipient(await generateIdentity()),
    usbDir, tmpDir: join(dir, "attente"), remote: null, now: NOW,
  });
  assert.deepEqual(result, { usb: "ok", drive: "none" });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM backups WHERE destination = 'drive'").get() as { n: number }).n, 0);
  assert.deepEqual(await listOutbox("pending"), []);
  assert.deepEqual(readdirSync(join(dir, "attente")), [], "aucune copie chiffrée laissée en attente d'un envoi qui n'aura pas lieu");
  db.close();
});
