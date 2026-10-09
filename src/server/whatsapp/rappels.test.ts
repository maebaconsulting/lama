import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { setMasterKey } from "../settings.ts";
import { appointmentAt } from "./numeros.ts";
import { runReminders, startReminders } from "./rappels.ts";

const AT = appointmentAt("2026-10-03", "10:00");
const H = 3600e3;

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const storage = sqliteStorage(db);
  initDB({ STORAGE: storage });
  setMasterKey(new Uint8Array(32).fill(7));
  db.exec(`INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456');
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time, booked_at) VALUES (1, 'APT-1', 1, '2026-10-03', '10:00', ${AT - 72 * H});`);
  const keys = () => (db.prepare("SELECT dedupe_key FROM outbox ORDER BY id").all() as { dedupe_key: string }[]).map((r) => r.dedupe_key);
  return { db, storage, keys };
}

test("rappel mis en file 24 h avant, une seule fois", async () => {
  const { storage, keys } = setup();
  assert.equal(await runReminders(storage, AT - 24 * H - 60e3), 0);
  assert.equal(await runReminders(storage, AT - 24 * H), 1);
  assert.equal(await runReminders(storage, AT - 23 * H), 0, "déjà en file : même clé");
  assert.deepEqual(keys(), ["wa:rappel:1:2026-10-03 10:00"]);
});

test("reprise après une coupure : rattrapé une fois s'il reste avant le rendez-vous, jamais après", async () => {
  const { db, storage, keys } = setup();
  assert.equal(await runReminders(storage, AT - 2 * H), 1);
  assert.equal(await runReminders(storage, AT - 2 * H + 60e3), 0);
  db.exec("DELETE FROM outbox");
  assert.equal(await runReminders(storage, AT + 60e3), 0, "rendez-vous passé");
  assert.deepEqual(keys(), []);
});

test("pas de rappel : annulé, terminé, absente, cliente décochée", async () => {
  const { db, storage } = setup();
  for (const status of ["cancelled", "completed", "no_show", "in_progress"]) {
    db.exec(`UPDATE appointments SET status = '${status}'`);
    assert.equal(await runReminders(storage, AT - 2 * H), 0, status);
  }
  db.exec("UPDATE appointments SET status = 'confirmed'; UPDATE clients SET channel = 'none'");
  assert.equal(await runReminders(storage, AT - 2 * H), 0, "décochée");
});

test("rendez-vous pris moins de 24 h à l'avance : pas de rappel (la confirmation suffit)", async () => {
  const { db, storage } = setup();
  db.exec(`UPDATE appointments SET booked_at = ${AT - 5 * H}`);
  assert.equal(await runReminders(storage, AT - H), 0);
  db.exec("UPDATE appointments SET booked_at = NULL");
  assert.equal(await runReminders(storage, AT - H), 1, "rendez-vous antérieur à la vague (heure de prise inconnue) : rappelé");
});

test("rendez-vous déplacé : nouvelle clé, nouveau rappel", async () => {
  const { db, storage, keys } = setup();
  await runReminders(storage, AT - 20 * H);
  db.exec(`UPDATE appointments SET scheduled_date = '2026-10-04', booked_at = ${AT - 20 * H}`);
  assert.equal(await runReminders(storage, AT + 4 * H), 1);
  assert.deepEqual(keys(), ["wa:rappel:1:2026-10-03 10:00", "wa:rappel:1:2026-10-04 10:00"]);
});

test("fenêtre de silence : un rappel dû la nuit part à 08:00", async () => {
  const { db, storage } = setup();
  db.exec("UPDATE appointments SET start_time = '07:00'");
  const at = appointmentAt("2026-10-03", "07:00");
  assert.equal(await runReminders(storage, at - 24 * H), 0, "07:00 la veille : silence");
  assert.equal(await runReminders(storage, appointmentAt("2026-10-02", "08:00")), 1);
  const row = db.prepare("SELECT next_attempt_at, payload FROM outbox").get() as { next_attempt_at: number; payload: string };
  assert.equal(row.next_attempt_at, appointmentAt("2026-10-02", "08:00"));
  assert.match(JSON.parse(row.payload).text, /^Bonjour Aïcha, nous vous rappelons votre rendez-vous le samedi 3 octobre à 07:00 /);
});

test("délai réglable (whatsapp.rappel_heures)", async () => {
  const { db, storage } = setup();
  db.exec(`INSERT INTO settings (key, value, secret, updated_at) VALUES ('whatsapp.rappel_heures', '48', 0, 0)`);
  assert.equal(await runReminders(storage, AT - 47 * H), 1);
});

test("tâche périodique : passe chaque minute, s'arrête proprement", async () => {
  const { storage, keys } = setup();
  const stop = startReminders({ storage, now: () => AT - 2 * H, intervalMs: 5 });
  await new Promise((done) => setTimeout(done, 40));
  stop();
  assert.deepEqual(keys(), ["wa:rappel:1:2026-10-03 10:00"]);
});
