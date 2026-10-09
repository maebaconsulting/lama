import assert from "node:assert/strict";
import { test } from "node:test";
import { clampDay, inBounds, monthGrid, monthOf, monthTitle, shiftDay, shiftMonth, todayAt, weekdayInitials, weekdayNames } from "./calendrier.ts";

const flat = (grid: (string | null)[][]) => grid.flat();

test("grille du mois : semaines de 7 jours commençant le lundi", () => {
  // Septembre 2026 commence un mardi.
  const grid = monthGrid(2026, 9);
  assert.ok(grid.every((week) => week.length === 7));
  assert.deepEqual(grid[0], [null, "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
  assert.equal(flat(grid).filter(Boolean).length, 30);
  assert.equal(grid.at(-1)!.filter(Boolean).at(-1), "2026-09-30");
});

test("grille du mois : 28, 29, 30 et 31 jours", () => {
  assert.equal(flat(monthGrid(2026, 2)).filter(Boolean).length, 28);
  assert.equal(flat(monthGrid(2028, 2)).filter(Boolean).length, 29, "année bissextile");
  assert.equal(flat(monthGrid(2100, 2)).filter(Boolean).length, 28, "2100 n'est pas bissextile");
  assert.equal(flat(monthGrid(2000, 2)).filter(Boolean).length, 29, "2000 est bissextile");
  assert.equal(flat(monthGrid(2026, 4)).filter(Boolean).length, 30);
  assert.equal(flat(monthGrid(2026, 12)).filter(Boolean).length, 31);
});

test("grille du mois : un mois qui commence un dimanche occupe six semaines", () => {
  // Novembre 2026 commence un dimanche.
  const grid = monthGrid(2026, 11);
  assert.deepEqual(grid[0], [null, null, null, null, null, null, "2026-11-01"]);
  assert.equal(grid.length, 6);
  // Février 2027 commence un lundi et tient en quatre semaines.
  assert.equal(monthGrid(2027, 2).length, 4);
  assert.equal(monthGrid(2027, 2)[0][0], "2027-02-01");
});

test("aujourd'hui à Douala, quelle que soit l'heure de l'appareil", () => {
  // 23:30 UTC le 30 septembre : déjà le 1er octobre à Douala (UTC+1).
  assert.equal(todayAt(new Date(Date.UTC(2026, 8, 30, 23, 30))), "2026-10-01");
  assert.equal(todayAt(new Date(Date.UTC(2026, 8, 30, 22, 59))), "2026-09-30");
  assert.equal(todayAt(new Date(Date.UTC(2026, 11, 31, 23, 0))), "2027-01-01");
});

test("nom du mois et de l'année tiré d'Intl, dans la langue du compte", () => {
  assert.equal(monthTitle(2026, 9, "fr"), "septembre 2026");
  assert.equal(monthTitle(2026, 9, "en"), "September 2026");
  assert.equal(monthTitle(2027, 1, "fr"), "janvier 2027");
});

test("initiales et noms des jours, du lundi au dimanche, dans les deux langues", () => {
  assert.deepEqual(weekdayInitials("fr"), ["L", "M", "M", "J", "V", "S", "D"]);
  assert.deepEqual(weekdayInitials("en"), ["M", "T", "W", "T", "F", "S", "S"]);
  assert.equal(weekdayNames("fr")[0], "lundi");
  assert.equal(weekdayNames("en")[6], "Sunday");
});

test("déplacements au jour et au mois, sans objet Date local", () => {
  assert.equal(shiftDay("2026-09-30", 1), "2026-10-01");
  assert.equal(shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(shiftDay("2028-02-28", 1), "2028-02-29");
  assert.equal(shiftDay("2026-12-28", 7), "2027-01-04");
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(monthOf("2026-09-27"), { year: 2026, month: 9 });
  assert.equal(monthOf("illisible"), null);
});

test("bornes facultatives : jours hors bornes refusés", () => {
  assert.equal(inBounds("2026-09-27"), true);
  assert.equal(inBounds("2026-09-27", "2026-09-28"), false);
  assert.equal(inBounds("2026-09-28", "2026-09-28"), true);
  assert.equal(inBounds("2026-09-29", undefined, "2026-09-28"), false);
  assert.equal(clampDay("2026-09-20", "2026-09-25", "2026-09-30"), "2026-09-25");
  assert.equal(clampDay("2026-10-20", "2026-09-25", "2026-09-30"), "2026-09-30");
  assert.equal(clampDay("2026-09-27"), "2026-09-27");
});
