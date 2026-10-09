import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { bundleOf } from "./test-support.ts";
import { openDatabase } from "./storage.ts";
import { runMigrations } from "./migrations.ts";
import { decryptBackup, prepareRestore, RESTORE_NOTE, writeRestoreNote } from "./backup/backup.ts";

// boot.ts importe index.ts, dont les imports internes finissent en .js : on le charge assemblé, comme en production.
const { loadMasterKey, readConfig, shutdown, start } = await import(await bundleOf("./boot.ts"));

test("readConfig distingue développement et production", () => {
  const dev = readConfig({ LAMA_DEV: "1" });
  assert.equal(dev.port, 8787);
  assert.equal(dev.staticDir, null);
  assert.match(dev.dataDir, /data$/);
  const prod = readConfig({});
  assert.equal(prod.port, 443, "https en service (distribution D-07), http sur 80 pour la page du certificat");
  assert.equal(prod.httpPort, 80);
  assert.equal(prod.dataDir, "/var/lib/lama");
  assert.equal(prod.configDir, "/etc/lama");
  assert.equal(prod.staticDir, "dist");
});

test("la clé maîtresse est créée en développement, exigée en production", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-cle-"));
  assert.throws(() => loadMasterKey(join(dir, "prod"), false), /Clé maîtresse introuvable/);
  const key = loadMasterKey(join(dir, "dev"), true);
  assert.equal(key.length, 32);
  assert.equal(statSync(join(dir, "dev", "master.key")).mode & 0o777, 0o600);
  assert.deepEqual(loadMasterKey(join(dir, "dev"), true), key);
  assert.ok(readFileSync(join(dir, "dev", "master.key"), "utf8").length > 40);
});

test("le serveur démarre et répond en JSON sur /api", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-boot-"));
  const { server, port, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stats`);
    assert.ok(res.status < 500);
    assert.match(res.headers.get("content-type") ?? "", /json/);
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});

test("des essais de connexion en rafale ne figent pas le serveur", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-rafale-"));
  const { server, port, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  const base = `http://127.0.0.1:${port}`;
  let running = true;
  const attack = async () => {
    for (let i = 0; running; i++) {
      await fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Lama": "1" },
        body: JSON.stringify({ login: `inconnu${Math.random().toString(36).slice(2, 10)}`, password: "pas-le-bon-1" }),
      }).then((r) => r.arrayBuffer());
    }
  };
  try {
    const loops = Array.from({ length: 16 }, attack);
    await new Promise((ok) => setTimeout(ok, 500));
    const latencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      await (await fetch(`${base}/api/auth/state`)).arrayBuffer();
      latencies.push(performance.now() - t0);
    }
    running = false;
    await Promise.all(loops);
    const sorted = [...latencies].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const max = Math.max(...latencies);
    // Médiane sous 100 ms (le serveur répond normalement même sous charge) ;
    // maximum sous 500 ms (un serveur figé par des calculs scrypt synchrones
    // dépasserait la seconde). Le seuil sur le maximum seul est trop instable
    // (une latence isolée au-delà de 100 ms n'indique pas un blocage).
    assert.ok(median < 100, `médiane : ${Math.round(median)} ms (latences : ${latencies.map((l) => Math.round(l)).join(", ")} ms)`);
    assert.ok(max < 500, `maximum : ${Math.round(max)} ms (latences : ${latencies.map((l) => Math.round(l)).join(", ")} ms)`);
  } finally {
    running = false;
    stopWorker();
    server.close();
    db.close();
  }
});

test("après redémarrage, la restauration figure au journal de la base restaurée", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-restauration-"));
  // Base sauvegardée : l'administrateur y existe déjà sous le même numéro.
  mkdirSync(join(dir, "source"));
  const source = openDatabase(join(dir, "source", "lama.db"));
  runMigrations(source);
  const at = Date.parse("2026-09-28T09:00:00Z");
  source.prepare("INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Dan', 'dan', 'admin', 'x', ?)").run(at);
  source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  source.close();
  prepareRestore(readFileSync(join(dir, "source", "lama.db")), dir);
  writeRestoreNote(dir, { accountId: 1, login: "dan", name: "lama-20260928-0200.db.gz.age", ip: "192.168.1.20", at });
  const { server, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const rows = db.prepare("SELECT at, account_id, target, ip FROM audit_log WHERE action = 'restauration'").all().map((r: object) => ({ ...r }));
    assert.deepEqual(rows, [{ at, account_id: 1, target: "lama-20260928-0200.db.gz.age", ip: "192.168.1.20" }]);
    assert.ok(!existsSync(join(dir, RESTORE_NOTE)), "la note est consommée");
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});

test("restauration par un compte absent de la sauvegarde : journal sans numéro, identifiant en cible", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-restauration-"));
  mkdirSync(join(dir, "source"));
  const source = openDatabase(join(dir, "source", "lama.db"));
  runMigrations(source);
  source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  source.close();
  prepareRestore(readFileSync(join(dir, "source", "lama.db")), dir);
  writeRestoreNote(dir, { accountId: 7, login: "dan", name: "lama-20260928-0200.db.gz.age", ip: "192.168.1.20", at: 1 });
  const { server, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const rows = db.prepare("SELECT account_id, target FROM audit_log WHERE action = 'restauration'").all().map((r: object) => ({ ...r }));
    assert.deepEqual(rows, [{ account_id: null, target: "lama-20260928-0200.db.gz.age (dan)" }]);
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});

