import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appointment } from "../types.ts";
import { dayFigures, journee, prochainesNotes, todayGroups, todayRows, weekBounds, weekFigures } from "./accueil.ts";

/** Sous-projet 4 § 5 : règles de l'accueil selon le rôle, vérifiées en exécution. */

const apt = (id: number, patch: Partial<Appointment> = {}): Appointment => ({
  id, identifier: `APT-${id}`, client_id: id, staff_id: 1, status: "booked", scheduled_date: "2026-09-29",
  start_time: "10:00", end_time: "11:00", total_price: 10000, notes: "", is_recurring: 0, recurrence_interval: "",
  created_at: "", updated_at: "", ...patch,
});

test("semaine de l'institut : du lundi au dimanche, en jours aaaa-mm-jj", () => {
  assert.deepEqual(weekBounds("2026-09-29"), { start: "2026-09-28", end: "2026-10-04" }, "mardi");
  assert.deepEqual(weekBounds("2026-09-28"), { start: "2026-09-28", end: "2026-10-04" }, "lundi");
  assert.deepEqual(weekBounds("2026-10-04"), { start: "2026-09-28", end: "2026-10-04" }, "dimanche");
  assert.deepEqual(weekBounds("2026-12-31"), { start: "2026-12-28", end: "2027-01-03" }, "à cheval sur deux années");
});

test("chiffres du jour : total, encore à venir, arrivées attendues, chiffre d'affaires prévu", () => {
  const list = [
    apt(1, { status: "completed", start_time: "08:30", end_time: "09:30", total_price: 25000 }),
    apt(2, { status: "in_progress", start_time: "14:00", end_time: "15:30", total_price: 45000 }),
    apt(3, { status: "confirmed", start_time: "15:30", end_time: "16:00", total_price: 15000 }),
    apt(4, { status: "booked", start_time: "17:30", end_time: "18:15", total_price: 7000 }),
    apt(5, { status: "no_show", start_time: "11:00", end_time: "12:00", total_price: 20000 }),
    apt(6, { status: "cancelled", start_time: "12:00", end_time: "13:00", total_price: 99000 }),
  ];
  assert.deepEqual(dayFigures(list, "2026-09-29", "16:00"), { total: 5, remaining: 1, waiting: 1, plannedRevenue: 92000 });
});

test("chiffres du jour : montants masqués (praticienne) ou rendez-vous d'un autre jour", () => {
  const hidden = [apt(1, { total_price: undefined as unknown as number }), apt(2)];
  assert.equal(dayFigures(hidden, "2026-09-29", "08:00").plannedRevenue, null, "un montant absent : pas de total faux");
  assert.deepEqual(dayFigures([apt(1, { scheduled_date: "2026-09-30" })], "2026-09-29", "08:00"), { total: 0, remaining: 0, waiting: 0, plannedRevenue: 0 });
  assert.deepEqual(dayFigures([], "2026-09-29", "08:00"), { total: 0, remaining: 0, waiting: 0, plannedRevenue: 0 });
});

test("chiffres de la semaine : rendez-vous, terminés, absentes, chiffre d'affaires réalisé", () => {
  const list = [
    apt(1, { status: "completed", total_price: 25000 }),
    apt(2, { status: "completed", scheduled_date: "2026-10-01", total_price: 8000 }),
    apt(3, { status: "no_show" }),
    apt(4, { status: "confirmed" }),
    apt(5, { status: "cancelled", total_price: 50000 }),
  ];
  assert.deepEqual(weekFigures(list), { total: 4, completed: 2, noShow: 1, revenue: 33000 });
  assert.equal(weekFigures([apt(1, { status: "completed", total_price: undefined as unknown as number })]).revenue, null);
});

test("Ma journée : ses rendez-vous du jour dans l'ordre, annulés exclus, état de chaque ligne", () => {
  const list = [
    apt(1, { status: "confirmed", start_time: "17:30", end_time: "18:15" }),
    apt(2, { status: "completed", start_time: "08:30", end_time: "09:30" }),
    apt(3, { status: "in_progress", start_time: "14:00", end_time: "15:30" }),
    apt(4, { status: "booked", start_time: "10:00", end_time: "11:00" }),
    apt(5, { status: "no_show", start_time: "11:00", end_time: "12:00" }),
    apt(6, { status: "cancelled", start_time: "12:00", end_time: "13:00" }),
    apt(7, { staff_id: 2, start_time: "13:00", end_time: "14:00" }),
    apt(8, { scheduled_date: "2026-09-30", start_time: "09:00", end_time: "10:00" }),
  ];
  const day = journee(list, 1, "2026-09-29", "14:30");
  assert.deepEqual(day.rows.map((r) => [r.appointment.id, r.etat]), [[2, "termine"], [4, "passe"], [5, "absente"], [3, "en-cours"], [1, "a-venir"]]);
  assert.equal(day.next?.id, 3, "le soin en cours d'abord (même règle que le « + »)");
  assert.equal(journee(list, 1, "2026-09-29", "16:00").next?.id, 1, "soin en cours qui déborde et rendez-vous suivant : le suivant (décision 6)");
  assert.equal(journee(list, 1, "2026-09-29", "19:00").next?.id, 3, "soin encore en cours après l'heure, plus rien ensuite : « En ce moment », jamais « journée terminée »");
  const finie = list.map((a) => (a.id === 3 ? { ...a, status: "completed" as const } : a));
  assert.equal(journee(finie, 1, "2026-09-29", "19:00").next, null, "journée finie : plus rien en cours ni à venir");
  assert.deepEqual(journee(list, null, "2026-09-29", "14:30"), { rows: [], next: null }, "compte sans fiche de l'équipe");
});

