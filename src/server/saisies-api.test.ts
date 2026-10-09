import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

/**
 * Passe de finition V 1.0, vague B (saisies et erreurs, côté serveur) :
 * recherche sans accents (V1-06), heures de la grille (V1-08), fiches
 * disparues en 404 (V1-09), refus de validation lisible (V1-10), bornes du
 * catalogue (V1-12) et des notes de rendez-vous (V1-13).
 */
const fr = { "Accept-Language": "fr" };
const PLAGE_FR = "Les heures vont de 07:00 à 21:00, par pas de 5 minutes.";
const FORMAT_FR = "Les heures doivent être au format HH:MM";

async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t);
  const call = await ctx.as("manager");
  return { db: ctx.db, call };
}

test("V1-06 : « aicha » trouve le rendez-vous d'« Aïcha », le numéro APT reste trouvé", async (t) => {
  const { db, call } = await setup(t);
  db.prepare("UPDATE clients SET name = 'Aïcha Essai' WHERE id = 1").run();
  const created = await call("POST", "/api/appointments", { client_id: 1, staff_id: null, scheduled_date: "2026-10-12", start_time: "10:00", service_ids: [2] });
  assert.equal(created.status, 201);
  const id = created.body.appointment.id as number;
  const byName = await call("GET", "/api/appointments?search=aicha&limit=200");
  assert.equal(byName.status, 200);
  assert.ok(byName.body.appointments.some((a: { id: number }) => a.id === id), "recherche sans accent ni majuscule");
  const byRef = await call("GET", `/api/appointments?search=${encodeURIComponent(created.body.appointment.identifier)}&limit=200`);
  assert.ok(byRef.body.appointments.some((a: { id: number }) => a.id === id), "recherche par numéro APT");
});

test("V1-08 : heures illisibles ou hors grille refusées en 400 lisible ; 07:00 et une fin à 21:00 acceptées", async (t) => {
  const { db, call } = await setup(t);
  // Prestation 2 : 30 minutes ; sans praticienne, aucun chevauchement possible avec la démonstration.
  const base = { client_id: 1, staff_id: null, scheduled_date: "2026-10-12", service_ids: [2] };
  const refus: [string, string][] = [["25:70", FORMAT_FR], ["06:30", PLAGE_FR], ["21:30", PLAGE_FR], ["09:07", PLAGE_FR]];
  for (const [start_time, attendu] of refus) {
    const res = await call("POST", "/api/appointments", { ...base, start_time }, fr);
    assert.equal(res.status, 400, start_time);
    assert.equal(res.body.error, attendu, start_time);
  }
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "06:30" })).body.error, "Times run from 07:00 to 21:00, in steps of 5 minutes.");
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "07:00" })).status, 201);
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "20:30" })).status, 201, "fin à 21:00 acceptée");
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "20:45" })).status, 400, "fin à 21:15 refusée");

  const id = (await call("POST", "/api/appointments", { ...base, start_time: "10:00" })).body.appointment.id as number;
  const moved = await call("PUT", `/api/appointments/${id}`, { start_time: "21:30" }, fr);
  assert.equal(moved.status, 400);
  assert.equal(moved.body.error, PLAGE_FR);
  assert.equal((await call("PUT", `/api/appointments/${id}`, { start_time: "10:00", end_time: "21:30" })).status, 400, "fin saisie hors grille");
  assert.equal((await call("PUT", `/api/appointments/${id}`, { start_time: "20:30" })).status, 200, "déplacé pour finir à 21:00");
  assert.deepEqual({ ...(db.prepare("SELECT start_time, end_time FROM appointments WHERE id = ?").get(id) as object) }, { start_time: "20:30", end_time: "21:00" });
  // Ancien rendez-vous hors grille : il change de jour sans que ses heures soient contrôlées.
  db.prepare("UPDATE appointments SET start_time = '06:30', end_time = '07:00' WHERE id = ?").run(id);
  assert.equal((await call("PUT", `/api/appointments/${id}`, { scheduled_date: "2026-10-13", allow_conflict: true })).status, 200, "heures anciennes gardées");

  const slot = { staff_id: 1, blocked_date: "2026-10-12", allow_conflict: true };
  const tot = await call("POST", "/api/blocked-slots", { ...slot, start_time: "06:00", end_time: "08:00" }, fr);
  assert.equal(tot.status, 400);
  assert.equal(tot.body.error, PLAGE_FR);
  assert.equal((await call("POST", "/api/blocked-slots", { ...slot, start_time: "12:00", end_time: "12:07" })).status, 400);
  assert.equal((await call("POST", "/api/blocked-slots", { ...slot, start_time: "20:00", end_time: "21:00" })).status, 201);
});

