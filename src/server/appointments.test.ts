import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t);
  const call = await ctx.as("manager");
  const create = (patch: object = {}) => call("POST", "/api/appointments", {
    client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1], ...patch,
  });
  const update = (id: number, patch: object) => call("PUT", `/api/appointments/${id}`, patch);
  return { db: ctx.db, call, create, update };
}

test("routes reject overlaps, permit adjacent slots, and expose conflicts to agents", async (t) => {
  const { create, call } = await setup(t);
  assert.equal((await create()).status, 201);
  for (const start_time of ["10:00", "10:30", "09:30"]) {
    const rejected = await create({ start_time });
    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.conflicts[0].kind, "appointment");
  }
  assert.equal((await create({ start_time: "11:00" })).status, 201);
  assert.equal((await create({ staff_id: 2 })).status, 201);
  assert.equal((await create({ staff_id: null })).status, 201);
  assert.equal((await create({ scheduled_date: "2026-09-15" })).status, 201);
  const schema = await call("GET", "/api/openapi.json");
  assert.ok(schema.body.paths["/api/appointments"].post.responses[409]);
  assert.ok(schema.body.paths["/api/appointments"].post.responses[400]);
});

test("a deliberate overlap can be edited, checked in, completed, and cancelled", async (t) => {
  const { create, update, db } = await setup(t);
  await create();
  const { body } = await create({ client_id: 2, allow_conflict: true });
  const id = body.appointment.id;
  assert.equal((await update(id, { notes: "Quiet appointment", total_price: 45 })).status, 200);
  for (const status of ["checked_in", "completed", "cancelled"]) {
    assert.equal((await update(id, { status })).status, 200, status);
  }
  assert.equal(db.prepare("SELECT status FROM appointments WHERE id = ?").get(id)?.status, "cancelled");
  assert.equal((await update(id, { status: "booked" })).status, 409, "restoring occupies the slot again");
  assert.equal((await update(id, { status: "booked", allow_conflict: true })).status, 200);
});

test("cancelled bookings do not occupy the chair, even when reassigned", async (t) => {
  const { create, update } = await setup(t);
  const first = await create();
  assert.equal((await update(first.body.appointment.id, { status: "cancelled" })).status, 200);
  assert.equal((await create()).status, 201);
  assert.equal((await create({ staff_id: 2 })).status, 201);
  assert.equal((await update(first.body.appointment.id, { staff_id: 2 })).status, 200);
  assert.equal((await update(first.body.appointment.id, { status: "booked" })).status, 409);
});

test("rescheduling preserves duration and rejects an occupied staff member", async (t) => {
  const { create, update, db } = await setup(t);
  const first = await create();
  const id = first.body.appointment.id;
  assert.equal((await update(id, { start_time: "11:00" })).status, 200);
  assert.equal(db.prepare("SELECT end_time FROM appointments WHERE id = ?").get(id)?.end_time, "12:00");
  await create({ staff_id: 2, start_time: "11:00" });
  assert.equal((await update(id, { staff_id: 2 })).status, 409);
  assert.equal((await update(id, { staff_id: 2, allow_conflict: true })).status, 200);
  assert.equal((await update(9999, { notes: "Missing" })).status, 404);
});

