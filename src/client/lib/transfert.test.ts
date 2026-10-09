import assert from "node:assert/strict";
import { test } from "node:test";
import { translatePlural } from "../i18n/translate.ts";
import { busyChoices, clampTo, initialChoices, lastDay, staffOptions, startDay, toReplace, transferBody, transferCount, type ProposalRow, type ProposalStaff } from "./transfert.ts";

/** Fenêtre « Transférer des rendez-vous » (spec du 04/10/2026, § 2) : logique pure. */

const STAFF: ProposalStaff[] = [{ id: 2, name: "Grace Nkeng", color: "#4F6552" }, { id: 3, name: "Mireille Fotso", color: "#6B4660" }];
const row = (id: number, date: string, start: string, end: string, proposed: number | null, free: number[]): ProposalRow => ({
  id, identifier: `APT-${id}`, date, start_time: start, end_time: end, client_name: "Aïcha Mbarga", services: [], proposed_staff_id: proposed, free_staff_ids: free,
});
const ROWS: ProposalRow[] = [
  row(1, "2026-09-29", "10:00", "11:00", 3, [2, 3]),
  row(2, "2026-09-29", "10:30", "11:30", 2, [2, 3]),
  row(3, "2026-09-29", "11:00", "12:00", 3, [2, 3]),
  row(4, "2026-09-29", "14:00", "15:00", null, []),
];

test("choix de départ : la proposition du serveur, rien pour une ligne sans collègue libre", () => {
  assert.deepEqual(initialChoices(ROWS), { 1: 3, 2: 2, 3: 3, 4: null });
});

test("menu d'une ligne : libres d'abord ; une collègue choisie sur une ligne qui chevauche passe « occupée »", () => {
  const choices = initialChoices(ROWS);
  assert.deepEqual(staffOptions(ROWS[1], ROWS, choices, STAFF), { free: [STAFF[0]], busy: [STAFF[1]] }, "Mireille prise par APT-1 à 10:00");
  assert.deepEqual(staffOptions(ROWS[2], ROWS, choices, STAFF), { free: [STAFF[1]], busy: [STAFF[0]] }, "APT-2 (jusqu'à 11:30) prend Grace ; APT-1 finit à 11:00 pile : Mireille libre");
  assert.deepEqual(staffOptions(ROWS[3], ROWS, choices, STAFF), { free: [], busy: STAFF }, "personne de libre d'après la base");
  assert.deepEqual(staffOptions(ROWS[1], ROWS, { ...choices, 1: 2, 3: null }, STAFF).free, [STAFF[1]], "APT-1 passe à Grace et APT-3 (Mireille, chevauche APT-2) est laissé : Mireille se libère pour APT-2");
  const otherDay = row(5, "2026-09-30", "10:00", "11:00", 3, [2, 3]);
  assert.deepEqual(staffOptions(otherDay, [...ROWS, otherDay], { ...choices, 5: 3 }, STAFF).free, STAFF, "même heure, autre jour : pas de chevauchement");
});

test("validation refusée tant qu'une collègue choisie n'est pas libre ; « à replacer », compte et corps envoyé", () => {
  const choices = initialChoices(ROWS);
  assert.deepEqual(busyChoices(ROWS, choices, STAFF), []);
  assert.deepEqual(busyChoices(ROWS, { ...choices, 2: 3, 3: 2 }, STAFF).map((r) => r.id), [1, 2], "APT-1 et APT-2 sur Mireille à la même heure");
  assert.deepEqual(busyChoices(ROWS, { ...choices, 4: 2 }, STAFF).map((r) => r.id), [4], "Grace occupée d'après la base pour APT-4");
  assert.deepEqual(toReplace(ROWS, choices).map((r) => r.id), [4]);
  assert.equal(transferCount(ROWS, choices), 3);
  assert.deepEqual(transferBody(1, ROWS, { ...choices, 3: null }, true), {
    from_staff_id: 1, notify: true, moves: [{ appointment_id: 1, staff_id: 3 }, { appointment_id: 2, staff_id: 2 }],
  });
  assert.equal(transferCount(ROWS, { ...choices, 3: null }), 2);
  assert.deepEqual(toReplace(ROWS, {}).map((r) => r.id), [1, 2, 3, 4], "ligne sans choix : laissée à la praticienne absente");
});

test("période de départ : le jour montré s'il est à venir, sinon aujourd'hui", () => {
  assert.equal(startDay(null, "2026-09-28"), "2026-09-28");
  assert.equal(startDay("2026-09-30", "2026-09-28"), "2026-09-30");
  assert.equal(startDay("2026-09-27", "2026-09-28"), "2026-09-28");
});

test("période : « Au » borné à 31 jours après « Du », jamais avant « Du »", () => {
  assert.equal(lastDay("2026-10-04"), "2026-11-03");
  assert.equal(clampTo("2026-10-04", "2026-11-30"), "2026-11-03");
  assert.equal(clampTo("2026-10-04", "2026-11-03"), "2026-11-03");
  assert.equal(clampTo("2026-10-04", "2026-10-10"), "2026-10-10");
  assert.equal(clampTo("2026-10-20", "2026-10-10"), "2026-10-20", "« Du » reculé après « Au » : « Au » suit");
  assert.equal(clampTo("2026-10-01", "2026-12-01"), "2026-10-31", "« Du » avancé : « Au » ramené dans la borne");
});

test("avis après transfert : singulier et pluriel, avec ou sans reste, dans les deux langues", () => {
  assert.equal(translatePlural("fr", "transfert.fait", 1), "1 rendez-vous transféré.");
  assert.equal(translatePlural("fr", "transfert.fait", 5), "5 rendez-vous transférés.");
  assert.equal(translatePlural("fr", "transfert.fait_reste", 5, { reste: 2 }), "5 rendez-vous transférés, 2 à replacer.");
  assert.equal(translatePlural("en", "transfert.fait", 1), "1 appointment transferred.");
  assert.equal(translatePlural("en", "transfert.fait_reste", 5, { reste: 2 }), "5 appointments transferred, 2 to reassign.");
});
