import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fr } from "../../i18n/fr.ts";
import { en } from "../../i18n/en.ts";

/** Horaires (réservation en ligne, étape 1, spec § 4.1). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const editeur = read("./editeur-semaine.tsx");
const horaires = read("./horaires-institut.tsx");
const institut = read("./institut.tsx");

test("éditeur : sept jours, case par jour, deux listes d'heures par plage, pause de midi ajoutée ou retirée", () => {
  assert.match(editeur, /JOURS\.map\(/);
  assert.match(editeur, /type="checkbox"/);
  assert.equal(editeur.match(/<ChampHeure/g)?.length, 2);
  assert.match(editeur, /avecPause\(plages\[0\]\)/);
  assert.match(editeur, /t\("horaires\.ajouter_pause"\)/);
  assert.match(editeur, /t\("horaires\.retirer_pause"\)/);
});

test("rubrique Institut : horaires lus par la route dédiée, vérifiés avant l'envoi, enregistrés comme réglage", () => {
  assert.match(institut, /<HorairesInstitut \/>/);
  assert.match(horaires, /api<\{ institut: Semaine \}>\("GET", "\/api\/horaires"\)/);
  assert.match(horaires, /semaineProblem\(/);
  assert.match(horaires, /"\/api\/settings\/institut\.horaires"/);
  assert.match(horaires, /<EditeurSemaine/);
});

test("textes : mêmes clés en français et en anglais", () => {
  for (const key of ["horaires.titre", "horaires.aide", "horaires.ferme", "horaires.repos", "horaires.ajouter_pause", "horaires.retirer_pause", "horaires.invalides", "horaires.enregistres", "horaires.debut", "horaires.fin", "jour.lun", "jour.dim"]) {
    assert.ok(key in fr, `fr : ${key}`);
    assert.ok(key in en, `en : ${key}`);
  }
});

test("horaires de l'institut : un rechargement garde la saisie en cours (comparaison à la base avant d'écraser)", () => {
  assert.match(horaires, /JSON\.stringify\(semaine\) === JSON\.stringify\(baseline\)/);
  assert.match(horaires, /setBaseline\(fresh\)/);
  assert.match(horaires, /setBaseline\(semaine\)/);
  assert.doesNotMatch(horaires, /if \(data\) setSemaine\(/);
});

test("horaires.invalides : mentionne que la pause doit suivre la fin de la première plage", () => {
  assert.match(fr["horaires.invalides"], /pause doit commencer après la fin/);
  assert.match(en["horaires.invalides"], /break must start after the first range ends/);
});
