import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fr } from "../../i18n/fr.ts";
import { en } from "../../i18n/en.ts";

/** Rubrique « Import » (spec du 18/10/2026 § 2.1). */
const rubrique = readFileSync(new URL("./import.tsx", import.meta.url), "utf8");

test("parcours : modèle, fichier, aperçu, import grisé tant qu'une ligne est refusée, bilan", () => {
  assert.match(rubrique, /apiBlob\(cheminModele\(type\)\)/);
  assert.match(rubrique, /apiUpload<ApercuImport>\("POST", cheminApercu\(type, d\), f\)/);
  assert.match(rubrique, /apiUpload<ApercuImport>\("POST", cheminImport\(type, desactiver\), fichier\)/);
  assert.match(rubrique, /disabled=\{!peutImporter\(apercu, pending\)\}/);
  assert.match(rubrique, /accept="\.csv,text\/csv"/);
  assert.match(rubrique, /f\.size > IMPORT_MAX_OCTETS/);
});

test("catalogue : case « désactiver les absentes », décochée par défaut, qui relance l'aperçu", () => {
  assert.match(rubrique, /useState\(false\)/);
  assert.match(rubrique, /type === "catalogue" && <Case id="import-desactiver"/);
  assert.match(rubrique, /if \(fichier\) previsualiser\(fichier, v\)/);
});

test("import refusé après l'aperçu : l'aperçu est relancé avec le même fichier, « Importer » ne reste pas actif sur un aperçu périmé", () => {
  assert.match(rubrique, /catch \(err\) \{[\s\S]*?setApercu\(null\);[\s\S]*?cheminApercu\(type, desactiver\), fichier\)[\s\S]*?throw err;/);
});

test("démonstration publique : pas de dépôt de fichier, le modèle reste", () => {
  assert.match(rubrique, /useDemo\(\) !== null/);
  assert.match(rubrique, /demo\.fichiers_coupes/);
});

test("textes de la rubrique : mêmes clés en français et en anglais", () => {
  const cles = [...rubrique.matchAll(/\bt\("([a-z_.]+)"/g)].map((m) => m[1]);
  assert.ok(cles.length > 10);
  for (const cle of cles) {
    assert.ok(cle in fr, `fr : ${cle}`);
    assert.ok(cle in en, `en : ${cle}`);
  }
  for (const base of ["ajoutes", "mis_a_jour", "completees", "desactivees", "clientes_creees", "stocks"]) {
    for (const forme of ["one", "other"]) assert.ok(`import.bilan_${base}.${forme}` in fr && `import.bilan_${base}.${forme}` in en, `${base}.${forme}`);
  }
  for (const cle of ["import.catalogue.titre", "import.clientes.aide", "import.produits.titre", "import.rendez_vous.aide", "reglages.rubrique.import", "journal.action.import.clientes"]) {
    assert.ok(cle in fr && cle in en, cle);
  }
});
