import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appointment, BlockedSlot } from "../types.ts";
import { buildDaySheetCsv } from "./day-sheet.ts";

function appointment(patch: Partial<Appointment> = {}): Appointment {
  return {
    id: 1,
    identifier: "APT-1",
    client_id: 1,
    staff_id: 1,
    status: "confirmed",
    scheduled_date: "2026-09-26",
    start_time: "10:00",
    end_time: "11:00",
    total_price: 65,
    notes: "Prefers a quiet appointment",
    is_recurring: 0,
    recurrence_interval: "",
    client_name: "Jamie Rivera",
    client_phone: "555-0100",
    staff_name: "Maya Chen",
    appointment_services: [{
      id: 1,
      appointment_id: 1,
      service_id: 1,
      service_name: "Cut, style",
      price: 65,
      duration: 60,
    }],
    created_at: "2026-09-01 09:00:00",
    updated_at: "2026-09-01 09:00:00",
    ...patch,
  };
}

function blocked(patch: Partial<BlockedSlot> = {}): BlockedSlot {
  return {
    id: 1,
    staff_id: 1,
    staff_name: "Maya Chen",
    blocked_date: "2026-09-26",
    start_time: "09:00",
    end_time: "09:30",
    reason: "Team meeting",
    created_at: "2026-09-01 09:00:00",
    ...patch,
  };
}

test("a day sheet includes blocked time and full appointment details in time order", () => {
  const csv = buildDaySheetCsv("2026-09-26", [appointment()], [blocked()], "en");
  const lines = csv.trimEnd().split("\r\n");

  assert.equal(lines.length, 3);
  assert.match(lines[1], /"09:00","09:30","Blocked time"/);
  assert.match(lines[1], /"Team meeting"$/);
  assert.match(lines[2], /"APT-1","Maya Chen","Jamie Rivera","555-0100"/);
  assert.match(lines[2], /"Cut, style","Confirmed","Prefers a quiet appointment"$/);
});

test("an empty day still exports a useful header row", () => {
  const csv = buildDaySheetCsv("2026-09-26", [], [], "en");
  assert.equal(csv.split("\r\n").filter(Boolean).length, 1);
  assert.match(csv, /^"Date","Start","End","Type"/);
});

test("spreadsheet formulas and CSV punctuation remain data", () => {
  const csv = buildDaySheetCsv("2026-09-26", [appointment({
    client_name: "=HYPERLINK(\"https://example.com\")",
    notes: "Line one, \"quoted\"\nLine two",
  })], [], "en");

  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.com""\)"/);
  assert.match(csv, /"Line one, ""quoted""\nLine two"/);
});

test("en français : en-têtes, types et statuts traduits, date au format court, séparateur point-virgule pour Excel", () => {
  const csv = buildDaySheetCsv("2026-09-26", [appointment()], [blocked()], "fr");
  const lines = csv.trimEnd().split("\r\n");
  assert.match(lines[0], /^"Date";"Début";"Fin";"Type";"Référence";"Membre de l'équipe";"Cliente";"Téléphone";"Prestations";"Statut";"Détails"$/);
  assert.match(lines[1], /^"26\/09\/2026";"09:00";"09:30";"Créneau bloqué"/);
  assert.match(lines[2], /"Rendez-vous";"APT-1";"Maya Chen";"Jamie Rivera"/);
  assert.match(lines[2], /"Confirmé";"Prefers a quiet appointment"$/);
});

test("un rendez-vous sans membre de l'équipe est « non attribué » dans la langue de la feuille", () => {
  assert.match(buildDaySheetCsv("2026-09-26", [appointment({ staff_name: null })], [], "fr"), /"Rendez-vous";"APT-1";"Non attribué"/);
  assert.match(buildDaySheetCsv("2026-09-26", [appointment({ staff_name: null })], [], "en"), /"Appointment","APT-1","Unassigned"/);
});

test("nom anglais d'une prestation en anglais, repli sur le français s'il est vide", () => {
  const svc = (service_name_en: string) => appointment({
    appointment_services: [{ id: 1, appointment_id: 1, service_id: 1, service_name: "Soin du visage", service_name_en, price: 15000, duration: 60 }],
  });
  assert.match(buildDaySheetCsv("2026-09-26", [svc("Facial")], [], "en"), /"Facial","Confirmed"/);
  assert.match(buildDaySheetCsv("2026-09-26", [svc("")], [], "en"), /"Soin du visage","Confirmed"/);
  assert.match(buildDaySheetCsv("2026-09-26", [svc("Facial")], [], "fr"), /"Soin du visage";"Confirmé"/);
});
