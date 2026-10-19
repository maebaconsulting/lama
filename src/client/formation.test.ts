import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DICTIONARIES } from "./i18n/translate.ts";
import { forbiddenSection, sectionFor, sectionsFor } from "./lib/roles.ts";
import { pathFor } from "./lib/routes.ts";

/** Base de formation à l'écran (distribution D-18, D-19) : bandeau sur chaque écran, rubrique Réglages > Formation pour son administrateur. */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("rubrique Formation : administrateur de la base de formation seulement, après « Heure » ; jamais dans la vraie base", () => {
  const ids = (role: Parameters<typeof sectionsFor>[0], formation?: boolean) => sectionsFor(role, formation).map((s) => s.id);
  assert.ok(!ids("admin").includes("formation"), "vraie base : aucune rubrique Formation");
  assert.deepEqual(ids("admin", true), ["caisse", "en-ligne", "import", "comptes", "postes", "file-envoi", "sauvegardes", "heure", "formation", "connexions", "journal", "mon-compte"]);
  for (const role of ["manager", "reception", "practitioner"] as const) assert.ok(!ids(role, true).includes("formation"), role);
  assert.equal(forbiddenSection("admin", "formation"), true);
  assert.equal(forbiddenSection("admin", "formation", true), false);
  assert.equal(forbiddenSection("manager", "formation", true), true);
  assert.equal(sectionFor("admin", "formation", true), "formation");
  assert.equal(sectionFor("admin", "formation"), "caisse");
  assert.deepEqual([pathFor("reglages", "fr", "formation"), pathFor("reglages", "en", "formation")], ["/reglages/formation", "/settings/training"]);
});

test("état public lu par la porte : la formation est posée pour tous les écrans, entrée comprise", () => {
  assert.match(read("./lib/auth-types.ts"), /formation\?: boolean;/);
  const porte = read("./components/auth/porte.tsx");
  assert.match(porte, /<FormationContext\.Provider value=\{state\?\.formation === true\}>/);
  assert.match(read("./formation-context.tsx"), /export const FormationContext = createContext\(false\);/);
});

test("bandeau permanent d'un bleu nuit propre : en tête de chaque page après « Serveur injoignable », et sur la fiche des écrans d'entrée", () => {
  const bandeaux = read("./components/bandeaux.tsx");
  assert.match(bandeaux, /<BandeauInjoignable \/>\s*\{formation && <BandeauFormation \/>\}\s*<BandeauNouvelleVersion \/>/);
  const bandeau = bandeaux.slice(bandeaux.indexOf("function BandeauFormation"), bandeaux.indexOf("function BandeauNouvelleVersion"));
  assert.match(bandeau, /role="status"/);
  assert.match(bandeau, /bg-\[#2E3A5C\] px-4 py-2 text-sm text-\[#FBF9F4\]/);
  assert.match(bandeau, /\{t\(demo \? "demo\.bandeau_court" : "formation\.bandeau_court"\)\}/);
  assert.match(bandeau, /\{t\(demo \? "demo\.bandeau" : "formation\.bandeau"\)\}/);
  assert.doesNotMatch(bandeau, /onClick|fermer/i, "jamais refermé");
  const couverture = read("./components/auth/couverture.tsx");
  assert.match(couverture, /\{formation && <p role="status" className="mb-4 rounded-sm bg-\[#2E3A5C\] px-3 py-2 text-sm text-\[#FBF9F4\]">\{t\(demo \? "demo\.bandeau_court" : "formation\.bandeau_court"\)\}<\/p>\}/);
});

test("Réglages > Formation : case à cocher, mot de passe retapé, maintenance annoncée ; rubrique branchée et adresse gardée", () => {
  const rubrique = read("./components/reglages/formation.tsx");
  assert.match(rubrique, /confirm\(\(\) => api\("POST", "\/api\/formation\/remise-a-zero"\)\)/);
  assert.match(rubrique, /if \(fait !== null\) emitSessionSignal\("maintenance"\);/);
  assert.match(rubrique, /if \(!compris\) \{/);
  assert.match(rubrique, /variant="destructive"/);
  const reglages = read("./components/reglages/reglages.tsx");
  assert.match(reglages, /formation: Formation,/);
  assert.match(reglages, /sectionFor\(account\.role, section, formation\)/);
  assert.match(reglages, /sectionsFor\(account\.role, formation\)\.map/);
  assert.match(read("./app.tsx"), /forbiddenSection\(role, id, formation\)/);
});

test("textes : bandeau et remise à zéro dans les deux langues", () => {
  assert.equal(DICTIONARIES.fr["formation.bandeau"], "Base de formation\u00a0: données fictives, aucun message ne part, aucune sauvegarde n'est faite.");
  assert.equal(DICTIONARIES.en["formation.bandeau"], "Training database: fictitious data, no message is sent, no backup is made.");
  assert.equal(DICTIONARIES.fr["reglages.rubrique.formation"], "Formation");
  assert.equal(DICTIONARIES.en["formation.remise.bouton"], "Reset the training database");
});

test("rubriques coupées en formation : une ligne le dit, sans masquer la rubrique", () => {
  for (const fichier of ["./components/reglages/heure.tsx", "./components/reglages/sauvegardes.tsx", "./components/reglages/whatsapp.tsx"]) {
    const source = read(fichier);
    assert.match(source, /\{formation && <p className="max-w-prose text-sm text-encre-grise">\{t\("formation\.coupe"\)\}<\/p>\}/, fichier);
  }
  assert.equal(DICTIONARIES.fr["formation.coupe"], "Coupé dans la base de formation.");
  assert.equal(DICTIONARIES.en["formation.coupe"], "Disabled in the training database.");
});

test("base de formation sans compte : pas de formulaire d'installation voué au refus, un message clair", () => {
  const installation = read("./components/auth/installation.tsx");
  const avant = installation.slice(installation.indexOf("if (formation) {"), installation.indexOf("<form"));
  assert.match(avant, /titre=\{t\("formation\.sans_compte"\)\} sousTitre=\{t\("formation\.sans_compte_aide"\)\}>/);
  assert.match(avant, /<Button className="w-full" onClick=\{\(\) => void onDone\(\)\}>\{t\("etat\.reessayer"\)\}<\/Button>/, "« Réessayer » relit l'état (gate.reload, passé en onDone), comme l'écran Injoignable");
  assert.equal(DICTIONARIES.fr["etat.reessayer"], "Réessayer");
  assert.equal(DICTIONARIES.en["etat.reessayer"], "Try again");
  assert.equal(DICTIONARIES.fr["formation.sans_compte"], "Aucun compte de formation");
  assert.equal(DICTIONARIES.en["formation.sans_compte"], "No training account");
  assert.equal(DICTIONARIES.fr["formation.sans_compte_aide"], "Le technicien la prépare avec sudo lama-formation --comptes.");
  assert.equal(DICTIONARIES.en["formation.sans_compte_aide"], "The technician prepares it with sudo lama-formation --comptes.");
});
