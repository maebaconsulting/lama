import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fr } from "../../i18n/fr.ts";
import { en } from "../../i18n/en.ts";

/** Écran « Demandes en ligne » (spec § 4.5), câblé sur les règles de `lib/demandes-en-ligne.ts`. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const ecran = read("./demandes-en-ligne.tsx");
const dialogue = read("./dialogue-demande.tsx");

test("écran : liste rechargée par le signal « demandes », filtre À traiter / Toutes, actions selon l'état", () => {
  assert.match(ecran, /useLoad\(\(\) => api<\{ demandes: DemandeEnLigne\[\] \}>\("GET", `\/api\/demandes-en-ligne\?filtre=\$\{filtre\}`\), \["demandes"\]\)/);
  assert.match(ecran, /actionsDe\(d\.etat\)/);
  assert.match(ecran, /delaiDepuis\(d\.recue_le, maintenant, lang\)/);
  assert.match(ecran, /openPanel\("client", d\.client_id!\)/);
  assert.match(ecran, /<a href=\{tel\}>/, "appel en un clic");
});

test("fenêtre : chevauchement dit dans la fenêtre, « Confirmer quand même », jamais deux envois", () => {
  assert.match(dialogue, /conflictsFrom\(err\)/);
  assert.match(dialogue, /valider\(true\)/);
  assert.match(dialogue, /envoi\.lancer\("demande"/);
  assert.match(dialogue, /disabled=\{envoi\.occupe \|\| !saisiePrete\(action, saisie\)\}/);
  assert.match(dialogue, /corpsAction\(action, saisie, forcer\)/);
});

test("fenêtre : prestation à choisir, fiche à vérifier jamais proposée d'office", () => {
  assert.match(dialogue, /avecService\(action, saisie\.issue\)/);
  assert.match(dialogue, /d\.fiche === "connue"/, "« fiche trouvée » seulement pour une fiche connue");
});

test("textes de l'écran : mêmes clés en français et en anglais", () => {
  const cles = [...(ecran + dialogue).matchAll(/\bt\("([a-z_.]+)"/g)].map((m) => m[1]);
  assert.ok(cles.length > 10);
  for (const cle of cles) {
    assert.ok(cle in fr, `fr : ${cle}`);
    assert.ok(cle in en, `en : ${cle}`);
  }
  for (const a of ["confirmer", "autre_horaire", "refuser", "appeler", "clore", "rendez_vous"]) assert.ok(`demandes.action.${a}` in fr && `demandes.action.${a}` in en, a);
});

test("carte : téléphone groupé, issue d'un rappel clos à côté de l'état", () => {
  assert.match(ecran, /<span className="chiffres">\{telephoneLisible\(d\.cliente_telephone\)\}<\/span>/);
  assert.match(ecran, /\{libelleEtat\(d\.etat, lang\)\}\{issue && ` · \$\{issue\}`\}/);
});

test("fenêtre : seules les praticiennes qui pratiquent la prestation, « Toute l'équipe » pour les autres", () => {
  assert.match(dialogue, /praticiennesProposees\(staffLookup, avecLaPrestation \? saisie\.service : d\.service_id, saisie\.staff, toute\)/);
  assert.match(dialogue, /\{proposees\.map\(\(s\) => <option key=\{s\.id\} value=\{String\(s\.id\)\}>\{s\.name\}<\/option>\)\}/);
  assert.match(dialogue, /\{masquees > 0 && \(/);
  assert.match(dialogue, /onClick=\{\(\) => setToute\(true\)\}/);
  assert.doesNotMatch(dialogue, /\{staffLookup\.map\(/, "plus jamais toute l'équipe d'office");
});
