import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { setMasterKey } from "../settings.ts";
import { setupApp } from "../test-support.ts";
import { birthdaysOf, runRelances, shiftDay, startRelances } from "./relances.ts";

/** Instant à Douala (UTC+1) : `at("2026-10-04", "11:00")`. */
const at = (day: string, time: string) => Date.parse(`${day}T${time}:00+01:00`);
const DAY = "2026-10-04";

function setup(settings: Record<string, unknown> = { "relances.anniversaire": true, "relances.absence": true }) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  const storage = sqliteStorage(db);
  initDB({ STORAGE: storage });
  setMasterKey(new Uint8Array(32).fill(7));
  const set = (key: string, value: unknown) =>
    db.prepare("INSERT OR REPLACE INTO settings (key, value, secret, updated_at) VALUES (?, ?, 0, 0)").run(key, JSON.stringify(value));
  set("institut.nom", "Institut Ébène");
  for (const [key, value] of Object.entries(settings)) set(key, value);
  db.exec("INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456'), (2, 'Brenda Ngo', '699000002'), (3, 'Carine Eto', '')");
  let seq = 0;
  const visit = (client: number, day: string, status = "completed") =>
    db.prepare("INSERT INTO appointments (identifier, client_id, scheduled_date, start_time, status) VALUES (?, ?, ?, '10:00', ?)").run(`APT-${++seq}`, client, day, status);
  const keys = () => (db.prepare("SELECT dedupe_key FROM outbox ORDER BY id").all() as { dedupe_key: string }[]).map((r) => r.dedupe_key);
  const payloads = () => (db.prepare("SELECT payload FROM outbox ORDER BY id").all() as { payload: string }[]).map((r) => JSON.parse(r.payload));
  return { db, storage, set, visit, keys, payloads };
}

test("dates : décalage d'un jour et 29 février fêté le 28 les années non bissextiles (décision 1)", () => {
  assert.equal(shiftDay(DAY, -60), "2026-08-05");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(birthdaysOf("2027-02-28"), ["02-28", "02-29"]);
  assert.deepEqual(birthdaysOf("2028-02-28"), ["02-28"]);
  assert.deepEqual(birthdaysOf("2028-02-29"), ["02-29"]);
  assert.deepEqual(birthdaysOf(DAY), ["10-04"]);
});

test("rien sans réglage activé (décision 23)", async () => {
  const { db, storage, keys } = setup({});
  db.exec("UPDATE clients SET birthday = '10-04'");
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 0);
  assert.deepEqual(keys(), []);
});

test("anniversaire : le jour même, à partir de l'heure d'envoi, une fois par an, dans la langue de la cliente (décision 24)", async () => {
  const { db, storage, keys, payloads } = setup();
  db.exec("UPDATE clients SET birthday = '10-04' WHERE id IN (1, 3); UPDATE clients SET birthday = '10-05' WHERE id = 2");
  assert.equal(await runRelances(storage, at(DAY, "09:59")), 0, "avant 10:00");
  assert.equal(await runRelances(storage, at(DAY, "10:00")), 1, "Carine n'a pas de numéro");
  assert.equal(await runRelances(storage, at(DAY, "15:00")), 0, "déjà en file : même clé");
  assert.deepEqual(keys(), ["wa:anniversaire:1:2026"]);
  const [m] = payloads();
  assert.equal(m.text, "Bon anniversaire, Aïcha. Institut Ébène vous souhaite une très belle journée.");
  assert.equal(m.to, "237699123456");
  assert.deepEqual(m.origin, { type: "anniversaire", birthday: "10-04", clientId: 1 });
  db.exec("UPDATE clients SET birthday = '10-05', language = 'en' WHERE id = 1");
  assert.equal(await runRelances(storage, at("2026-10-05", "10:00")), 1, "Brenda le lendemain ; Aïcha, déjà fêtée cette année, non");
  assert.deepEqual(keys(), ["wa:anniversaire:1:2026", "wa:anniversaire:2:2026"]);
});

