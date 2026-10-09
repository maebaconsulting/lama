import assert from "node:assert/strict";
import { test } from "node:test";
import { byCategory } from "./prestations.ts";

/** Revue impeccable (G4) : prestations regroupées par catégorie, dans la langue de l'écran. */

const svc = (id: number, category: string, category_en = "", active = 1) => ({ id, category, category_en, active });

test("groupes dans l'ordre de la première apparition, prestations dans l'ordre reçu", () => {
  const groups = byCategory([svc(1, "Soins du visage"), svc(2, "Coiffure"), svc(3, "Soins du visage")], "fr");
  assert.deepEqual(groups.map((g) => [g.category, g.services.map((s) => s.id)]), [["Soins du visage", [1, 3]], ["Coiffure", [2]]]);
});

test("anglais : nom anglais de la catégorie, repli sur le français s'il manque", () => {
  const groups = byCategory([svc(1, "Coiffure", "Hair"), svc(2, "Onglerie")], "en");
  assert.deepEqual(groups.map((g) => g.category), ["Hair", "Onglerie"]);
});

test("sans catégorie : un groupe au nom vide, en dernier ; prestations inactives écartées", () => {
  const groups = byCategory([svc(1, ""), svc(2, "Coiffure"), svc(3, "Coiffure", "", 0)], "fr");
  assert.deepEqual(groups.map((g) => [g.category, g.services.map((s) => s.id)]), [["Coiffure", [2]], ["", [1]]]);
});

test("liste des prestations (vague 4) : inactives gardées sur demande, à leur place dans leur catégorie", () => {
  const groups = byCategory([svc(1, "Coiffure"), svc(2, "Coiffure", "", 0), svc(3, "")], "fr", { withInactive: true });
  assert.deepEqual(groups.map((g) => [g.category, g.services.map((s) => s.id)]), [["Coiffure", [1, 2]], ["", [3]]]);
});
