import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DICTIONARIES, normalizeLang, translate, translatePlural, type Key } from "./translate.ts";
import { englishFaults, frenchFaults, placeholders, titleCaseFaults } from "./typography.ts";

const keys = (lang: "fr" | "en") => Object.keys(DICTIONARIES[lang]).sort();

test("les deux dictionnaires ont exactement les mêmes clés", () => {
  assert.deepEqual(keys("en"), keys("fr"));
});

// Relecture finale, constat 6 (nettoyage) : menu.a_venir, menu.tableau_de_bord et
// tableau.chiffre_affaires ne sont plus lues nulle part dans src/client (grep -rn vérifié).
test("clés devenues inutilisées retirées : menu.a_venir, menu.tableau_de_bord, tableau.chiffre_affaires", () => {
  const frSource = readFileSync(new URL("./fr.ts", import.meta.url), "utf8");
  const enSource = readFileSync(new URL("./en.ts", import.meta.url), "utf8");
  for (const key of ["menu.a_venir", "menu.tableau_de_bord", "tableau.chiffre_affaires"]) {
    const needle = `"${key}"`;
    assert.ok(!frSource.includes(needle), `${key} encore dans fr.ts`);
    assert.ok(!enSource.includes(needle), `${key} encore dans en.ts`);
  }
});

// Relecture finale de la vague 4 : plus aucun usage hors de src/client/i18n (grep -rn vérifié).
test("clés orphelines retirées (relecture finale, vague 4)", () => {
  const frSource = readFileSync(new URL("./fr.ts", import.meta.url), "utf8");
  const enSource = readFileSync(new URL("./en.ts", import.meta.url), "utf8");
  for (const key of [
    "equipe.activer", "equipe.desactiver", "cliente.prendre_rdv", "cliente.coordonnees",
    "colonne.visite", "colonne.visites", "colonne.produit", "commun.supprimer_nom", "produit.reference",
  ]) {
    const needle = `"${key}"`;
    assert.ok(!frSource.includes(needle), `${key} encore dans fr.ts`);
    assert.ok(!enSource.includes(needle), `${key} encore dans en.ts`);
  }
});

test("aucune valeur vide, mêmes variables de part et d'autre", () => {
  for (const key of keys("fr") as Key[]) {
    for (const lang of ["fr", "en"] as const) assert.ok(DICTIONARIES[lang][key].trim(), `${lang}.${key} est vide`);
    assert.deepEqual(placeholders(DICTIONARIES.en[key]), placeholders(DICTIONARIES.fr[key]), key);
  }
});

test("typographie : espaces insécables en français, aucune espace avant la ponctuation en anglais, jamais de tiret cadratin", () => {
  const faults = (keys("fr") as Key[]).flatMap((key) => [
    ...frenchFaults(DICTIONARIES.fr[key]).map((f) => `fr.${key} : ${f}`),
    ...englishFaults(DICTIONARIES.en[key]).map((f) => `en.${key} : ${f}`),
  ]);
  assert.deepEqual(faults, []);
});

test("pas de Title Case : majuscule en début de libellé ou de phrase seulement", () => {
  const faults = (keys("fr") as Key[]).flatMap((key) => (["fr", "en"] as const).flatMap((lang) =>
    titleCaseFaults(DICTIONARIES[lang][key]).map((w) => `${lang}.${key} : ${w}`)));
  assert.deepEqual(faults, []);
});

test("les contrôles typographiques repèrent les fautes", () => {
  assert.deepEqual(frenchFaults("Nom\u00a0: {nom}"), []);
  assert.equal(frenchFaults("Nom : x").length, 1);
  assert.equal(frenchFaults("Qui êtes-vous?").length, 1);
  assert.equal(frenchFaults("« x\u00a0»").length, 1);
  assert.equal(frenchFaults("a \u2014 b").length, 1);
  assert.deepEqual(englishFaults("Name: {nom}"), []);
  assert.equal(englishFaults("Name : x").length, 1);
  assert.deepEqual(titleCaseFaults("New booking. Try again with Google Drive"), []);
  assert.deepEqual(titleCaseFaults("New Booking"), ["Booking"]);
  assert.deepEqual(titleCaseFaults("Tapez OUI puis «\u00a0Maintenance en cours\u00a0»"), []);
  assert.deepEqual(titleCaseFaults("Open “Keychain Access”, choose “Always Trust”, then a new Booking"), ["Booking"]);
  assert.deepEqual(titleCaseFaults("Dans «\u00a0Réglages des Certificats\u00a0» puis Activez"), ["Activez"]);
});

test("translate remplace les variables et laisse visible une variable absente", () => {
  assert.equal(translate("fr", "commun.nb_rdv.other", { count: 3 }), "3\u00a0rendez-vous");
  assert.equal(translate("en", "commun.nb_rdv.other", { count: 3 }), "3 appointments");
  assert.equal(translate("en", "commun.nb_rdv.other"), "{count} appointments");
});

test("translatePlural suit les règles de chaque langue (0 est singulier en français)", () => {
  assert.equal(translatePlural("fr", "commun.nb_rdv", 0), "0\u00a0rendez-vous");
  assert.equal(translatePlural("en", "commun.nb_rdv", 0), "0 appointments");
  assert.equal(translatePlural("en", "commun.nb_rdv", 1), "1 appointment");
  assert.equal(translatePlural("en", "commun.nb_rdv", 2), "2 appointments");
});

test("normalizeLang : fr ou en, le français pour tout le reste", () => {
  assert.equal(normalizeLang("en"), "en");
  assert.equal(normalizeLang("fr"), "fr");
  for (const other of [undefined, null, "", "EN", "de", "en-GB", 1, {}]) assert.equal(normalizeLang(other), "fr", String(other));
});

test("libellé du thème du rail traduit d'un bloc, typographie de chaque langue (décision C2)", () => {
  assert.equal(translate("fr", "theme.actuel", { nom: translate("fr", "theme.clair") }), "Thème\u00a0: Clair");
  assert.equal(translate("en", "theme.actuel", { nom: translate("en", "theme.clair") }), "Theme: Light");
});