test("tâche arrêtée : rattrapé le jour même seulement", async () => {
  const { db, storage, keys } = setup();
  db.exec("UPDATE clients SET birthday = '10-04' WHERE id = 1");
  assert.equal(await runRelances(storage, at("2026-10-05", "11:00")), 0, "le lendemain : trop tard");
  assert.equal(await runRelances(storage, at(DAY, "20:30")), 1, "le soir même, avant le silence");
  assert.deepEqual(keys(), ["wa:anniversaire:1:2026"]);
});

test("29 février : un message par an, le 28 les années non bissextiles", async () => {
  const { db, storage, keys } = setup();
  db.exec("UPDATE clients SET birthday = '02-29' WHERE id = 1");
  assert.equal(await runRelances(storage, at("2027-02-28", "11:00")), 1);
  assert.equal(await runRelances(storage, at("2028-02-28", "11:00")), 0);
  assert.equal(await runRelances(storage, at("2028-02-29", "11:00")), 1);
  assert.deepEqual(keys(), ["wa:anniversaire:1:2027", "wa:anniversaire:1:2028"]);
});

test("« vous nous manquez » : entre le seuil et le seuil plus 14 jours, une fois par période d'absence (décision 25)", async () => {
  const { storage, visit, keys, payloads } = setup();
  visit(1, shiftDay(DAY, -59));
  visit(2, shiftDay(DAY, -75));
  visit(3, shiftDay(DAY, -60));
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 0, "59 jours, 75 jours, et une cliente sans numéro");
  assert.equal(await runRelances(storage, at(shiftDay(DAY, 1), "11:00")), 1, "60 jours : seuil atteint");
  assert.equal(await runRelances(storage, at(shiftDay(DAY, 15), "11:00")), 0, "74 jours : même période, même clé");
  assert.deepEqual(keys(), [`wa:absence:1:${shiftDay(DAY, -59)}`]);
  assert.deepEqual(payloads()[0].origin, { type: "absence", lastVisit: shiftDay(DAY, -59), clientId: 1 });
});

test("absence : rien avec un rendez-vous à venir ; nouvelle période après une nouvelle visite", async () => {
  const { db, storage, visit, keys } = setup();
  visit(1, shiftDay(DAY, -60));
  visit(1, shiftDay(DAY, 3), "booked");
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 0, "rendez-vous à venir");
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE status = 'booked'");
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 1);
  visit(1, shiftDay(DAY, 1));
  assert.equal(await runRelances(storage, at(shiftDay(DAY, 61), "11:00")), 1, "nouvelle visite, nouvelle absence");
  assert.deepEqual(keys(), [`wa:absence:1:${shiftDay(DAY, -60)}`, `wa:absence:1:${shiftDay(DAY, 1)}`]);
});

test("ni cliente en « Aucun », ni cliente jamais venue ; seuil réglable ; canal SMS accepté", async () => {
  const { db, storage, set, visit } = setup();
  visit(1, shiftDay(DAY, -30));
  visit(2, shiftDay(DAY, -60), "cancelled");
  db.exec("UPDATE clients SET channel = 'none', birthday = '10-04' WHERE id = 1");
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 0);
  db.exec("UPDATE clients SET channel = 'sms' WHERE id = 1");
  set("relances.absence_jours", 30);
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 2, "anniversaire et absence de 30 jours");
});

test("jamais pendant la fenêtre de silence ; une heure d'envoi dans le silence part à sa fin (décision 23)", async () => {
  const { db, storage, set, keys } = setup();
  db.exec("UPDATE clients SET birthday = '10-04' WHERE id = 1");
  set("relances.heure", "07:00");
  assert.equal(await runRelances(storage, at(DAY, "07:30")), 0, "silence jusqu'à 08:00");
  assert.equal(await runRelances(storage, at(DAY, "08:00")), 1);
  assert.deepEqual(keys(), ["wa:anniversaire:1:2026"]);
  const evening = setup();
  evening.db.exec("UPDATE clients SET birthday = '10-04' WHERE id = 1");
  evening.set("relances.heure", "22:00");
  assert.equal(await runRelances(evening.storage, at(DAY, "08:00")), 1, "22:00 tombe dans le silence : dès 08:00");
});