test("restes V 1.0, point 5 : une fin après 21:00 est nommée dans le message, en français et en anglais", async (t) => {
  const { call } = await setup(t);
  // Prestation 2 : 30 minutes ; sans praticienne, aucun chevauchement possible avec la démonstration.
  const base = { client_id: 1, staff_id: null, scheduled_date: "2026-10-12", service_ids: [2] };
  const created = await call("POST", "/api/appointments", { ...base, start_time: "20:45" }, fr);
  assert.equal(created.status, 400);
  assert.equal(created.body.error, "Le rendez-vous finirait à 21:15, après la fermeture à 21:00.");
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "20:45" })).body.error, "The appointment would end at 21:15, after closing time at 21:00.");

  const id = (await call("POST", "/api/appointments", { ...base, start_time: "10:00" })).body.appointment.id as number;
  const moved = await call("PUT", `/api/appointments/${id}`, { start_time: "20:50" }, fr);
  assert.equal(moved.status, 400);
  assert.equal(moved.body.error, "Le rendez-vous finirait à 21:20, après la fermeture à 21:00.", "fin calculée au déplacement");
  const ended = await call("PUT", `/api/appointments/${id}`, { start_time: "10:00", end_time: "21:30" });
  assert.equal(ended.status, 400);
  assert.equal(ended.body.error, "The appointment would end at 21:30, after closing time at 21:00.", "fin saisie au déplacement");

  const slot = { staff_id: 1, blocked_date: "2026-10-12", allow_conflict: true, start_time: "20:00", end_time: "21:30" };
  const blockedFr = await call("POST", "/api/blocked-slots", slot, fr);
  assert.equal(blockedFr.status, 400);
  assert.equal(blockedFr.body.error, "Le créneau bloqué finirait à 21:30, après la fermeture à 21:00.");
  assert.equal((await call("POST", "/api/blocked-slots", slot)).body.error, "The blocked time would end at 21:30, after closing time at 21:00.");

  // Un début hors grille garde le message général.
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "21:30" }, fr)).body.error, PLAGE_FR);
});

test("V1-09 : cliente, praticienne ou rendez-vous disparus : 404 avec le message du dictionnaire, jamais 500", async (t) => {
  const { db, call } = await setup(t);
  const base = { client_id: 1, staff_id: 1, scheduled_date: "2026-10-12", start_time: "10:00", service_ids: [2], allow_conflict: true };
  const avant = (db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n;

  const cliente = await call("POST", "/api/appointments", { ...base, client_id: 99999 }, fr);
  assert.equal(cliente.status, 404);
  assert.equal(cliente.body.error, "Cliente introuvable.");
  assert.equal((await call("POST", "/api/appointments", { ...base, client_id: 99999 })).body.error, "Client not found.");

  const praticienne = await call("POST", "/api/appointments", { ...base, staff_id: 99999 }, fr);
  assert.equal(praticienne.status, 404);
  assert.equal(praticienne.body.error, "Praticienne introuvable.");
  assert.equal((await call("POST", "/api/appointments", { ...base, staff_id: 99999 })).body.error, "Practitioner not found.");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n, avant, "aucun rendez-vous écrit");

  const note = await call("POST", "/api/appointments/99999/notes", { content: "Allergie au latex" }, fr);
  assert.equal(note.status, 404);
  assert.equal(note.body.error, "Introuvable");
  assert.equal((await call("POST", "/api/appointments/99999/notes", { content: "Allergie au latex" })).body.error, "Not found");

  const bloc = await call("POST", "/api/blocked-slots", { staff_id: 99999, blocked_date: "2026-10-12", start_time: "10:00", end_time: "11:00" }, fr);
  assert.equal(bloc.status, 404);
  assert.equal(bloc.body.error, "Praticienne introuvable.");
  assert.equal((await call("POST", "/api/blocked-slots", { staff_id: 99999, blocked_date: "2026-10-12", start_time: "10:00", end_time: "11:00" })).body.error, "Practitioner not found.");
});