test("en développement, clés de sauvegarde d'essai et témoin USB sont créés une fois", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-dev-"));
  const config = { dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") };
  const first = await start(config);
  let pub = "";
  try {
    pub = readFileSync(join(dir, "config", "sauvegarde.pub"), "utf8").trim();
    assert.match(pub, /^age1[a-z0-9]+$/);
    assert.equal(first.env.BACKUP.recipient, pub);
    assert.match(readFileSync(join(dir, "config", "sauvegarde-DEV.key"), "utf8"), /^AGE-SECRET-KEY-1/);
    assert.equal(statSync(join(dir, "config", "sauvegarde-DEV.key")).mode & 0o777, 0o600);
    assert.ok(existsSync(join(dir, "usb", ".lama-sauvegarde")));
  } finally {
    await shutdown(first);
  }
  const second = await start(config);
  try {
    assert.equal(second.env.BACKUP.recipient, pub, "les clés existantes sont gardées");
  } finally {
    await shutdown(second);
  }
});

test("l'arrêt propre ferme le port et la base, même avec un flux temps réel ouvert", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-arret-"));
  const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  const base = `http://127.0.0.1:${running.port}`;
  const install = await fetch(`${base}/api/auth/install`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Lama": "1" },
    body: JSON.stringify({ display_name: "Dan", login: "dan", password: "motdepasse10" }),
  });
  assert.equal(install.status, 201);
  const cookie = install.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const events = await fetch(`${base}/api/events`, { headers: { cookie } });
  assert.equal(events.status, 200);
  const t0 = performance.now();
  await shutdown(running);
  assert.ok(performance.now() - t0 < 2000, "l'arrêt n'attend pas la fin du flux");
  await assert.rejects(fetch(`${base}/api/auth/state`));
  assert.throws(() => running.db.prepare("SELECT 1"));
  await events.body?.cancel().catch(() => {});
});

test("au démarrage, le gestionnaire WhatsApp est inscrit : sans fournisseur, un message en attente passe « à la main »", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-boot-"));
  const before = openDatabase(join(dir, "lama.db"));
  runMigrations(before);
  before.prepare("INSERT INTO outbox (kind, payload, dedupe_key, next_attempt_at, created_at) VALUES ('whatsapp', ?, 'wa:libre:essai', 0, ?)")
    .run(JSON.stringify({ to: "237699123456", lang: "fr", text: "Bonjour", origin: { type: "libre", clientId: 1 } }), Date.now());
  before.close();
  const { server, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    let row: { status: string; last_error: string } | undefined;
    for (let i = 0; i < 40; i++) {
      row = db.prepare("SELECT status, last_error FROM outbox WHERE dedupe_key = 'wa:libre:essai'").get() as typeof row;
      if (row?.status === "failed") break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.deepEqual({ ...row }, { status: "failed", last_error: "@whatsapp.sans_fournisseur" });
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});

test("après une restauration, la base mise de côté est chiffrée au démarrage, plus aucune copie en clair (V1-02)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-copies-boot-"));
  mkdirSync(join(dir, "source"));
  const source = openDatabase(join(dir, "source", "lama.db"));
  runMigrations(source);
  source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  source.close();
  // Une base en service existe déjà : la restauration la met de côté sous « avant-restauration-… ».
  const current = openDatabase(join(dir, "lama.db"));
  runMigrations(current);
  current.close();
  prepareRestore(readFileSync(join(dir, "source", "lama.db")), dir);
  const { server, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const copies = readdirSync(dir).filter((f) => f.startsWith("avant-restauration-"));
    assert.equal(copies.length, 1, copies.join(", "));
    assert.match(copies[0], /\.db\.gz\.age$/);
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});

test("restauration dont la base mise de côté garde des écritures dans son -wal : la copie chiffrée les contient, ni .db ni -wal en clair (V1-02)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-copies-wal-"));
  mkdirSync(join(dir, "source"));
  const source = openDatabase(join(dir, "source", "lama.db"));
  runMigrations(source);
  source.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  source.close();
  // Base en service ouverte sans point de contrôle automatique : l'écriture n'existe que dans le -wal.
  const live = join(dir, "lama.db");
  const current = new DatabaseSync(live);
  current.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0");
  runMigrations(current as never);
  current.exec("CREATE TABLE temoin (v TEXT)");
  current.prepare("INSERT INTO temoin (v) VALUES (?)").run("seulement dans le wal");
  assert.ok(statSync(`${live}-wal`).size > 0, "le -wal porte les écritures");
  // La restauration met de côté la base et son -wal, copiés tant que la base est ouverte.
  const stamp = "avant-restauration-20261004-0900";
  copyFileSync(live, join(dir, `${stamp}.db`));
  copyFileSync(`${live}-wal`, join(dir, `${stamp}.db-wal`));
  current.close();
  rmSync(live, { force: true });
  rmSync(`${live}-wal`, { force: true });
  rmSync(`${live}-shm`, { force: true });
  const { server, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const kept = readdirSync(dir).filter((f) => f.startsWith("avant-restauration-"));
    assert.deepEqual(kept, [`${stamp}.db.gz.age`], "ni .db ni -wal en clair");
    const identity = readFileSync(join(dir, "config", "sauvegarde-DEV.key"), "utf8").trim();
    const plain = join(dir, "lu.db");
    writeFileSync(plain, await decryptBackup(readFileSync(join(dir, `${stamp}.db.gz.age`)), identity));
    const lu = new DatabaseSync(plain);
    assert.equal((lu.prepare("SELECT v FROM temoin").get() as { v: string }).v, "seulement dans le wal");
    lu.close();
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});

test("/llms.txt est relayé à l'API, derrière sa garde (décision 14 de la passe V 1.0)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-llms-"));
  const { server, port, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/llms.txt`);
    // Base neuve, sans compte : c'est la garde de l'API qui répond (installation requise), plus un 404.
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "installation");
  } finally {
    stopWorker();
    server.close();
    db.close();
  }
});
