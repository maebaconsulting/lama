import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

/** V1-01 : chevauchement et numéro APT contrôlés dans la transaction d'écriture. */
async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t);
  const call = await ctx.as("manager");
  const create = (patch: object = {}) => call("POST", "/api/appointments", {
    client_id: 1, staff_id: 1, scheduled_date: "2026-11-02", start_time: "10:00", service_ids: [1], ...patch,
  });
  const number = (identifier: string) => Number(identifier.split("-").pop());
  return { ...ctx, call, create, number };
}

test("deux créations simultanées sur le même créneau : une 201, une 409, jamais une 500", async (t) => {
  const { create, db } = await setup(t);
  const replies = await Promise.all([create(), create()]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
  const refused = replies.find((r) => r.status === 409)!;
  assert.equal(refused.body.conflicts[0].kind, "appointment");
  const n = db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE staff_id = 1 AND scheduled_date = '2026-11-02' AND status != 'cancelled'").get() as { n: number };
  assert.equal(n.n, 1);
});

test("deux créations simultanées sur deux praticiennes : deux numéros distincts", async (t) => {
  const { create } = await setup(t);
  const [a, b] = await Promise.all([create({ start_time: "14:00" }), create({ staff_id: 2, start_time: "14:00" })]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.appointment.identifier, b.body.appointment.identifier);
});

test("un refus 409 ne consomme aucun numéro : la création suivante a le numéro consécutif", async (t) => {
  const { create, number } = await setup(t);
  const first = await create();
  assert.equal(first.status, 201);
  assert.equal((await create()).status, 409);
  const next = await create({ start_time: "11:00" });
  assert.equal(next.status, 201);
  assert.equal(number(next.body.appointment.identifier), number(first.body.appointment.identifier) + 1);
});

test("deux déplacements simultanés vers le même créneau : un 200, un 409", async (t) => {
  const { create, call } = await setup(t);
  const a = await create({ start_time: "08:00" });
  const b = await create({ start_time: "15:00" });
  const replies = await Promise.all([
    call("PUT", `/api/appointments/${a.body.appointment.id}`, { start_time: "12:00" }),
    call("PUT", `/api/appointments/${b.body.appointment.id}`, { start_time: "12:00" }),
  ]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
});

test("un déplacement sur son propre créneau ne se gêne pas lui-même", async (t) => {
  const { create, call } = await setup(t);
  const a = await create();
  assert.equal((await call("PUT", `/api/appointments/${a.body.appointment.id}`, { start_time: "10:30" })).status, 200);
});

/** Restes de la V 1.0, point 4 : le créneau bloqué contrôle et écrit dans la même transaction. */
const block = (patch: object = {}) => ({
  staff_id: 1, blocked_date: "2026-11-02", start_time: "10:00", end_time: "11:00", reason: "Pause", ...patch,
});

test("deux blocages simultanés sur le même créneau : un 201, un 409", async (t) => {
  const { call, db } = await setup(t);
  const replies = await Promise.all([call("POST", "/api/blocked-slots", block()), call("POST", "/api/blocked-slots", block())]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
  const refused = replies.find((r) => r.status === 409)!;
  assert.equal(refused.body.conflicts[0].kind, "blocked");
  const n = db.prepare("SELECT COUNT(*) AS n FROM blocked_slots WHERE staff_id = 1 AND blocked_date = '2026-11-02'").get() as { n: number };
  assert.equal(n.n, 1);
});

test("un blocage et un rendez-vous simultanés sur le même créneau : jamais de chevauchement", async (t) => {
  const { call, create, db } = await setup(t);
  const replies = await Promise.all([call("POST", "/api/blocked-slots", block()), create()]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [201, 409]);
  const appts = (db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE staff_id = 1 AND scheduled_date = '2026-11-02' AND status != 'cancelled'").get() as { n: number }).n;
  const blocks = (db.prepare("SELECT COUNT(*) AS n FROM blocked_slots WHERE staff_id = 1 AND blocked_date = '2026-11-02'").get() as { n: number }).n;
  assert.equal(appts + blocks, 1);
});

test("allow_conflict garde son effet : deux blocages simultanés acceptés", async (t) => {
  const { call } = await setup(t);
  const replies = await Promise.all([
    call("POST", "/api/blocked-slots", block({ allow_conflict: true })),
    call("POST", "/api/blocked-slots", block({ allow_conflict: true })),
  ]);
  assert.deepEqual(replies.map((r) => r.status), [201, 201]);
});
