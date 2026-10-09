import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "./storage.ts";
import { runMigrations } from "./migrations.ts";
import { listAudit, logAudit, purgeAudit } from "./audit.ts";

test("journal : écriture, filtre, purge après 365 jours", async () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  const day = 86_400_000;
  await logAudit({ accountId: null, action: "connexion.echec", target: "grace", ip: "192.168.1.20", now: 1000 });
  await logAudit({ accountId: null, action: "connexion", target: "dan", now: 400 * day });
  assert.equal((await listAudit({})).length, 2);
  assert.equal((await listAudit({ from: 2000 })).length, 1);
  assert.equal(await purgeAudit(400 * day), 1);
  assert.deepEqual((await listAudit({})).map((e) => e.action), ["connexion"]);
});
