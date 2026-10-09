import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type TestApp } from "./test-support.ts";

/** Routes du transfert groupé (spec du 04/10/2026) : proposition, tout ou rien, notes, journal, message. Horloge : lundi 28/09, 09:00 à Douala. */

const DAY_MS = 86_400_000;

async function scene(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  ctx.db.exec(`INSERT INTO staff (id, name, color) VALUES (1, 'Solange Ekambi', '#4A5D73'), (2, 'Grace Nkeng', '#4F6552'), (3, 'Mireille Fotso', '#6B4660');
    INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456'), (2, 'Ngozi Tabi', '655234503');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Tresses', 'Braids', 60, 10000);
    INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', '"Institut Ébène"', 0, 0);`);
  const reception = await ctx.as("reception");
  ctx.db.exec("UPDATE accounts SET display_name = 'Mireille' WHERE login = 'reception'");
  let seq = 0;
  const book = (staffId: number, date: string, start: string, end: string, client = 1): number => {
    const id = Number(ctx.db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time, booked_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(`APT-${++seq}`, client, staffId, date, start, end, ctx.clock.now - DAY_MS).lastInsertRowid);
    ctx.db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, 1, 10000, 60)").run(id);
    return id;
  };
  return { ctx, reception, book };
}

const staffOf = (ctx: TestApp, id: number) => (ctx.db.prepare("SELECT staff_id FROM appointments WHERE id = ?").get(id) as { staff_id: number }).staff_id;
const notes = (ctx: TestApp, id: number) =>
  (ctx.db.prepare("SELECT content FROM appointment_notes WHERE appointment_id = ? ORDER BY id").all(id) as { content: string }[]).map((n) => n.content);
const outbox = (ctx: TestApp) => ctx.db.prepare("SELECT dedupe_key, payload FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { dedupe_key: string; payload: string }[];
const audit = (ctx: TestApp) =>
  (ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'rdv.transfert' ORDER BY id").all() as { action: string; target: string }[]).map((r) => ({ ...r }));
const FR = { "Accept-Language": "fr" };

test("proposition par l'API : rendez-vous de la praticienne aujourd'hui par défaut, collègue proposée, collègues actives ; période et praticienne contrôlées", async (t) => {
  const { reception, book } = await scene(t);
  const a = book(1, "2026-09-28", "10:00", "11:00");
  book(1, "2026-09-29", "10:00", "11:00");
  const r = await reception("GET", "/api/transfers/proposal?staff_id=1");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.from, { id: 1, name: "Solange Ekambi" });
  assert.deepEqual(r.body.staff.map((s: { name: string }) => s.name), ["Grace Nkeng", "Mireille Fotso"]);
  assert.deepEqual(
    r.body.appointments.map((x: Record<string, unknown>) => [x.id, x.identifier, x.date, x.start_time, x.end_time, x.client_name, x.proposed_staff_id, x.free_staff_ids]),
    [[a, "APT-1", "2026-09-28", "10:00", "11:00", "Aïcha Mbarga", 2, [2, 3]]],
  );
  const period = await reception("GET", "/api/transfers/proposal?staff_id=1&from=2026-09-30&to=2026-09-29", undefined, FR);
  assert.equal(period.status, 400);
  assert.equal(period.body.error, "Période invalide\u00a0: une date de début et une date de fin (aaaa-mm-jj), dans l'ordre, 31 jours au plus.");
  const unknown = await reception("GET", "/api/transfers/proposal?staff_id=99", undefined, FR);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, "Praticienne introuvable.");
  assert.equal((await reception("GET", "/api/transfers/proposal")).status, 400);
});

