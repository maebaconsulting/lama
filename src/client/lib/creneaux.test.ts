import assert from "node:assert/strict";
import { test } from "node:test";
import { DAY_END_HOUR, DAY_START_HOUR, timeSlots } from "./creneaux.ts";

test("journée de l'institut : 07:00 à 23:00, une seule source pour l'agenda et les créneaux", () => {
  assert.equal(DAY_START_HOUR, 7);
  assert.equal(DAY_END_HOUR, 23);
});

test("heure de début : créneaux de 15 minutes de 07:00 à 22:45", () => {
  const slots = timeSlots("debut");
  assert.equal(slots[0], "07:00");
  assert.equal(slots[1], "07:15");
  assert.equal(slots.at(-1), "22:45");
  assert.equal(slots.length, 64);
  assert.ok(slots.every((s) => /^\d{2}:(00|15|30|45)$/.test(s)));
});

test("heure de fin : créneaux de 15 minutes de 07:15 à 23:00", () => {
  const slots = timeSlots("fin");
  assert.equal(slots[0], "07:15");
  assert.equal(slots.at(-1), "23:00");
  assert.equal(slots.length, 64);
});

test("une valeur hors grille est insérée à sa place, jamais perdue", () => {
  const slots = timeSlots("debut", "09:10");
  assert.equal(slots.length, 65);
  assert.deepEqual(slots.slice(slots.indexOf("09:00"), slots.indexOf("09:00") + 3), ["09:00", "09:10", "09:15"]);
  assert.equal(timeSlots("debut", "06:30")[0], "06:30", "avant la journée");
  assert.equal(timeSlots("fin", "23:30").at(-1), "23:30", "après la journée");
  assert.equal(timeSlots("debut", "23:00").at(-1), "23:00", "fin de journée prise pour un début");
});

test("une valeur déjà sur la grille, vide ou illisible ne change rien", () => {
  assert.equal(timeSlots("debut", "09:15").length, 64);
  assert.equal(timeSlots("debut", "").length, 64);
  assert.equal(timeSlots("debut", "abc").length, 64);
  assert.equal(timeSlots("debut", "14:30:00").length, 64, "forme hh:mm:ss de l'API ramenée à hh:mm");
});
