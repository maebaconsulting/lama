import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApercuImport } from "../../shared/import.ts";
import { definirDevise } from "../../shared/devise-active.ts";
import { aideCentimes, cheminApercu, cheminImport, cheminModele, compteurs, compteursBilan, IMPORTS, nomModele, peutImporter } from "./import.ts";

const apercu = (extra: Partial<ApercuImport> = {}): ApercuImport => ({
  type: "clientes", lignes: 3, ajouts: 2, mises_a_jour: 1, inchangees: 0, desactivees: 0, clientes_creees: 0, stocks_changes: 0, premier_prix: null,
  refusees: [], refusees_total: 0, doublons: 0, avertissements: [], avertissements_total: 0, importable: true, ...extra,
});

test("quatre imports, dans l'ordre de la spec", () => {
  assert.deepEqual(IMPORTS.map((i) => i.type), ["catalogue", "clientes", "produits", "rendez-vous"]);
});

test("adresses : modèle, aperçu, import ; option « désactiver » pour le catalogue seulement", () => {
  assert.equal(cheminModele("produits"), "/api/import/produits/modele");
  assert.equal(cheminApercu("catalogue", true), "/api/import/catalogue/apercu?desactiver=1");
  assert.equal(cheminApercu("catalogue", false), "/api/import/catalogue/apercu");
  assert.equal(cheminImport("clientes", true), "/api/import/clientes");
  assert.equal(cheminImport("rendez-vous", false), "/api/import/rendez-vous");
  assert.equal(nomModele("rendez-vous"), "modele-rendez-vous.csv");
});

test("« Importer » grisé sans aperçu, pendant un envoi, ou tant que le serveur dit le fichier non importable", () => {
  assert.equal(peutImporter(null, false), false);
  assert.equal(peutImporter(apercu(), true), false);
  assert.equal(peutImporter(apercu({ importable: false, refusees_total: 1 }), false), false);
  assert.equal(peutImporter(apercu(), false), true);
});

test("compteurs montrés selon le type d'import", () => {
  assert.deepEqual(compteurs(apercu()).map(([k]) => k), ["import.lignes", "import.ajouts", "import.mises_a_jour", "import.inchangees"]);
  assert.deepEqual(compteurs(apercu({ type: "catalogue", desactivees: 2 })).map(([k]) => k), ["import.lignes", "import.ajouts", "import.mises_a_jour", "import.desactivees"]);
  assert.deepEqual(compteurs(apercu({ type: "rendez-vous", clientes_creees: 1 })), [["import.lignes", 3], ["import.ajouts", 2], ["import.clientes_creees", 1]]);
});

test("bilan : seulement les compteurs qui ont un sens pour le type", () => {
  const bases = (extra: Partial<ApercuImport>) => compteursBilan(apercu(extra)).map(([base]) => base);
  assert.deepEqual(bases({ type: "rendez-vous" }), ["import.bilan_ajoutes", "import.bilan_clientes_creees"]);
  assert.deepEqual(bases({ type: "produits" }), ["import.bilan_ajoutes", "import.bilan_mis_a_jour", "import.bilan_stocks"]);
  assert.deepEqual(bases({ type: "clientes" }), ["import.bilan_ajoutes", "import.bilan_completees"]);
  assert.deepEqual(bases({ type: "catalogue" }), ["import.bilan_ajoutes", "import.bilan_mis_a_jour", "import.bilan_desactivees"]);
  assert.deepEqual(compteursBilan(apercu({ type: "produits", ajouts: 1, mises_a_jour: 2, stocks_changes: 3 })).map(([, n]) => n), [1, 2, 3]);
});

test("aperçu des produits : nombre de stocks qui seront remplacés", () => {
  assert.deepEqual(compteurs(apercu({ type: "produits", stocks_changes: 4 })), [["import.lignes", 3], ["import.ajouts", 2], ["import.mises_a_jour", 1], ["import.inchangees", 0], ["import.stocks_changes", 4]]);
});

test("aide des montants en centimes : catalogue et produits, seulement dans une devise à décimales", () => {
  try {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
    assert.deepEqual(IMPORTS.map((d) => aideCentimes(d.type)), [false, false, false, false]);
    definirDevise({ code: "EUR", position: null, symboleEcran: true });
    assert.deepEqual(IMPORTS.map((d) => aideCentimes(d.type)), [true, false, true, false]);
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});
