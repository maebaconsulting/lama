import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { decryptBackup } from "./backup.ts";
import { secureLocalCopies } from "./copies.ts";

/** Petite base SQLite dont la seule ligne dit d'où elle vient. */
function makeDb(file: string, value: string): void {
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE t (v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run(value);
  db.close();
}

/** Cinq copies de chaque sorte, de la plus ancienne à la plus récente. */
function fiveOfEach(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "lama-copies-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (let i = 1; i <= 5; i++) makeDb(join(dir, `avant-migration-170000000000${i}.db`), `migration ${i}`);
  for (let i = 1; i <= 4; i++) makeDb(join(dir, `avant-restauration-2026100${i}-0900.db`), `restauration ${i}`);
  // Deux restaurations dans la même minute : le suffixe « -2 » est la plus récente.
  makeDb(join(dir, "avant-restauration-20261004-0900-2.db"), "restauration 5");
  writeFileSync(join(dir, "lama.db"), "base en service, jamais touchée");
  return dir;
}

async function read(file: string, identity: string): Promise<string> {
  const plain = await decryptBackup(readFileSync(file), identity);
  const tmp = `${file}.lu.db`;
  writeFileSync(tmp, plain);
  const db = new DatabaseSync(tmp);
  const row = db.prepare("SELECT v FROM t").get() as { v: string };
  db.close();
  rmSync(tmp);
  return row.v;
}

test("avec la clé des sauvegardes : 3 copies chiffrées par sorte, les plus récentes, plus aucune en clair", async (t) => {
  const dir = fiveOfEach(t);
  const identity = await generateIdentity();
  await secureLocalCopies(dir, await identityToRecipient(identity));
  const files = readdirSync(dir).sort();
  assert.deepEqual(files, [
    "avant-migration-1700000000003.db.gz.age", "avant-migration-1700000000004.db.gz.age", "avant-migration-1700000000005.db.gz.age",
    "avant-restauration-20261003-0900.db.gz.age", "avant-restauration-20261004-0900-2.db.gz.age", "avant-restauration-20261004-0900.db.gz.age",
    "lama.db",
  ]);
  assert.equal(await read(join(dir, "avant-migration-1700000000005.db.gz.age"), identity), "migration 5");
  assert.equal(await read(join(dir, "avant-restauration-20261004-0900-2.db.gz.age"), identity), "restauration 5");
  assert.equal(readFileSync(join(dir, "lama.db"), "utf8"), "base en service, jamais touchée");
});

test("sans clé : 3 copies en clair par sorte, lisibles par le seul compte du service (0600)", async (t) => {
  const dir = fiveOfEach(t);
  await secureLocalCopies(dir, "");
  const copies = readdirSync(dir).filter((f) => f.startsWith("avant-"));
  assert.equal(copies.length, 6);
  for (const f of copies) {
    assert.ok(f.endsWith(".db"), f);
    assert.equal(statSync(join(dir, f)).mode & 0o777, 0o600, f);
  }
  assert.ok(copies.includes("avant-restauration-20261004-0900-2.db"));
  assert.ok(!copies.includes("avant-restauration-20261002-0900.db"));
});

test("base mise de côté avec son -wal : les transactions du -wal sont dans la copie chiffrée, -wal et -shm effacés", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lama-copies-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const live = join(dir, "vivante.db");
  const db = new DatabaseSync(live);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE t (v TEXT)");
  db.prepare("INSERT INTO t (v) VALUES (?)").run("seulement dans le wal");
  // Copie pendant que la base est ouverte : la ligne n'existe encore que dans le -wal.
  copyFileSync(live, join(dir, "avant-restauration-20261004-0900.db"));
  copyFileSync(`${live}-wal`, join(dir, "avant-restauration-20261004-0900.db-wal"));
  db.close();
  rmSync(live, { force: true });
  const identity = await generateIdentity();
  await secureLocalCopies(dir, await identityToRecipient(identity));
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("avant-")), ["avant-restauration-20261004-0900.db.gz.age"]);
  assert.equal(await read(join(dir, "avant-restauration-20261004-0900.db.gz.age"), identity), "seulement dans le wal");
});

test("deuxième passage : les copies déjà chiffrées comptent dans les 3 gardées", async (t) => {
  const dir = fiveOfEach(t);
  const recipient = await identityToRecipient(await generateIdentity());
  await secureLocalCopies(dir, recipient);
  makeDb(join(dir, "avant-migration-1700000000006.db"), "migration 6");
  const { removed } = await secureLocalCopies(dir, recipient);
  assert.deepEqual(removed, ["avant-migration-1700000000003.db.gz.age"]);
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith("avant-migration")).sort(), [
    "avant-migration-1700000000004.db.gz.age", "avant-migration-1700000000005.db.gz.age", "avant-migration-1700000000006.db.gz.age",
  ]);
});

test("jumeau chiffré déjà présent (arrêt entre chiffrement et effacement) : il est remplacé depuis la copie en clair", async (t) => {
  const dir = fiveOfEach(t);
  const identity = await generateIdentity();
  writeFileSync(join(dir, "avant-migration-1700000000005.db.gz.age"), "reste d'un arrêt brutal");
  await secureLocalCopies(dir, await identityToRecipient(identity));
  assert.equal(await read(join(dir, "avant-migration-1700000000005.db.gz.age"), identity), "migration 5");
  assert.ok(!readdirSync(dir).includes("avant-migration-1700000000005.db"));
});
