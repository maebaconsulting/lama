import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase, sqliteStorage } from "./storage.ts";

test("l'adaptateur lit et écrit comme l'attend @clawnify/db", async () => {
  const db = openDatabase(":memory:");
  const storage = sqliteStorage(db);
  await storage.query("CREATE TABLE t (id INTEGER PRIMARY KEY, nom TEXT)");
  const insert = await storage.query("INSERT INTO t (nom) VALUES (?)", ["Aïcha"]);
  assert.deepEqual(insert.meta, { changes: 1, last_row_id: 1 });
  const select = await storage.query("SELECT nom FROM t WHERE id = ?", [1]);
  assert.deepEqual(select.rows, [{ nom: "Aïcha" }]);
  db.close();
});

test("les clés étrangères sont actives", async () => {
  const db = openDatabase(":memory:");
  db.exec("CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (a_id INTEGER REFERENCES a(id))");
  assert.throws(() => db.prepare("INSERT INTO b (a_id) VALUES (42)").run(), /FOREIGN KEY/);
  db.close();
});

test("transaction : tout est validé ensemble, ou tout est annulé si work lève", () => {
  const db = openDatabase(":memory:");
  const storage = sqliteStorage(db);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  const result = storage.transaction!((d) => {
    d.exec("INSERT INTO t (id) VALUES (1)");
    return 42;
  });
  assert.equal(result, 42);
  assert.throws(() => storage.transaction!((d) => {
    d.exec("INSERT INTO t (id) VALUES (2)");
    throw new Error("échec voulu");
  }), /échec voulu/);
  assert.deepEqual(db.prepare("SELECT id FROM t").all().map((r) => ({ ...r })), [{ id: 1 }], "l'insertion annulée n'est pas restée");
  db.close();
});

test("transaction : une erreur qui a déjà mis fin à la transaction (RAISE ROLLBACK) n'est pas masquée par un second ROLLBACK", () => {
  const db = openDatabase(":memory:");
  const storage = sqliteStorage(db);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  db.exec("CREATE TRIGGER t_stop BEFORE INSERT ON t BEGIN SELECT RAISE(ROLLBACK, 'coupure nette'); END");
  assert.throws(() => storage.transaction!((d) => {
    d.exec("INSERT INTO t (id) VALUES (1)");
  }), /coupure nette/, "l'erreur d'origine doit rester lisible, pas « cannot rollback »");
  assert.equal(db.isTransaction, false);
  db.close();
});

test("transaction : refuse un work asynchrone (l'atomicité ne peut pas être garantie) et annule ce qu'il a déjà écrit", () => {
  const db = openDatabase(":memory:");
  const storage = sqliteStorage(db);
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  assert.throws(() => storage.transaction!(async (d) => {
    d.exec("INSERT INTO t (id) VALUES (1)");
  }), /synchrone/);
  assert.equal(db.isTransaction, false);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n, 0, "l'écriture faite avant le premier point d'attente est annulée");
  db.close();
});
