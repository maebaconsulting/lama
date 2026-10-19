import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fr } from "../../i18n/fr.ts";
import { en } from "../../i18n/en.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fiche = read("./fiche-membre.tsx");
const horaires = read("./horaires-membre.tsx");
const prestations = read("./prestations-membre.tsx");
const prestation = read("./fiche-prestation.tsx");
const formulaire = read("../create-service.tsx");

test("fiche du membre : semaine type résumée, « comme l'institut », prestations pratiquées, réservable en ligne", () => {
  assert.match(fiche, /resumeJour\(/);
  assert.match(fiche, /t\("membre\.comme_institut"\)/);
  assert.match(fiche, /t\("membre\.prestations_pratiquees"\)/);
  assert.match(fiche, /updateStaff\(staff\.id, \{ en_ligne: staff\.en_ligne \? 0 : 1 \}\)/);
  assert.match(fiche, /<HorairesMembre /);
  assert.match(fiche, /<PrestationsMembre /);
});

test("fenêtre des horaires : comme l'institut (null) ou semaine propre, vérifiée avant l'envoi", () => {
  assert.match(horaires, /updateStaff\(staff\.id, \{ horaires: propre \? semaine : null \}\)/);
  assert.match(horaires, /semaineProblem\(semaine\)/);
  assert.match(horaires, /<EditeurSemaine [^>]*vide="repos"/);
});

test("fenêtre des prestations : cases par prestation active, liste remplacée", () => {
  assert.match(prestations, /type="checkbox"/);
  assert.match(prestations, /updateStaff\(staff\.id, \{ service_ids: \[\.\.\.choisies\] \}\)/);
});

test("prestation : réservable en ligne lu sur la fiche et réglé dans le formulaire", () => {
  assert.match(prestation, /t\("prestation\.en_ligne"\)/);
  assert.match(formulaire, /en_ligne: enLigne \? 1 : 0/);
});

test("textes : mêmes clés en français et en anglais", () => {
  for (const key of ["membre.horaires", "membre.comme_institut", "membre.horaires_propres", "membre.modifier_horaires", "membre.prestations_pratiquees", "membre.modifier_prestations", "membre.aucune_prestation", "membre.en_ligne", "membre.en_ligne_aide", "prestation.en_ligne", "prestation.en_ligne_aide", "commun.oui", "commun.non"]) {
    assert.ok(key in fr, `fr : ${key}`);
    assert.ok(key in en, `en : ${key}`);
  }
});
