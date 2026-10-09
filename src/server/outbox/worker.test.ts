import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { clearHandlers, enqueue, OFFLINE_DELAY_MS } from "./outbox.ts";
import { setOnline } from "./connectivity.ts";
import { startWorker } from "./worker.ts";

test("hors ligne, un message qui passe les 30 minutes d'attente prévient les écrans (« Pas d'internet »)", async (t) => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  setOnline(true);
  const T0 = 1_000_000_000;
  let horloge = T0;
  await enqueue({ kind: "whatsapp", payload: {}, dedupeKey: "m1", now: T0 });
  let signaux = 0;
  const stop = startWorker({ intervalMs: 5, checkEveryMs: 0, now: () => horloge, check: async () => false, onChange: () => { signaux++; } });
  t.after(() => { stop(); setOnline(true); });
  await sleep(60);
  const avant = signaux; // la coupure elle-même a prévenu une fois
  assert.equal(avant, 1);
  horloge = T0 + OFFLINE_DELAY_MS - 1;
  await sleep(60);
  assert.equal(signaux, avant, "rien tant que les 30 minutes ne sont pas passées");
  horloge = T0 + OFFLINE_DELAY_MS;
  await sleep(60);
  assert.equal(signaux, avant + 1, "un signal quand le message entre dans la liste à la main");
  horloge += 60_000;
  await sleep(60);
  assert.equal(signaux, avant + 1, "pas de signal répété tant que rien ne change");
});
