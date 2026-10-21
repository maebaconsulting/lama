import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sectionsFor } from "../../lib/roles.ts";
import { pathFor } from "../../lib/routes.ts";

/** Rubrique « Mise à jour » des Réglages (spec du 21/10/2026, M-14 à M-16) : câblage de l'écran (les règles sont dans lib/mise-a-jour-reseau.test.ts). */

const read = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const source = read("./mise-a-jour-reseau.tsx");

test("rubrique : adresse dans les deux langues, administrateur et gérante, jamais en formation (M-15, M-16)", () => {
  assert.deepEqual([pathFor("reglages", "fr", "mise-a-jour"), pathFor("reglages", "en", "mise-a-jour")], ["/reglages/mise-a-jour", "/settings/updates"]);
  for (const role of ["admin", "manager"] as const) {
    assert.ok(sectionsFor(role).some((s) => s.id === "mise-a-jour"), role);
    assert.ok(!sectionsFor(role, true).some((s) => s.id === "mise-a-jour"), `${role} en formation`);
  }
  for (const role of ["reception", "practitioner"] as const) assert.ok(!sectionsFor(role).some((s) => s.id === "mise-a-jour"), role);
  assert.match(read("./reglages.tsx"), /"mise-a-jour": MiseAJourReseau,/);
});

test("écran : état relu à chaque signal et dans la langue de l'écran, suivi pendant l'opération ; demande et mode par mot de passe retapé (M-13, M-14)", () => {
  assert.match(source, /useLoad\(\(\) => api<EtatMiseAJour>\("GET", "\/api\/mise-a-jour"\), \["settings"\], \{ reloadOnLang: true \}\)/);
  assert.match(source, /setInterval\(\(\) => void etat\.reload\(\), SUIVI_MS\)/);
  assert.match(source, /confirm\(\(\) => api\("POST", "\/api\/mise-a-jour"\)\)/);
  assert.match(source, /confirm\(\(\) => api\("PUT", "\/api\/mise-a-jour\/mode", \{ mode \}\)\)/);
  assert.match(source, /api\("POST", "\/api\/mise-a-jour\/verifier"\)/);
  assert.match(source, /peutMettreAJour\(e\)/, "bouton absent sans mécanisme ou en développement");
  assert.match(source, /t\("mise_a_jour\.non_pose"\)/, "marche à suivre affichée");
  assert.match(source, /id="mise-a-jour-compris"/);
  assert.match(source, /whitespace-pre-line/, "note « Ce qui change » en texte, lignes gardées");
  assert.match(source, /const admin = account\.role === "admin";/, "la gérante lit seulement");
});

test("pastille sur Réglages pour l'administrateur : rail et barre du téléphone (M-15)", () => {
  assert.match(read("../cadre/rail.tsx"), /view === "reglages" \? <><CompteurAEnvoyer \/><PastilleMiseAJour \/><\/>/);
  const telephone = read("../cadre/telephone.tsx");
  assert.match(telephone, /\{views\.includes\("reglages"\) && <PastilleMiseAJour \/>\}/);
  assert.match(telephone, /\{view === "reglages" && <PastilleMiseAJour \/>\}/);
  assert.match(read("../../hooks/use-mise-a-jour-disponible.ts"), /setVisible\(pastilleMiseAJour\(e\)\)/);
});