test("blocked time rejects new and moved appointments", async (t) => {
  const { create, update, db } = await setup(t);
  const first = await create(); // also runs the application's seed middleware
  db.prepare("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (1, '2026-09-14', '13:00', '14:00', 'Lunch')").run();
  const blocked = await create({ start_time: "13:00" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.conflicts[0].kind, "blocked");
  assert.equal((await update(first.body.appointment.id, { start_time: "13:00" })).status, 409);
});

test("blocked time must be a valid forward interval", async (t) => {
  const { call, db } = await setup(t);
  const block = (start_time: string, end_time: string) => call("POST", "/api/blocked-slots", {
    staff_id: 1, blocked_date: "2026-09-14", start_time, end_time, reason: "Unavailable",
  });

  assert.equal((await block("12:00", "13:00")).status, 201);
  assert.equal((await block("13:00", "14:00")).status, 201, "adjacent blocks remain valid");
  for (const [start, end] of [["13:00", "12:00"], ["12:00", "12:00"], ["noon", "13:00"]]) {
    assert.equal((await block(start, end)).status, 400, `${start}-${end}`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM blocked_slots").get()?.count, 2);

  const schema = await call("GET", "/api/openapi.json");
  assert.ok(schema.body.paths["/api/blocked-slots"].post.responses[400]);
});

test("blocked time reports every clash and requires an explicit override", async (t) => {
  const { call, create, db } = await setup(t);
  await create({ start_time: "12:30" });
  db.prepare("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (1, '2026-09-14', '12:00', '12:15', 'Break')").run();
  const block = (patch: object = {}) => call("POST", "/api/blocked-slots", {
    staff_id: 1, blocked_date: "2026-09-14", start_time: "12:00", end_time: "13:00", reason: "Closure", ...patch,
  });

  const rejected = await block();
  assert.equal(rejected.status, 409);
  assert.deepEqual(rejected.body.conflicts.map((conflict: { kind: string }) => conflict.kind), ["appointment", "blocked"]);
  assert.match(rejected.body.error, /allow_conflict: true to block over it anyway/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM blocked_slots").get()?.count, 1);

  assert.equal((await block({ allow_conflict: true })).status, 201);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM blocked_slots").get()?.count, 2);

  const schema = await call("GET", "/api/openapi.json");
  assert.ok(schema.body.paths["/api/blocked-slots"].post.responses[409]);
});

test("blocked time may sit directly beside an appointment", async (t) => {
  const { call, create } = await setup(t);
  await create({ start_time: "12:00" });
  const adjacent = await call("POST", "/api/blocked-slots", {
    staff_id: 1, blocked_date: "2026-09-14", start_time: "11:00", end_time: "12:00", reason: "Break",
  });
  assert.equal(adjacent.status, 201);
});

test("rescheduling across dates keeps booking history and moves the calendar entry", async (t) => {
  const { create, update, call, db } = await setup(t);
  const created = await create({ service_ids: [1, 2], notes: "Keep the colour formula" });
  const id = created.body.appointment.id;
  await call("POST", `/api/appointments/${id}/notes`, { content: "Client asked to move" });
  const before = (await call("GET", `/api/appointments/${id}`)).body.appointment;
  const target = { scheduled_date: "2026-09-15", start_time: "14:00" };
  await create({ client_id: 2, ...target });

  assert.equal((await update(id, target)).status, 409);
  assert.deepEqual((await call("GET", `/api/appointments/${id}`)).body.appointment, before);
  assert.equal((await update(id, { ...target, allow_conflict: true })).status, 200);
  const after = (await call("GET", `/api/appointments/${id}`)).body.appointment;
  assert.equal(after.scheduled_date, target.scheduled_date);
  assert.equal(after.start_time, "14:00");
  assert.equal(after.end_time, "15:30");
  for (const field of ["id", "identifier", "client_id", "staff_id", "status", "total_price", "notes", "appointment_services", "appointment_notes", "created_at"]) {
    assert.deepEqual(after[field], before[field], field);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM appointments").get()?.count, 2);
  const oldDay = await call("GET", "/api/calendar?start=2026-09-14&end=2026-09-14");
  const newDay = await call("GET", "/api/calendar?start=2026-09-15&end=2026-09-15");
  assert.equal(oldDay.body.appointments.some((a: { id: number }) => a.id === id), false);
  assert.equal(newDay.body.appointments.find((a: { id: number }) => a.id === id).end_time, "15:30");
});

test("client history summarizes services and the latest service note", async (t) => {
  const { create, call } = await setup(t);
  const created = await create({ service_ids: [1, 2] });
  const id = created.body.appointment.id;
  assert.equal((await call("POST", `/api/appointments/${id}/notes`, { content: "First formula" })).status, 201);
  assert.equal((await call("POST", `/api/appointments/${id}/notes`, { content: "Latest formula" })).status, 201);
  const blank = await create({ service_ids: [], start_time: "12:00" });

  const history = await call("GET", "/api/clients/1");
  assert.equal(history.status, 200);
  const visit = history.body.appointments.find((appointment: { id: number }) => appointment.id === id);
  assert.equal(visit.service_names, "Soin du visage éclat, Massage relaxant du dos");
  assert.equal(visit.latest_note, "Latest formula");
  const blankVisit = history.body.appointments.find((appointment: { id: number }) => appointment.id === blank.body.appointment.id);
  assert.equal(blankVisit.service_names, null);
  assert.equal(blankVisit.latest_note, null);
});

test("invalid times and midnight overflow cannot bypass the guard, even with an override", async (t) => {
  const { create, update, db } = await setup(t);
  for (const start_time of ["", "noon", "09:30garbage", "24:00", "23:30"]) {
    assert.equal((await create({ start_time, allow_conflict: true })).status, 400, start_time);
  }
  assert.equal((await create({ service_ids: [9999] })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM appointments").get()?.count, 0);
  const first = await create();
  assert.equal((await update(first.body.appointment.id, { start_time: "23:30" })).status, 400);
  assert.equal((await update(first.body.appointment.id, { end_time: "09:00" })).status, 400);
  assert.equal((await update(first.body.appointment.id, { end_time: "11:00garbage" })).status, 400);
  assert.equal(db.prepare("SELECT start_time FROM appointments WHERE id = ?").get(first.body.appointment.id)?.start_time, "10:00");
});

test("legacy invalid times do not prevent cancellation or metadata repair", async (t) => {
  const { create, update, db } = await setup(t);
  const first = await create();
  const id = first.body.appointment.id;
  db.prepare("UPDATE appointments SET end_time = start_time WHERE id = ?").run(id);
  assert.equal((await update(id, { notes: "Needs rescheduling" })).status, 200);
  assert.equal((await update(id, { status: "cancelled" })).status, 200);
  assert.equal((await update(id, { status: "booked" })).status, 400);
  assert.equal((await update(id, { status: "booked", end_time: "11:00" })).status, 200);
});

test("la praticienne ne reçoit aucun montant de rendez-vous (chiffre d'affaires non recalculable)", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const created = await gerante("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1] });
  const id = created.body.appointment.id;
  assert.equal((await gerante("PUT", `/api/appointments/${id}`, { status: "completed", total_price: 15000 })).status, 200);
  const praticienne = await ctx.as("practitioner");
  const seen = [
    ...(await praticienne("GET", "/api/appointments?limit=500")).body.appointments,
    (await praticienne("GET", `/api/appointments/${id}`)).body.appointment,
    ...(await praticienne("GET", "/api/calendar?start=2026-09-14&end=2026-09-14")).body.appointments,
    ...(await praticienne("GET", "/api/clients/1")).body.appointments,
  ];
  assert.ok(seen.length >= 4);
  for (const apt of seen) {
    assert.equal("total_price" in apt, false, `total_price visible (rendez-vous ${apt.id})`);
    for (const svc of apt.appointment_services ?? []) assert.equal("price" in svc, false, "prix de prestation visible");
  }
  const reception = await ctx.as("reception");
  assert.equal((await reception("GET", `/api/appointments/${id}`)).body.appointment.total_price, 15000, "la réception garde les prix (encaissement)");
});

// Correctif final (point 1) : la praticienne voit qu'un acompte attend (pour ne pas proposer
// « Encaisser » plein tarif, que le serveur refuserait), sans jamais en recevoir le montant.
test("deposit_held : 1 dès qu'un acompte est en attente, aucun montant pour la praticienne", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", duration: 60, price: 25000 })).body.service.id as number;
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-30", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;

  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.deposit_held, 0, "aucun acompte encore");
  assert.equal((await p("GET", `/api/appointments/${apt}`)).body.appointment.deposit_held, 0);

  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: true })).status, 200);
  const taken = await g("POST", "/api/deposits", { request_id: "acompte-deposit-held-01", appointment_id: apt, amount: 10000, payments: [{ method: "cash", amount: 10000, reference: "" }] });
  assert.equal(taken.status, 201, JSON.stringify(taken.body));

  const single = (await g("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.equal(single.deposit_held, 1);
  const list = (await g("GET", "/api/appointments?limit=500")).body.appointments.find((a: { id: number }) => a.id === apt);
  assert.equal(list.deposit_held, 1);
  const calendar = (await g("GET", "/api/calendar?start=2026-09-30&end=2026-09-30")).body.appointments.find((a: { id: number }) => a.id === apt);
  assert.equal(calendar.deposit_held, 1);

  // La praticienne reçoit le champ (ce n'est pas un montant), jamais celui de l'acompte lui-même.
  const forPractitioner = (await p("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.equal(forPractitioner.deposit_held, 1);
  assert.equal("total_price" in forPractitioner, false);
});

test("rendez-vous : messages en français sur demande, en anglais sans langue indiquée, allow_conflict intact", async (t) => {
  const { call, create } = await setup(t);
  await create();
  const fr = await call("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1] }, { "Accept-Language": "fr-CM,fr;q=0.9" });
  assert.equal(fr.status, 409);
  assert.match(fr.body.error, /a déjà un rendez-vous à 10:00-11:00/);
  assert.match(fr.body.error, /allow_conflict: true pour réserver malgré tout\.$/);
  for (const headers of [{}, { "Accept-Language": "de" }]) {
    const en = await call("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1] }, headers);
    assert.match(en.body.error, /is already booked at 10:00-11:00/);
    assert.match(en.body.error, /send allow_conflict: true to book over it anyway\.$/);
  }
  assert.equal((await call("GET", "/api/appointments/9999", undefined, { "Accept-Language": "fr" })).body.error, "Introuvable");
  assert.equal((await call("GET", "/api/appointments/9999")).body.error, "Not found");
  assert.equal((await call("POST", "/api/appointments", { client_id: 1, scheduled_date: "2026-09-14", start_time: "9h", service_ids: [1] }, { "Accept-Language": "fr" })).body.error, "Les heures doivent être au format HH:MM");
});

test("date et heure mal formées (création ou déplacement) : refusées (400 bilingue), jamais un rendez-vous écrit ou changé", async (t) => {
  const { create, update, call, db } = await setup(t);
  const fr = { "Accept-Language": "fr" };
  const base = { client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1] };
  assert.equal((await create({ scheduled_date: "05/10/2026" })).status, 400, "date au format jj/mm/aaaa");
  assert.equal((await call("POST", "/api/appointments", { ...base, scheduled_date: "05/10/2026" }, fr)).body.error, "Date attendue au format aaaa-mm-jj.");
  assert.equal((await create({ start_time: "9:30" })).status, 400, "heure à un seul chiffre");
  assert.equal((await call("POST", "/api/appointments", { ...base, start_time: "9:30" }, fr)).body.error, "Les heures doivent être au format HH:MM");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n, 0, "aucun rendez-vous écrit");

  const id = (await create()).body.appointment.id as number;
  const field = () => db.prepare("SELECT scheduled_date, start_time, end_time FROM appointments WHERE id = ?").get(id);
  const before = field();
  assert.equal((await update(id, { scheduled_date: "05/10/2026" })).status, 400);
  assert.equal((await update(id, { start_time: "9:30" })).status, 400);
  assert.equal((await update(id, { end_time: "9:30" })).status, 400);
  assert.deepEqual(field(), before, "rendez-vous inchangé après les trois refus");
});

test("créneau bloqué sans motif : libellé vide (composé par l'écran), message d'erreur dans la langue de la requête", async (t) => {
  const { call, db } = await setup(t);
  db.prepare("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (1, '2026-09-14', '10:00', '11:00', '')").run();
  const fr = await call("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1] }, { "Accept-Language": "fr" });
  assert.equal(fr.body.conflicts[0].label, "");
  assert.match(fr.body.error, /10:00-11:00 \(bloqué\)/);
  const en = await call("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-14", start_time: "10:00", service_ids: [1] });
  assert.equal(en.body.conflicts[0].label, "");
  assert.match(en.body.error, /10:00-11:00 \(blocked\)/);
});