test("transfert : tout passe d'un coup, note sur chaque rendez-vous, une ligne au journal, message « transfert » quand la case est cochée", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const b = book(1, "2026-09-29", "14:00", "15:00", 2);
  const r = await reception("POST", "/api/transfers", { from_staff_id: 1, notify: true, moves: [{ appointment_id: a, staff_id: 2 }, { appointment_id: b, staff_id: 3 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { moved: 2 });
  assert.deepEqual([staffOf(ctx, a), staffOf(ctx, b)], [2, 3]);
  assert.deepEqual(notes(ctx, a), ["Transféré de Solange Ekambi à Grace Nkeng le 28/09/2026 par Mireille."]);
  assert.deepEqual(notes(ctx, b), ["Transféré de Solange Ekambi à Mireille Fotso le 28/09/2026 par Mireille."]);
  assert.deepEqual(audit(ctx), [{ action: "rdv.transfert", target: "Solange Ekambi → 2 rendez-vous" }]);
  const rows = outbox(ctx);
  assert.deepEqual(rows.map((m) => m.dedupe_key), [
    `wa:transfert:${a}:2:2026-09-29 10:00:${ctx.clock.now}`,
    `wa:transfert:${b}:3:2026-09-29 14:00:${ctx.clock.now}`,
  ]);
  const payload = JSON.parse(rows[0].payload);
  assert.equal(payload.text, "Bonjour Aïcha, votre rendez-vous Tresses du mardi 29 septembre à 10:00 chez Institut Ébène sera assuré par Grace.");
  assert.deepEqual(payload.origin, { type: "transfert", appointmentId: a, clientId: 1, at: Date.parse("2026-09-29T09:00:00Z"), staffId: 2 });
  // Décision 9 : date, heure, durée, statut et prise du rendez-vous inchangés.
  const row = ctx.db.prepare("SELECT scheduled_date, start_time, end_time, status, booked_at FROM appointments WHERE id = ?").get(a) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { scheduled_date: "2026-09-29", start_time: "10:00", end_time: "11:00", status: "booked", booked_at: ctx.clock.now - DAY_MS });
});

test("case décochée : transfert, note et journal, aucun message", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  assert.equal((await reception("POST", "/api/transfers", { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }] })).status, 200);
  assert.equal(staffOf(ctx, a), 2);
  assert.equal(notes(ctx, a).length, 1);
  assert.equal(audit(ctx).length, 1);
  assert.equal(outbox(ctx).length, 0);
});

test("tout ou rien : un créneau pris entre-temps, rien n'est écrit, 409 lisible", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const b = book(1, "2026-09-29", "14:00", "15:00");
  book(3, "2026-09-29", "14:30", "15:30"); // pris chez Mireille après la proposition
  const r = await reception("POST", "/api/transfers", { from_staff_id: 1, notify: true, moves: [{ appointment_id: a, staff_id: 2 }, { appointment_id: b, staff_id: 3 }] }, FR);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "Rien n'a été transféré\u00a0: l'agenda a changé entre-temps.");
  assert.deepEqual(r.body.conflicts, [{ appointment_id: b, identifier: "APT-2", reason: "APT-2\u00a0: Mireille Fotso n'est pas libre de 14:00 à 15:00." }]);
  assert.equal(staffOf(ctx, a), 1, "le mouvement valable n'est pas écrit non plus");
  assert.deepEqual(notes(ctx, a), []);
  assert.equal(outbox(ctx).length, 0);
  assert.deepEqual(audit(ctx), []);
});

test("deux réceptions qui transfèrent en même temps vers la même collègue : une seule passe, jamais deux rendez-vous qui se chevauchent", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const gerante = await ctx.as("manager");
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const b = book(3, "2026-09-29", "10:30", "11:30", 2);
  const [first, second] = await Promise.all([
    reception("POST", "/api/transfers", { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }] }),
    gerante("POST", "/api/transfers", { from_staff_id: 3, notify: false, moves: [{ appointment_id: b, staff_id: 2 }] }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const atGrace = ctx.db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE staff_id = 2").get() as { n: number };
  assert.equal(atGrace.n, 1);
  assert.equal(audit(ctx).length, 1);
});

test("collègue désactivée entre la proposition et la validation : refus, rien d'écrit ; la proposition rechargée ne la propose plus", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const before = await reception("GET", "/api/transfers/proposal?staff_id=1&from=2026-09-29");
  assert.equal(before.body.appointments[0].proposed_staff_id, 2);
  ctx.db.exec("UPDATE staff SET active = 0 WHERE id = 2");
  const r = await reception("POST", "/api/transfers", { from_staff_id: 1, notify: true, moves: [{ appointment_id: a, staff_id: 2 }] }, FR);
  assert.equal(r.status, 409);
  assert.equal(r.body.conflicts[0].reason, "APT-1\u00a0: Grace Nkeng n'est plus active dans l'équipe.");
  assert.equal(staffOf(ctx, a), 1);
  const after = await reception("GET", "/api/transfers/proposal?staff_id=1&from=2026-09-29");
  assert.equal(after.body.appointments[0].proposed_staff_id, 3);
  assert.deepEqual(after.body.staff.map((s: { id: number }) => s.id), [3]);
});

test("période à cheval sur aujourd'hui : le rendez-vous qui commence entre la proposition et la validation est refusé, rien d'écrit", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-28", "09:30", "10:30");
  const b = book(1, "2026-09-29", "09:30", "10:30");
  const p = await reception("GET", "/api/transfers/proposal?staff_id=1&from=2026-09-28&to=2026-09-29");
  assert.deepEqual(p.body.appointments.map((x: { id: number }) => x.id), [a, b]);
  ctx.clock.now = Date.parse("2026-09-28T08:45:00Z"); // 09:45 à Douala : APT-1 a commencé
  const r = await reception("POST", "/api/transfers", { from_staff_id: 1, notify: true, moves: [{ appointment_id: a, staff_id: 2 }, { appointment_id: b, staff_id: 2 }] }, FR);
  assert.equal(r.status, 409);
  assert.deepEqual(r.body.conflicts.map((c: { reason: string }) => c.reason), ["APT-1\u00a0: rendez-vous déjà commencé."]);
  assert.equal(staffOf(ctx, b), 1);
  const again = await reception("GET", "/api/transfers/proposal?staff_id=1&from=2026-09-28&to=2026-09-29");
  assert.deepEqual(again.body.appointments.map((x: { id: number }) => x.id), [b]);
});

