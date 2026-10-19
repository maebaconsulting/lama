import assert from "node:assert/strict";
import { test } from "node:test";
import { LIBRE_LIBELLE_MAX, libreProblem, orderedLines } from "./supplements.ts";

test("supplément libre : libellé de 1 à 80 caractères, prix entier de 0 à 1 000 000 000, minutes de 0 à 240", () => {
  assert.equal(libreProblem({ label: "Perles dorées", price: 3000, minutes: 15 }), null);
  assert.equal(libreProblem({ label: "  Perles  ", price: 0, minutes: 0 }), null, "prix et minutes nuls permis");
  assert.equal(libreProblem({ label: "é".repeat(LIBRE_LIBELLE_MAX), price: 0, minutes: 240 }), null, "80 lettres accentuées");
  assert.equal(libreProblem({ label: "é".repeat(81), price: 0, minutes: 0 }), "supplement.libre_libelle");
  assert.equal(libreProblem({ label: "   ", price: 0, minutes: 0 }), "supplement.libre_libelle");
  assert.equal(libreProblem({ label: 12, price: 0, minutes: 0 }), "supplement.libre_libelle");
  for (const label of ["Perles\ndorées", "Perles\tdorées", "Perles\rdorées", "Perles\u0000", "Perles\u007f", "Perles\u0085"]) {
    assert.equal(libreProblem({ label, price: 0, minutes: 0 }), "supplement.libre_libelle", JSON.stringify(label));
  }
  assert.equal(libreProblem({ label: "Perles", price: -1, minutes: 0 }), "supplement.libre_prix");
  assert.equal(libreProblem({ label: "Perles", price: 2.5, minutes: 0 }), "supplement.libre_prix");
  assert.equal(libreProblem({ label: "Perles", price: "3000", minutes: 0 }), "supplement.libre_prix");
  assert.equal(libreProblem({ label: "Perles", price: 1_000_000_001, minutes: 0 }), "supplement.libre_prix");
  assert.equal(libreProblem({ label: "Perles", price: 0, minutes: 241 }), "supplement.libre_minutes");
  assert.equal(libreProblem({ label: "Perles", price: 0, minutes: -5 }), "supplement.libre_minutes");
});

test("ordre des lignes : chaque prestation suivie de ses suppléments, même s'ils ont été ajoutés plus tard", () => {
  const lignes = [
    { id: 1, parent_line_id: null, nom: "Tresses" },
    { id: 2, parent_line_id: null, nom: "Crème" },
    { id: 3, parent_line_id: 1, nom: "Mèches" },
    { id: 4, parent_line_id: null, nom: "Soin" },
    { id: 5, parent_line_id: 4, nom: "Masque" },
    { id: 6, parent_line_id: 1, nom: "Perles" },
  ];
  assert.deepEqual(orderedLines(lignes).map((l) => [l.nom, l.supplement]), [
    ["Tresses", false], ["Mèches", true], ["Perles", true], ["Crème", false], ["Soin", false], ["Masque", true],
  ]);
});

test("ordre des lignes : un supplément dont la prestation n'est pas sur le document reste à sa place, sans retrait", () => {
  const avoir = [{ id: 10, parent_line_id: null }, { id: 11, parent_line_id: 99 }, { id: 12 }];
  assert.deepEqual(orderedLines(avoir).map((l) => [l.id, l.supplement]), [[10, false], [11, false], [12, false]]);
});
