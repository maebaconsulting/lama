import assert from "node:assert/strict";
import { test } from "node:test";
import { absenceThreshold, relanceChanges, relanceValues } from "./relances.ts";
import { DEFAULT_ABSENCE_DAYS } from "./crm.ts";

const setting = (key: string, value: unknown) => ({ key, secret: false, value, set: true });
const BASE = { "relances.anniversaire": "non", "relances.absence": "non", "relances.absence_jours": "60", "relances.heure": "10:00" };

test("valeurs du serveur en texte : cases en oui ou non, seuil et heure tels quels", () => {
  assert.deepEqual(
    relanceValues([setting("relances.anniversaire", true), setting("relances.absence", false), setting("relances.absence_jours", 60), setting("relances.heure", "10:00")]),
    { ...BASE, "relances.anniversaire": "oui" },
  );
  assert.deepEqual(relanceValues([]), { "relances.anniversaire": "non", "relances.absence": "non", "relances.absence_jours": "", "relances.heure": "" });
});

test("seuls les champs changés, en valeurs du serveur", () => {
  assert.deepEqual(relanceChanges(BASE, BASE), { changes: [] });
  assert.deepEqual(relanceChanges(BASE, { ...BASE, "relances.absence": "oui", "relances.absence_jours": " 90 ", "relances.heure": "09:30" }), {
    changes: [
      { key: "relances.absence", value: true },
      { key: "relances.absence_jours", value: 90 },
      { key: "relances.heure", value: "09:30" },
    ],
  });
});

test("seuil de 15 à 365 jours, heure au format hh:mm", () => {
  for (const days of ["14", "366", "45,5", "", "abc"]) assert.deepEqual(relanceChanges(BASE, { ...BASE, "relances.absence_jours": days }), { error: "relances.probleme.jours" }, days);
  assert.deepEqual(relanceChanges(BASE, { ...BASE, "relances.absence_jours": "15" }), { changes: [{ key: "relances.absence_jours", value: 15 }] });
  assert.deepEqual(relanceChanges(BASE, { ...BASE, "relances.heure": "24:00" }), { error: "relances.probleme.heure" });
});

test("seuil d'absence de la fiche : celui du serveur, le défaut tant qu'il n'est pas lu ou s'il est illisible", () => {
  assert.equal(absenceThreshold({ absence_days: 90 }), 90);
  assert.equal(absenceThreshold(null), DEFAULT_ABSENCE_DAYS);
  assert.equal(absenceThreshold({ absence_days: "90" }), DEFAULT_ABSENCE_DAYS);
  assert.equal(absenceThreshold({ absence_days: 10 }), DEFAULT_ABSENCE_DAYS);
  assert.equal(absenceThreshold({}), DEFAULT_ABSENCE_DAYS);
});