test("rejeu : un transfert déjà fait est accepté sans nouvelle note, nouveau message ni nouvelle ligne au journal", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const body = { from_staff_id: 1, notify: true, moves: [{ appointment_id: a, staff_id: 2 }] };
  assert.deepEqual((await reception("POST", "/api/transfers", body)).body, { moved: 1 });
  const replay = await reception("POST", "/api/transfers", body);
  assert.equal(replay.status, 200);
  assert.deepEqual(replay.body, { moved: 0 });
  assert.equal(notes(ctx, a).length, 1);
  assert.equal(outbox(ctx).length, 1);
  assert.equal(audit(ctx).length, 1);
});

test("message en file puis rendez-vous retransféré : le premier message est sans objet, seul le second reste à envoyer", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  assert.equal((await reception("POST", "/api/transfers", { from_staff_id: 1, notify: true, moves: [{ appointment_id: a, staff_id: 2 }] })).status, 200);
  ctx.clock.now += 60_000;
  assert.equal((await reception("POST", "/api/transfers", { from_staff_id: 2, notify: true, moves: [{ appointment_id: a, staff_id: 3 }] })).status, 200);
  assert.equal(outbox(ctx).length, 2);
  ctx.db.exec("UPDATE outbox SET status = 'failed', last_error = '@whatsapp.sans_fournisseur'");
  const items = (await reception("GET", "/api/whatsapp/manual")).body.items as { type: string; text: string }[];
  assert.deepEqual(items.map((i) => [i.type, i.text]), [
    ["transfert", "Bonjour Aïcha, votre rendez-vous Tresses du mardi 29 septembre à 10:00 chez Institut Ébène sera assuré par Mireille."],
  ]);
  assert.deepEqual(notes(ctx, a), [
    "Transféré de Solange Ekambi à Grace Nkeng le 28/09/2026 par Mireille.",
    "Transféré de Grace Nkeng à Mireille Fotso le 28/09/2026 par Mireille.",
  ]);
});

test("droits : gérante et réception ; ni la praticienne ni l'administrateur ; corps illisible refusé", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const body = { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }] };
  for (const role of ["practitioner", "admin"] as const) {
    const caller = await ctx.as(role);
    assert.equal((await caller("GET", "/api/transfers/proposal?staff_id=1")).status, 403, role);
    assert.equal((await caller("POST", "/api/transfers", body)).status, 403, role);
  }
  assert.equal(staffOf(ctx, a), 1);
  const bad = await reception("POST", "/api/transfers", { from_staff_id: 1, moves: [] }, FR);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^Transfert illisible\u00a0:/);
  assert.equal((await reception("POST", "/api/transfers", { from_staff_id: 99, notify: false, moves: [{ appointment_id: a, staff_id: 2 }] })).status, 404);
  assert.equal((await (await ctx.as("manager"))("POST", "/api/transfers", body)).status, 200);
});

test("journal groupé : singulier et pluriel, en français et en anglais", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const b = book(1, "2026-09-29", "14:00", "15:00", 2);
  await reception("POST", "/api/transfers", { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }] });
  ctx.db.exec("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.langue', '\"en\"', 0, 0)");
  await reception("POST", "/api/transfers", { from_staff_id: 1, notify: false, moves: [{ appointment_id: b, staff_id: 2 }] });
  const c = book(2, "2026-09-30", "10:00", "11:00");
  const d = book(2, "2026-09-30", "14:00", "15:00", 2);
  await reception("POST", "/api/transfers", { from_staff_id: 2, notify: false, moves: [{ appointment_id: c, staff_id: 3 }, { appointment_id: d, staff_id: 3 }] });
  assert.deepEqual(audit(ctx).map((x) => x.target), ["Solange Ekambi → 1 rendez-vous", "Solange Ekambi → 1 appointment", "Grace Nkeng → 2 appointments"]);
});

test("collègue supprimée entre la proposition et la validation : refus lisible, avec la référence", async (t) => {
  const { ctx, reception, book } = await scene(t);
  const a = book(1, "2026-09-29", "10:00", "11:00");
  const r = await reception("POST", "/api/transfers", { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 99 }] });
  assert.equal(r.status, 409);
  assert.deepEqual((r.body.conflicts as { reason: string }[]).map((x) => x.reason), ["APT-1: the chosen colleague no longer exists."]);
  assert.equal(staffOf(ctx, a), 1);
});
