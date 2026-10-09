import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./storage.ts";
import { runMigrations } from "./migrations.ts";
import { decode } from "./messages.ts";
import { checkTransfer, readPeriod, transferInput, transferProposal, writeTransfers } from "./transferts.ts";
import type { MessageSettings } from "./whatsapp/rendez-vous.ts";

/** Transfert des rendez-vous (spec du 04/10/2026) : période, rendez-vous concernés, proposition, contrôle d'un envoi. */

const NOW = Date.parse("2026-09-28T08:00:00Z"); // lundi 28/09, 09:00 à Douala

type Db = ReturnType<typeof openDatabase>;
let seq = 0;

/** Solange absente ; Grace et Mireille actives ; Brenda désactivée (elle passerait première dans l'ordre de l'équipe). */
function base(): Db {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.exec(`INSERT INTO staff (id, name, color, active) VALUES (1, 'Solange Ekambi', '#4A5D73', 1), (2, 'Grace Nkeng', '#4F6552', 1),
             (3, 'Mireille Fotso', '#6B4660', 1), (4, 'Brenda Tchoua', '#2F5D62', 0);
           INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456'), (2, 'Ngozi Tabi', '655234503');
           INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Tresses', 'Braids', 60, 10000);`);
  return db;
}

function book(db: Db, staffId: number, date: string, start: string, end: string, status = "booked", client = 1): number {
  const result = db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, status, scheduled_date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(`APT-${++seq}`, client, staffId, status, date, start, end);
  const id = Number(result.lastInsertRowid);
  db.prepare("INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (?, 1, 10000, 60)").run(id);
  return id;
}

const ref = (db: Db, id: number) => (db.prepare("SELECT identifier FROM appointments WHERE id = ?").get(id) as { identifier: string }).identifier;

test("période : aujourd'hui à Douala par défaut, « au » égal à « du » s'il manque, 31 jours au plus, jours réels seulement", () => {
  assert.deepEqual(readPeriod(undefined, undefined, NOW), { from: "2026-09-28", to: "2026-09-28" });
  assert.deepEqual(readPeriod("2026-09-29", undefined, NOW), { from: "2026-09-29", to: "2026-09-29" });
  assert.deepEqual(readPeriod("2026-09-28", "2026-10-28", NOW), { from: "2026-09-28", to: "2026-10-28" }, "31 jours");
  assert.deepEqual(readPeriod("2026-09-28", "2026-10-29", NOW), { error: "transfert.periode" }, "32 jours");
  assert.deepEqual(readPeriod("2026-09-30", "2026-09-29", NOW), { error: "transfert.periode" }, "au avant du");
  assert.deepEqual(readPeriod("28/09/2026", undefined, NOW), { error: "transfert.periode" });
  assert.deepEqual(readPeriod("2026-02-31", undefined, NOW), { error: "transfert.periode" }, "le 31 février n'existe pas");
  // 23:30 UTC le 28 = 00:30 le 29 à Douala.
  assert.deepEqual(readPeriod(undefined, undefined, Date.parse("2026-09-28T23:30:00Z")), { from: "2026-09-29", to: "2026-09-29" });
});

test("rendez-vous concernés : réservés ou confirmés, pas encore commencés (heure de Douala), dans la période ; collègues actives seulement", () => {
  const db = base();
  const started = book(db, 1, "2026-09-28", "08:30", "09:30");
  const atNow = book(db, 1, "2026-09-28", "09:00", "10:00");
  const later = book(db, 1, "2026-09-28", "10:00", "11:00", "confirmed");
  book(db, 1, "2026-09-28", "11:00", "12:00", "in_progress");
  book(db, 1, "2026-09-28", "12:00", "13:00", "cancelled");
  book(db, 1, "2026-09-28", "13:00", "14:00", "no_show");
  book(db, 1, "2026-09-28", "14:00", "15:00", "completed");
  book(db, 2, "2026-09-28", "15:00", "16:00");
  const tomorrow = book(db, 1, "2026-09-29", "09:00", "10:00");
  book(db, 1, "2026-09-30", "09:00", "10:00");
  const p = transferProposal(db, 1, { from: "2026-09-28", to: "2026-09-29" }, NOW)!;
  assert.deepEqual(p.appointments.map((a) => a.id), [later, tomorrow]);
  assert.ok(!p.appointments.some((a) => a.id === started || a.id === atNow), "commencé à 08:30 ou à 09:00 pile : ne bouge pas");
  assert.deepEqual(p.from, { id: 1, name: "Solange Ekambi" });
  assert.deepEqual(p.staff, [{ id: 2, name: "Grace Nkeng", color: "#4F6552" }, { id: 3, name: "Mireille Fotso", color: "#6B4660" }], "Brenda désactivée, Solange absente");
  const [first] = p.appointments;
  assert.deepEqual(
    { id: first.id, date: first.date, start_time: first.start_time, end_time: first.end_time, client_name: first.client_name, services: first.services },
    { id: later, date: "2026-09-28", start_time: "10:00", end_time: "11:00", client_name: "Aïcha Mbarga", services: [{ name: "Tresses", name_en: "Braids" }] },
  );
  assert.equal(transferProposal(db, 99, { from: "2026-09-28", to: "2026-09-28" }, NOW), null, "praticienne inconnue");
});