test("V1-10 : un champ mal formé répond 400 avec une phrase qui le nomme, dans la langue de la requête", async (t) => {
  const { call } = await setup(t);
  const enFr = await call("POST", "/api/services", { name: "Tresses", price: "abc" }, fr);
  assert.equal(enFr.status, 400);
  assert.equal(enFr.body.error, "Saisie invalide\u00a0: price.");
  const enEn = await call("POST", "/api/services", { name: "Tresses", price: "abc" });
  assert.equal(enEn.status, 400);
  assert.equal(enEn.body.error, "Invalid input: price.");
  assert.equal(Object.keys(enEn.body).join(","), "error", "jamais l'erreur zod brute");
});

test("V1-12 : prix, prix d'achat et stock entiers positifs ou nuls, durée de 5 à 720 minutes, nom non vide", async (t) => {
  const { call } = await setup(t);
  const refusees: [string, object][] = [
    ["prix négatif", { name: "Tresses", price: -500 }],
    ["prix décimal", { name: "Tresses", price: 500.5 }],
    ["durée nulle", { name: "Tresses", duration: 0 }],
    ["durée de 800 minutes", { name: "Tresses", duration: 800 }],
    ["nom fait d'espaces", { name: "   " }],
  ];
  for (const [cas, body] of refusees) {
    const res = await call("POST", "/api/services", body, fr);
    assert.equal(res.status, 400, cas);
    assert.match(res.body.error, /^Saisie invalide\u00a0: (price|duration|name)\.$/, cas);
  }
  const gratuite = await call("POST", "/api/services", { name: "Conseil", price: 0, duration: 5 });
  assert.equal(gratuite.status, 201);
  assert.equal(gratuite.body.service.price, 0);
  assert.equal(gratuite.body.service.duration, 5);
  assert.equal((await call("PUT", "/api/services/1", { name: "" })).status, 400);
  assert.equal((await call("PUT", "/api/services/1", { price: -1 })).status, 400);
  assert.equal((await call("PUT", "/api/services/1", { price: 12000 })).status, 200);

  for (const [cas, body] of [
    ["stock négatif", { name: "Huile", stock: -1 }],
    ["prix d'achat décimal", { name: "Huile", cost: 1.5 }],
    ["prix négatif", { name: "Huile", price: -1 }],
    ["nom vide", { name: "" }],
  ] as [string, object][]) {
    assert.equal((await call("POST", "/api/products", body)).status, 400, cas);
  }
  const huile = await call("POST", "/api/products", { name: "Huile de coco", price: 0, cost: 0, stock: 0, low_stock_alert: 0 });
  assert.equal(huile.status, 201);
  assert.equal(huile.body.product.low_stock_alert, 0, "un seuil de 0 reste 0 (V1-19, côté serveur)");
  assert.equal((await call("PUT", `/api/products/${huile.body.product.id}`, { stock: -3 })).status, 400);
  assert.equal((await call("PUT", `/api/products/${huile.body.product.id}`, { stock: 8 })).status, 200);
});

test("V1-13 : note de rendez-vous non vide, 2 000 caractères au plus", async (t) => {
  const { db, call } = await setup(t);
  const id = (await call("POST", "/api/appointments", { client_id: 1, staff_id: null, scheduled_date: "2026-10-12", start_time: "10:00", service_ids: [2] })).body.appointment.id as number;
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM appointment_notes WHERE appointment_id = ?").get(id) as { n: number }).n;
  assert.equal((await call("POST", `/api/appointments/${id}/notes`, { content: "" })).status, 400);
  assert.equal((await call("POST", `/api/appointments/${id}/notes`, { content: "    " })).status, 400);
  assert.equal((await call("POST", `/api/appointments/${id}/notes`, { content: "a".repeat(2001) })).status, 400);
  assert.equal(count(), 0);
  assert.equal((await call("POST", `/api/appointments/${id}/notes`, { content: "a".repeat(2000) })).status, 201);
  assert.equal(count(), 1);
});
