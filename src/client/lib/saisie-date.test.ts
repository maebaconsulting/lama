import assert from "node:assert/strict";
import { test } from "node:test";
import { dateFromText, dateToText, timeFromText, timeToText } from "./saisie-date.ts";

test("date saisie jj/mm/aaaa dans les deux langues (spec § 3.3), séparateurs courants acceptés", () => {
  assert.equal(dateFromText("27/09/2026"), "2026-09-27");
  assert.equal(dateFromText(" 7/9/2026 "), "2026-09-07");
  assert.equal(dateFromText("27-09-2026"), "2026-09-27");
  assert.equal(dateFromText("27.09.2026"), "2026-09-27");
  assert.equal(dateFromText("2026-09-27"), "2026-09-27", "forme de l'API, collée telle quelle");
});

test("date impossible ou incomplète : null, jamais une autre date", () => {
  for (const text of ["", "27/09", "31/02/2026", "29/02/2025", "00/01/2026", "12/13/2026", "09/27/2026", "abc", "27/09/26"]) {
    assert.equal(dateFromText(text), null, text);
  }
  assert.equal(dateFromText("29/02/2028"), "2028-02-29", "année bissextile");
});

test("une année hors de 1900 à 2100 est refusée, l'année écrite tient toujours sur quatre chiffres (M2, relecture finale)", () => {
  assert.equal(dateFromText("27/09/0026"), null, "année de deux chiffres saisie par erreur");
  assert.equal(dateFromText("27/09/1899"), null);
  assert.equal(dateFromText("27/09/2101"), null);
  assert.equal(dateFromText("27/09/1900"), "1900-09-27");
  assert.equal(dateFromText("27/09/2100"), "2100-09-27");
});

test("date écrite jj/mm/aaaa, vide pour une valeur vide ou illisible", () => {
  assert.equal(dateToText("2026-09-27"), "27/09/2026");
  assert.equal(dateToText(""), "");
  assert.equal(dateToText("n'importe quoi"), "");
});

test("heure saisie sur 24 h : 14:30, 9:05, 14h30, 1430, 9", () => {
  assert.equal(timeFromText("14:30"), "14:30");
  assert.equal(timeFromText("9:05"), "09:05");
  assert.equal(timeFromText("14h30"), "14:30");
  assert.equal(timeFromText("14H30"), "14:30", "H majuscule (M3, relecture finale)");
  assert.equal(timeFromText("14 h 30"), "14:30");
  assert.equal(timeFromText("1430"), "14:30");
  assert.equal(timeFromText("930"), "09:30");
  assert.equal(timeFromText("9"), "09:00");
  assert.equal(timeFromText("9h"), "09:00");
  assert.equal(timeFromText("00:00"), "00:00");
  assert.equal(timeFromText("23:59"), "23:59");
});

test("heure impossible ou à l'anglo-saxonne : null", () => {
  for (const text of ["", "24:00", "12:60", "2:30 PM", "abc", "14:3", "143000"]) {
    assert.equal(timeFromText(text), null, text);
  }
});

test("heure écrite hh:mm, vide pour une valeur vide ou illisible", () => {
  assert.equal(timeToText("09:00"), "09:00");
  assert.equal(timeToText("14:30:00"), "14:30");
  assert.equal(timeToText(""), "");
  assert.equal(timeToText("n'importe quoi"), "");
});

test("date tapée sur un pavé de chiffres seuls (iPhone, inputMode numeric) : jjmmaaaa en 8 chiffres", () => {
  assert.equal(dateFromText("27092026"), "2026-09-27");
  assert.equal(dateToText(dateFromText("27092026")!), "27/09/2026", "réécrite jj/mm/aaaa à la sortie du champ");
  assert.equal(dateFromText("29022028"), "2028-02-29");
  assert.equal(dateFromText("31022026"), null, "jour impossible");
  assert.equal(dateFromText("2709202"), null, "7 chiffres");
  assert.equal(dateFromText("270920261"), null, "9 chiffres");
  assert.equal(dateFromText("12312026"), null, "ordre américain mmjjaaaa");
});

test("date saisie hors des bornes facultatives : refusée (null), bornes incluses", async () => {
  const { dateWithin } = await import("./saisie-date.ts");
  assert.equal(dateWithin("27/09/2026"), "2026-09-27");
  assert.equal(dateWithin("27/09/2026", "2026-09-28"), null);
  assert.equal(dateWithin("28/09/2026", "2026-09-28"), "2026-09-28");
  assert.equal(dateWithin("29/09/2026", undefined, "2026-09-28"), null);
  assert.equal(dateWithin("29/09/2026", "", ""), "2026-09-29", "borne vide : aucune borne");
  assert.equal(dateWithin("31/02/2026", "2026-01-01"), null);
});