test("proposition : collègue libre la moins chargée ce jour-là, à égalité l'ordre de l'équipe ; créneaux bloqués ; propositions qui ne se chevauchent pas", () => {
  const db = base();
  // Mardi : Grace a déjà deux rendez-vous, Mireille un seul.
  book(db, 2, "2026-09-29", "08:00", "09:00");
  book(db, 2, "2026-09-29", "15:00", "16:00");
  book(db, 3, "2026-09-29", "16:00", "17:00");
  const a = book(db, 1, "2026-09-29", "10:00", "11:00");
  const b = book(db, 1, "2026-09-29", "10:30", "11:30");
  const c = book(db, 1, "2026-09-29", "12:00", "13:00");
  db.exec("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (3, '2026-09-29', '12:00', '14:00', 'Déjeuner')");
  const p = transferProposal(db, 1, { from: "2026-09-29", to: "2026-09-29" }, NOW)!;
  const row = (id: number) => p.appointments.find((r) => r.id === id)!;
  assert.equal(row(a).proposed_staff_id, 3, "Mireille : un rendez-vous ce jour-là contre deux");
  assert.equal(row(b).proposed_staff_id, 2, "Mireille déjà proposée à 10:00 dans la même fenêtre : Grace");
  assert.deepEqual(row(b).free_staff_ids, [2, 3], "libres d'après la base : la proposition voisine n'y compte pas");
  assert.equal(row(c).proposed_staff_id, 2, "Mireille bloquée de 12:00 à 14:00");
  assert.deepEqual(row(c).free_staff_ids, [2]);
  // Mercredi : personne n'a de rendez-vous, égalité : Grace, première dans l'ordre de l'équipe.
  const d = book(db, 1, "2026-09-30", "10:00", "11:00");
  const tie = transferProposal(db, 1, { from: "2026-09-30", to: "2026-09-30" }, NOW)!;
  assert.equal(tie.appointments.find((r) => r.id === d)!.proposed_staff_id, 2);
});

test("sans collègue libre : rien de proposé, le rendez-vous reste « à replacer »", () => {
  const db = base();
  book(db, 2, "2026-09-29", "10:00", "11:00");
  book(db, 3, "2026-09-29", "10:00", "11:00");
  const a = book(db, 1, "2026-09-29", "10:30", "11:00");
  const p = transferProposal(db, 1, { from: "2026-09-29", to: "2026-09-29" }, NOW)!;
  assert.deepEqual(p.appointments.map((r) => [r.id, r.proposed_staff_id, r.free_staff_ids]), [[a, null, []]]);
});

test("corps de l'envoi : forme contrôlée, même praticienne et doublon refusés", () => {
  const good = { from_staff_id: 1, moves: [{ appointment_id: 5, staff_id: 2 }], notify: true };
  assert.deepEqual(transferInput(good), good);
  const bad: Record<string, unknown>[] = [
    {},
    { from_staff_id: 1, moves: [], notify: true },
    { from_staff_id: 1, moves: [{ appointment_id: 5, staff_id: 2 }] },
    { from_staff_id: "1", moves: [{ appointment_id: 5, staff_id: 2 }], notify: false },
    { from_staff_id: 1, moves: [null], notify: false },
    { from_staff_id: 1, moves: [{ appointment_id: 5.5, staff_id: 2 }], notify: false },
    { from_staff_id: 1, moves: Array.from({ length: 501 }, (_, i) => ({ appointment_id: i + 1, staff_id: 2 })), notify: false },
  ];
  for (const body of bad) assert.deepEqual(transferInput(body), { error: "@transfert.corps" }, JSON.stringify(body).slice(0, 80));
  assert.deepEqual(transferInput({ from_staff_id: 1, moves: [{ appointment_id: 5, staff_id: 1 }], notify: false }), { error: "@transfert.meme_praticienne" });
  assert.deepEqual(
    transferInput({ from_staff_id: 1, moves: [{ appointment_id: 5, staff_id: 2 }, { appointment_id: 5, staff_id: 3 }], notify: false }),
    { error: "@transfert.doublon" },
  );
});

