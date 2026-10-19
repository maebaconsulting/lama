import assert from "node:assert/strict";
import { test } from "node:test";
import { CODES_DEVISES, DEVISE_DEFAUT, DEVISES, estCodeDevise, prixDemo } from "./devises.ts";

test("onze devises complètes, en unités mineures entières, libellés ASCII", () => {
  assert.deepEqual([...CODES_DEVISES], ["XAF", "XOF", "GNF", "NGN", "GHS", "MAD", "EUR", "USD", "GBP", "CDF", "KES"]);
  for (const code of CODES_DEVISES) {
    const d = DEVISES[code];
    assert.equal(d.code, code);
    assert.ok(d.decimales === 0 || d.decimales === 2, code);
    assert.match(d.libelle, /^[A-Z]{3,4}$/, code);
    assert.ok(d.symbole.length > 0 && d.nom.fr && d.nom.en, code);
    for (const list of [d.billets, d.pieces, d.paliers]) for (const v of list) assert.ok(Number.isInteger(v) && v > 0, `${code} ${v}`);
    assert.ok(d.billets.length > 0, code);
    assert.deepEqual(d.billets, [...d.billets].sort((a, b) => b - a), `${code} billets décroissants`);
    assert.deepEqual(d.pieces, [...d.pieces].sort((a, b) => b - a), `${code} pièces décroissantes`);
    assert.deepEqual(d.paliers, [...d.paliers].sort((a, b) => a - b), `${code} paliers croissants`);
    assert.equal(d.paliers.length, 4, code);
  }
});

test("XAF : exactement les valeurs d'avant le chantier", () => {
  assert.equal(DEVISE_DEFAUT, "XAF");
  const x = DEVISES.XAF;
  assert.deepEqual([x.decimales, x.symbole, x.libelle, x.position], [0, "F", "FCFA", "apres"]);
  assert.deepEqual(x.billets, [10000, 5000, 2000, 1000]);
  assert.deepEqual(x.pieces, [500, 100, 50, 25, 10]);
  assert.deepEqual(x.paliers, [1000, 2000, 5000, 10000]);
});

test("euro et dollar : centimes, positions par défaut", () => {
  assert.deepEqual([DEVISES.EUR.decimales, DEVISES.EUR.symbole, DEVISES.EUR.position], [2, "€", "apres"]);
  assert.deepEqual(DEVISES.EUR.pieces.slice(-3), [5, 2, 1]);
  assert.deepEqual(DEVISES.EUR.paliers, [500, 1000, 2000, 5000]);
  assert.deepEqual([DEVISES.USD.symbole, DEVISES.USD.position], ["$", "avant"]);
});

test("estCodeDevise", () => {
  assert.equal(estCodeDevise("EUR"), true);
  for (const v of ["eur", "XXX", "", null, 3]) assert.equal(estCodeDevise(v), false, String(v));
});

test("prix de démonstration : XAF inchangé, valeurs rondes ailleurs", () => {
  assert.equal(prixDemo(15000, "XAF"), 15000);
  assert.equal(prixDemo(15000, "EUR"), 2300);   // 22,87 € arrondi à l'unité : 23,00 €
  assert.equal(prixDemo(3000, "EUR"), 450);     // 4,57 € arrondi à 0,50 : 4,50 €
  assert.equal(prixDemo(150000, "EUR"), 23000); // 228,67 € arrondi au multiple de 5 le plus proche : 230,00 €
  assert.equal(prixDemo(4000, "GNF"), 60000);
});