test("tâche périodique : passe chaque minute, s'arrête proprement", async () => {
  const { db, storage, keys } = setup();
  db.exec("UPDATE clients SET birthday = '10-04' WHERE id = 1");
  const stop = startRelances({ storage, now: () => at(DAY, "11:00"), intervalMs: 5 });
  await new Promise((done) => setTimeout(done, 40));
  stop();
  assert.deepEqual(keys(), ["wa:anniversaire:1:2026"]);
});

test("réglages des relances : à la gérante seulement, désactivés par défaut, valeurs contrôlées", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const settings = (await gerante("GET", "/api/settings")).body.settings as { key: string; value: unknown }[];
  const value = (key: string) => settings.find((s) => s.key === key)?.value;
  assert.deepEqual(["relances.anniversaire", "relances.absence", "relances.absence_jours", "relances.heure"].map(value), [false, false, 60, "10:00"]);
  assert.equal((await gerante("PUT", "/api/settings/relances.absence_jours", { value: 14 })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/relances.absence_jours", { value: 366 })).status, 400);
  const bad = await gerante("PUT", "/api/settings/relances.absence_jours", { value: 45.5 }, { "Accept-Language": "fr" });
  assert.equal(bad.body.error, "Nombre entier de jours attendu, de 15 à 365.");
  assert.equal((await gerante("PUT", "/api/settings/relances.absence_jours", { value: 45 })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/relances.heure", { value: "24:00" })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/relances.anniversaire", { value: "oui" })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/relances.anniversaire", { value: true })).status, 200);
  const reception = await ctx.as("reception");
  assert.equal((await reception("PUT", "/api/settings/relances.absence", { value: true })).status, 403);
});

test("absence : une cliente en soin (in_progress) compte comme un rendez-vous à venir", async () => {
  const { storage, visit, keys } = setup();
  visit(1, shiftDay(DAY, -60));
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 1, "sans soin en cours : relancée");
  const soin = setup();
  soin.visit(1, shiftDay(DAY, -60));
  soin.visit(1, DAY, "in_progress");
  assert.equal(await runRelances(soin.storage, at(DAY, "11:00")), 0, "en soin : rien");
  assert.deepEqual(soin.keys(), []);
  assert.equal(keys().length, 1);
});

test("silence en plein jour (12:00-14:00), heure d'envoi 13:00 : ni à minuit, ni pendant le silence, départ à sa fin", async () => {
  const { db, storage, set, keys } = setup();
  db.exec("UPDATE clients SET birthday = '10-04' WHERE id = 1");
  set("whatsapp.silence_debut", "12:00");
  set("whatsapp.silence_fin", "14:00");
  set("relances.heure", "13:00");
  assert.equal(await runRelances(storage, at(DAY, "00:05")), 0, "minuit");
  assert.equal(await runRelances(storage, at(DAY, "13:30")), 0, "silence");
  assert.equal(await runRelances(storage, at(DAY, "14:00")), 1, "fin du silence");
  assert.deepEqual(keys(), ["wa:anniversaire:1:2026"]);
});

test("seuil d'absence lisible par la gérante, la réception et la praticienne ; suit le réglage (décision 6)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  for (const role of ["manager", "reception", "practitioner"] as const) {
    const caller = await ctx.as(role);
    assert.deepEqual((await caller("GET", "/api/relances/seuil")).body, { absence_days: 60 }, role);
  }
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", "/api/settings/relances.absence_jours", { value: 90 })).status, 200);
  const praticienne = await ctx.as("practitioner");
  assert.deepEqual((await praticienne("GET", "/api/relances/seuil")).body, { absence_days: 90 });
  const admin = await ctx.as("admin");
  assert.equal((await admin("GET", "/api/relances/seuil")).status, 403);
});

test("mini CRM désactivé : aucune relance mise en file, même cases cochées ; réactivé, elles reprennent (interrupteur général)", async () => {
  const { db, storage, set, visit, keys } = setup();
  db.exec("UPDATE clients SET birthday = '10-04' WHERE id = 1");
  visit(2, shiftDay(DAY, -60));
  set("crm.active", false);
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 0);
  assert.deepEqual(keys(), []);
  set("crm.active", true);
  assert.equal(await runRelances(storage, at(DAY, "11:00")), 2);
});