test("contrôle : tout est refusé ensemble, chaque raison lisible ; collègue désactivée entre la proposition et la validation", () => {
  const db = base();
  const ok = book(db, 1, "2026-09-29", "09:00", "10:00");
  const started = book(db, 1, "2026-09-28", "08:30", "09:30");
  const done = book(db, 1, "2026-09-29", "11:00", "12:00", "completed");
  const other = book(db, 3, "2026-09-29", "13:00", "14:00");
  const proposal = transferProposal(db, 1, { from: "2026-09-29", to: "2026-09-29" }, NOW)!;
  assert.equal(proposal.appointments.find((r) => r.id === ok)!.proposed_staff_id, 2);
  db.exec("UPDATE staff SET active = 0 WHERE id = 2");
  const result = checkTransfer(db, {
    from_staff_id: 1, notify: true,
    moves: [
      { appointment_id: ok, staff_id: 2 }, { appointment_id: started, staff_id: 3 }, { appointment_id: done, staff_id: 3 },
      { appointment_id: other, staff_id: 2 }, { appointment_id: 9999, staff_id: 3 },
    ],
  }, NOW);
  assert.ok("conflicts" in result);
  assert.deepEqual(result.conflicts.map((c) => decode("fr", c.reason)), [
    `${ref(db, ok)}\u00a0: Grace Nkeng n'est plus active dans l'équipe.`,
    `${ref(db, started)}\u00a0: rendez-vous déjà commencé.`,
    `${ref(db, done)}\u00a0: rendez-vous en cours, terminé, annulé ou absente.`,
    `${ref(db, other)} n'est plus à Solange Ekambi.`,
    "9999\u00a0: rendez-vous introuvable.",
  ]);
  assert.deepEqual(result.conflicts.map((c) => c.appointment_id), [ok, started, done, other, 9999]);
  assert.equal(decode("en", result.conflicts[0].reason), `${ref(db, ok)}: Grace Nkeng is no longer active in the team.`);
});

test("contrôle : les mouvements d'un même envoi comptent entre eux ; un rejeu est accepté sans rien réécrire", () => {
  const db = base();
  const a = book(db, 1, "2026-09-29", "10:00", "11:00");
  const b = book(db, 1, "2026-09-29", "10:30", "11:30");
  const both = checkTransfer(db, { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }, { appointment_id: b, staff_id: 2 }] }, NOW);
  assert.ok("conflicts" in both);
  assert.deepEqual(both.conflicts.map((c) => decode("fr", c.reason)), [
    `${ref(db, a)}\u00a0: Grace Nkeng n'est pas libre de 10:00 à 11:00.`,
    `${ref(db, b)}\u00a0: Grace Nkeng n'est pas libre de 10:30 à 11:30.`,
  ]);
  db.exec(`UPDATE appointments SET staff_id = 2 WHERE id = ${a}`); // premier envoi déjà écrit, réponse perdue
  const replay = checkTransfer(db, { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }, { appointment_id: b, staff_id: 3 }] }, NOW);
  assert.ok("moves" in replay);
  assert.deepEqual(replay.moves.map((m) => [m.appointment_id, m.replay, m.staff_name]), [[a, true, "Grace Nkeng"], [b, false, "Mireille Fotso"]]);
  const clash = checkTransfer(db, { from_staff_id: 1, notify: false, moves: [{ appointment_id: a, staff_id: 2 }, { appointment_id: b, staff_id: 2 }] }, NOW);
  assert.ok("conflicts" in clash);
  assert.deepEqual(clash.conflicts.map((c) => c.appointment_id), [b], "Grace a désormais le rendez-vous rejoué de 10:00 à 11:00");
});

test("writeTransfers : ne compte que les messages réellement mis en file (cliente en « Aucun » : zéro, donc pas de signal)", () => {
  const db = base();
  const text = { fr: "Bonjour {prenom}, avec {praticienne}.", en: "Hello {prenom}, with {praticienne}." };
  const settings = {
    lang: "fr", institut: "Ébène", telephone: "", indicatif: "237", silenceStart: "", silenceEnd: "", reminderHours: 24,
    texts: { transfert: text, confirmation: text, rappel: text },
  } as unknown as MessageSettings;
  const opts = { fromName: "Solange Ekambi", by: "Mireille", notify: true, settings, now: NOW };
  const a = book(db, 1, "2026-09-29", "10:00", "11:00");
  db.prepare("UPDATE clients SET channel = 'none' WHERE id = 1").run();
  const move = (id: number, client: number) => ({ appointment_id: id, staff_id: 2, replay: false, identifier: "x", date: "2026-09-29", start_time: "10:00", end_time: "11:00", staff_name: "Grace Nkeng", client });
  assert.deepEqual(writeTransfers(db, [move(a, 1)], opts), { moved: 1, queued: 0 });
  const b = book(db, 1, "2026-09-29", "14:00", "15:00", "booked", 2);
  assert.deepEqual(writeTransfers(db, [move(b, 2)], opts), { moved: 1, queued: 1 });
  const c = book(db, 1, "2026-09-30", "14:00", "15:00", "booked", 2);
  assert.deepEqual(writeTransfers(db, [move(c, 2)], { ...opts, notify: false }), { moved: 1, queued: 0 });
});
