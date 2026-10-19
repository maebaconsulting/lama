import assert from "node:assert/strict";
import { test } from "node:test";
import { ajouterJours, dateValide, enHeure, enMinutes, fuseauValide, localDe } from "./temps.ts";

test("localDe : date et minutes dans le fuseau de l'institut, pas dans celui de la machine", () => {
  const instant = Date.UTC(2026, 9, 16, 23, 30);
  assert.deepEqual(localDe(instant, "Africa/Douala"), { date: "2026-10-17", minutes: 30 });
  assert.deepEqual(localDe(instant, "UTC"), { date: "2026-10-16", minutes: 1410 });
  assert.deepEqual(localDe(Date.UTC(2026, 9, 16, 23, 0), "Africa/Douala"), { date: "2026-10-17", minutes: 0 });
});

test("fuseauValide : nom IANA connu seulement", () => {
  assert.equal(fuseauValide("Africa/Douala"), true);
  assert.equal(fuseauValide("Europe/Paris"), true);
  assert.equal(fuseauValide("Mars/Olympe"), false);
  assert.equal(fuseauValide(""), false);
});

test("dateValide : AAAA-MM-JJ et jour qui existe", () => {
  assert.equal(dateValide("2026-10-20"), true);
  assert.equal(dateValide("2028-02-29"), true);
  assert.equal(dateValide("2026-02-29"), false);
  assert.equal(dateValide("2026-13-01"), false);
  assert.equal(dateValide("26-01-01"), false);
  assert.equal(dateValide("2026-1-01"), false);
});

test("ajouterJours : passe les mois et les années", () => {
  assert.equal(ajouterJours("2026-12-31", 1), "2027-01-01");
  assert.equal(ajouterJours("2026-03-01", -1), "2026-02-28");
  assert.equal(ajouterJours("2026-10-20", 0), "2026-10-20");
});

test("enMinutes et enHeure", () => {
  assert.equal(enMinutes("09:05"), 545);
  assert.equal(enMinutes("00:00"), 0);
  assert.equal(enHeure(545), "09:05");
  assert.equal(enHeure(1439), "23:59");
});