test("Aujourd'hui : rendez-vous du jour par heure, puis par praticienne ; annulés exclus", () => {
  const list = [
    apt(1, { start_time: "10:00", staff_name: "Solange" }),
    apt(2, { start_time: "09:00", staff_name: "Grace" }),
    apt(3, { start_time: "10:00", staff_name: "Brenda" }),
    apt(4, { start_time: "08:00", status: "cancelled" }),
    apt(5, { start_time: "08:00", scheduled_date: "2026-09-30" }),
  ];
  assert.deepEqual(todayRows(list, "2026-09-29").map((a) => a.id), [2, 3, 1]);
});

test("notes du prochain rendez-vous : celles du rendez-vous (récentes d'abord), la réservation, puis la cliente ; vides écartées", () => {
  const notes = [
    { id: 1, appointment_id: 3, content: "Préfère une pression légère", created_at: "2026-09-29 08:00:00" },
    { id: 2, appointment_id: 3, content: "  ", created_at: "2026-09-29 09:00:00" },
    { id: 3, appointment_id: 3, content: "Arrivera avec sa fille", created_at: "2026-09-29 10:00:00" },
  ];
  assert.deepEqual(prochainesNotes({ notes, bookingNote: "Offrir un thé", clientNotes: "Peau sensible" }), [
    { source: "rendez-vous", text: "Arrivera avec sa fille", at: "2026-09-29 10:00:00" },
    { source: "rendez-vous", text: "Préfère une pression légère", at: "2026-09-29 08:00:00" },
    { source: "reservation", text: "Offrir un thé", at: null },
    { source: "cliente", text: "Peau sensible", at: null },
  ]);
  assert.deepEqual(prochainesNotes({ notes: undefined, bookingNote: "", clientNotes: null }), []);
});

test("Aujourd'hui en trois groupes : à traiter (en retard, en cours), à venir, terminés (terminés, absentes), chacun par heure", () => {
  const list = [
    apt(1, { status: "completed", start_time: "08:30", end_time: "09:30", paid: 1 }),
    apt(2, { status: "confirmed", start_time: "15:30", end_time: "16:00", staff_name: "Solange" }),
    apt(3, { status: "in_progress", start_time: "14:00", end_time: "15:30" }),
    apt(4, { status: "booked", start_time: "17:30", end_time: "18:15" }),
    apt(5, { status: "no_show", start_time: "11:00", end_time: "12:00" }),
    apt(6, { status: "cancelled", start_time: "16:30", end_time: "17:00" }),
    apt(7, { status: "booked", start_time: "15:30", end_time: "16:30", staff_name: "Brenda" }),
    apt(8, { status: "booked", start_time: "16:30", end_time: "17:00" }),
  ];
  const groups = todayGroups(list, "2026-09-29", "16:00");
  assert.deepEqual(groups.aTraiter.map((a) => a.id), [3, 7, 2], "en cours et clientes attendues, par heure puis par praticienne");
  assert.deepEqual(groups.aVenir.map((a) => a.id), [8, 4]);
  assert.deepEqual(groups.termines.map((a) => a.id), [1, 5]);
  assert.deepEqual(todayGroups([], "2026-09-29", "16:00"), { aTraiter: [], aEncaisser: [], aVenir: [], termines: [] });
});

test("« À encaisser » (sous-projet 5 § 4.1) : les soins terminés sans facture ; encaissés, ils rejoignent les terminés", () => {
  const list = [
    apt(1, { status: "completed", start_time: "09:00", end_time: "10:00", paid: 0 }),
    apt(2, { status: "completed", start_time: "08:00", end_time: "09:00", paid: 1, invoice_number: "FAC-2026-000001" }),
    apt(3, { status: "no_show", start_time: "11:00", end_time: "12:00", paid: 0 }),
    apt(4, { status: "in_progress", start_time: "14:00", end_time: "15:00", paid: 0 }),
  ];
  const groups = todayGroups(list, "2026-09-29", "14:30");
  assert.deepEqual(groups.aEncaisser.map((a) => a.id), [1]);
  assert.deepEqual(groups.termines.map((a) => a.id), [2, 3]);
  assert.deepEqual(groups.aTraiter.map((a) => a.id), [4], "un soin en cours s'encaisse depuis sa fiche");
});
