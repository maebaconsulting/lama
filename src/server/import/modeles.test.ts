import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { registerFunctions } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { lireCatalogueTableau, COLONNES_CATALOGUE } from "../catalogue/import-catalogue.ts";
import { TYPES_IMPORT } from "../../shared/import.ts";
import { lireTableau } from "./csv.ts";
import { analyserClientes, COLONNES_CLIENTES } from "./clientes.ts";
import { analyserProduits, COLONNES_PRODUITS } from "./produits.ts";
import { COLONNES_RENDEZ_VOUS } from "./rendez-vous.ts";
import { champCsv, modele, retirerExemples } from "./modeles.ts";

const P = { devise: "XAF" as const, indicatif: "237", maintenant: Date.parse("2026-09-28T08:00:00Z") };
const COLONNES = { catalogue: COLONNES_CATALOGUE, clientes: COLONNES_CLIENTES, produits: COLONNES_PRODUITS, "rendez-vous": COLONNES_RENDEZ_VOUS };

test("chaque modèle : BOM, séparateur `;`, en-tête et une ligne d'exemple, relu sans erreur par le lecteur commun", () => {
  for (const type of TYPES_IMPORT) {
    const texte = modele(type, P);
    assert.ok(texte.startsWith("\uFEFF"), type);
    assert.ok(texte.endsWith("\r\n"), type);
    assert.equal(texte.split("\r\n").length, 3, type);
    const l = lireTableau(texte, COLONNES[type]);
    assert.ok(l.ok, type);
    assert.equal(l.tableau.lignes.length, 1, type);
    assert.deepEqual(l.tableau.refusees, [], type);
    assert.ok(COLONNES[type].obligatoires.every((c) => l.tableau.colonnes.includes(c)), type);
  }
});

test("lignes d'exemple valides : catalogue, clientes et produits passent leur propre analyse", () => {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  runMigrations(db);
  const lire = (type: keyof typeof COLONNES) => {
    const l = lireTableau(modele(type, P), COLONNES[type]);
    if (!l.ok) throw new Error(type);
    return l.tableau;
  };
  assert.deepEqual(lireCatalogueTableau(lire("catalogue")).erreurs, []);
  assert.deepEqual(analyserClientes(db, lire("clientes"), P).refusees, []);
  assert.deepEqual(analyserProduits(db, lire("produits"), { base: "XAF" }).refusees, []);
  db.close();
});

test("devise de la base dans les modèles de montants ; prix d'exemple en unités mineures", () => {
  const euros = modele("produits", { ...P, devise: "EUR" });
  assert.match(euros, /;EUR\r\n$/);
  assert.doesNotMatch(modele("clientes", P), /XAF/);
  assert.match(modele("rendez-vous", P), /\r\n2026-10-05;10:00;/);
});

test("champ CSV : guillemets seulement quand il le faut, guillemet doublé", () => {
  assert.equal(champCsv("simple"), "simple");
  assert.equal(champCsv("a;b"), '"a;b"');
  assert.equal(champCsv('dit "oui"'), '"dit ""oui"""');
});

test("ligne d'exemple du modèle refusée dans chaque import, même téléchargée un autre jour ou dans une autre devise", () => {
  for (const type of TYPES_IMPORT) {
    const l = lireTableau(modele(type, { ...P, devise: "EUR", maintenant: P.maintenant - 3 * 24 * 60 * 60 * 1000 }), COLONNES[type]);
    if (!l.ok) throw new Error(type);
    const t = retirerExemples(type, l.tableau, P.indicatif);
    assert.deepEqual(t.lignes, [], type);
    assert.deepEqual(t.refusees, [{ ligne: 2, motif: "import.ligne_exemple" }], type);
  }
});

test("numéro d'exemple refusé quel que soit le reste de la ligne (clientes, rendez-vous) ; une vraie ligne passe", () => {
  const l = lireTableau("nom;telephone\nBella Vraie;+237 600 000 000\nAwa Vraie;699000001\n", COLONNES_CLIENTES);
  if (!l.ok) throw new Error("clientes");
  const t = retirerExemples("clientes", l.tableau, "237");
  assert.deepEqual(t.refusees, [{ ligne: 2, motif: "import.ligne_exemple" }]);
  assert.deepEqual(t.lignes.map((x) => x.numero), [3]);
});

test("téléphone d'exemple sans «\u00a0+\u00a0» en tête : le tableur ne le prend pas pour une formule", () => {
  for (const type of ["clientes", "rendez-vous"] as const) assert.match(modele(type, P), /;6 00 00 00 00;/, type);
});

test("modèle du catalogue : colonnes supplement_seulement et supplements_possibles, exemple à « non » et liste vide ; ligne d'exemple d'un ancien modèle toujours refusée", () => {
  const [entete, exemple] = modele("catalogue", P).replace("\uFEFF", "").split("\r\n");
  assert.match(entete, /;remarque_en;supplement_seulement;supplements_possibles;devise$/);
  assert.match(exemple, /;non;;XAF$/);
  const ancien = lireTableau([entete.replace(";supplement_seulement;supplements_possibles", ""), exemple.replace(";non;;", ";")].join("\n"), COLONNES_CATALOGUE);
  if (!ancien.ok) throw new Error("catalogue");
  assert.deepEqual(retirerExemples("catalogue", ancien.tableau, P.indicatif).refusees, [{ ligne: 2, motif: "import.ligne_exemple" }]);
});
