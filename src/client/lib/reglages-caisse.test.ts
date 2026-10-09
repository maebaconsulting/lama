import assert from "node:assert/strict";
import { test } from "node:test";
import { caisseChanges, caisseValue, caisseValues, methodsOf, parseCap, parseRate, prefixeEtat, prefixeSaisi, toggleMethod } from "./reglages-caisse.ts";
import { rebase } from "./reglages.ts";
import { auditTarget } from "./libelles.ts";
import { parseRoute, pathFor } from "./routes.ts";
import { forbiddenSection, sectionsFor } from "./roles.ts";

/**
 * Rubrique « Caisse » des Réglages (sous-projet 5 § 5.2) : valeurs en texte,
 * taux et plafond contrôlés, moyens de paiement, changements réels seulement,
 * rubrique de la gérante, libellés du journal.
 */

const SETTINGS = [
  { key: "institut.niu", secret: false, value: "M012345678901A", set: true },
  { key: "institut.rccm", secret: false, value: "", set: true },
  { key: "caisse.tva_active", secret: false, value: true, set: true },
  { key: "caisse.tva_taux", secret: false, value: 19.25, set: true },
  { key: "caisse.mentions_fr", secret: false, value: "", set: true },
  { key: "caisse.mentions_en", secret: false, value: "", set: true },
  { key: "caisse.remises", secret: false, value: true, set: true },
  { key: "caisse.remise_plafond", secret: false, value: 10, set: true },
  { key: "caisse.pourboires", secret: false, value: true, set: true },
  { key: "caisse.acomptes", secret: false, value: false, set: true },
  { key: "caisse.avoirs_reception", secret: false, value: false, set: true },
  { key: "caisse.moyens", secret: false, value: ["momo", "cash", "card"], set: true },
];

test("valeurs du serveur en texte : oui/non, taux dans la langue de l'écran, moyens dans l'ordre d'affichage", () => {
  const fr = caisseValues(SETTINGS, "fr");
  assert.equal(fr["caisse.tva_taux"], "19,25");
  assert.equal(caisseValues(SETTINGS, "en")["caisse.tva_taux"], "19.25");
  assert.deepEqual([fr["caisse.tva_active"], fr["caisse.acomptes"], fr["caisse.avoirs_reception"]], ["oui", "non", "non"]);
  assert.equal(fr["caisse.moyens"], "cash,card,momo");
  assert.equal(fr["caisse.remise_plafond"], "10");
  assert.equal(fr["institut.niu"], "M012345678901A");
});

test("taux de TVA : virgule ou point, deux décimales, de 0 à 100", () => {
  assert.equal(parseRate("19,25"), 19.25);
  assert.equal(parseRate("19.25 %"), 19.25);
  assert.equal(parseRate("0"), 0);
  assert.equal(parseRate("100"), 100);
  for (const bad of ["", "19,255", "101", "-1", "dix", "19,"]) assert.equal(parseRate(bad), null, bad);
});

test("plafond de remise : pourcentage entier de 0 à 100", () => {
  assert.equal(parseCap("15"), 15);
  assert.equal(parseCap("15 %"), 15);
  for (const bad of ["", "12,5", "101", "-3"]) assert.equal(parseCap(bad), null, bad);
});

test("moyens de paiement : cocher et décocher gardent l'ordre ; aucun moyen refusé", () => {
  assert.equal(toggleMethod("cash,momo", "card", true), "cash,card,momo");
  assert.equal(toggleMethod("cash,card,momo", "cash", false), "card,momo");
  assert.deepEqual(methodsOf("momo,inconnu,cash"), ["cash", "momo"]);
  assert.deepEqual(caisseValue("caisse.moyens", ""), { error: "reglages_caisse.erreur_moyens" });
  assert.deepEqual(caisseValue("caisse.acomptes", "oui"), { value: true });
  assert.deepEqual(caisseValue("caisse.mentions_fr", "  Ligne 1\nLigne 2  "), { value: "Ligne 1\nLigne 2" });
});

test("changements : seulement les valeurs qui changent vraiment, dans l'ordre de l'écran ; une erreur n'enregistre rien", () => {
  const base = caisseValues(SETTINGS, "fr");
  assert.deepEqual(caisseChanges(base, { ...base, "caisse.tva_taux": "19.25" }), { changes: [] }, "19,25 retapé 19.25 : rien au journal");
  assert.deepEqual(caisseChanges(base, { ...base, "caisse.tva_active": "non", "institut.rccm": " RC/DLA/1 ", "caisse.moyens": "cash" }), {
    changes: [{ key: "institut.rccm", value: "RC/DLA/1" }, { key: "caisse.tva_active", value: false }, { key: "caisse.moyens", value: ["cash"] }],
  });
  assert.deepEqual(caisseChanges(base, { ...base, "institut.niu": "X", "caisse.remise_plafond": "150" }), { error: "reglages_caisse.erreur_plafond", key: "caisse.remise_plafond" });
});

test("changements en erreur : la clé du réglage fautif accompagne le message (retouche R3)", () => {
  const base = caisseValues(SETTINGS, "fr");
  assert.deepEqual(caisseChanges(base, { ...base, "caisse.tva_taux": "150" }), { error: "reglages_caisse.erreur_taux", key: "caisse.tva_taux" });
  assert.deepEqual(caisseChanges(base, { ...base, "caisse.remise_plafond": "120" }), { error: "reglages_caisse.erreur_plafond", key: "caisse.remise_plafond" });
  assert.deepEqual(caisseChanges(base, { ...base, "caisse.moyens": "" }), { error: "reglages_caisse.erreur_moyens", key: "caisse.moyens" });
});

test("taux et plafond ignorés quand leur case est décochée (correctif final)", () => {
  const base = caisseValues(SETTINGS, "fr");
  assert.deepEqual(
    caisseChanges(base, { ...base, "caisse.tva_taux": "150", "caisse.tva_active": "non" }),
    { changes: [{ key: "caisse.tva_active", value: false }] },
    "taux « 150 » ignoré, seule la TVA décochée est enregistrée",
  );
  assert.deepEqual(
    caisseChanges(base, { ...base, "caisse.remise_plafond": "120", "caisse.remises": "non" }),
    { changes: [{ key: "caisse.remises", value: false }] },
    "plafond « 120 » ignoré, seules les remises décochées sont enregistrées",
  );
  assert.deepEqual(
    caisseChanges(base, { ...base, "caisse.tva_taux": "150" }),
    { error: "reglages_caisse.erreur_taux", key: "caisse.tva_taux" },
    "TVA toujours active : erreur comme avant",
  );
});

test("rechargement pendant la saisie : un champ touché garde sa saisie, les autres prennent la valeur nouvelle", () => {
  const base = caisseValues(SETTINGS, "fr");
  const form = { ...base, "caisse.remise_plafond": "20" };
  const fresh = caisseValues(SETTINGS.map((s) => (s.key === "caisse.pourboires" ? { ...s, value: false } : s)), "fr");
  const merged = rebase(base, form, fresh);
  assert.equal(merged.form["caisse.remise_plafond"], "20");
  assert.equal(merged.form["caisse.pourboires"], "non");
});

test("rubrique « Caisse » : gérante, et administrateur pour le préfixe des factures ; adresse dans les deux langues", () => {
  assert.ok(sectionsFor("manager").some((s) => s.id === "caisse"));
  assert.ok(sectionsFor("admin").some((s) => s.id === "caisse"), "préfixe des factures (distribution D-01)");
  assert.equal(forbiddenSection("admin", "caisse"), false);
  for (const role of ["reception", "practitioner"] as const) {
    assert.ok(!sectionsFor(role).some((s) => s.id === "caisse"), role);
    assert.equal(forbiddenSection(role, "caisse"), true, role);
  }
  assert.equal(pathFor("reglages", "fr", "caisse"), "/reglages/caisse");
  assert.equal(pathFor("reglages", "en", "caisse"), "/settings/checkout");
  const route = parseRoute("/settings/checkout");
  assert.deepEqual([route.view, route.id], ["reglages", "caisse"]);
  assert.equal(sectionsFor("manager").findIndex((s) => s.id === "caisse"), sectionsFor("manager").findIndex((s) => s.id === "institut") + 1, "juste après « Institut »");
});

test("journal : les deux fonctions nouvelles ont un libellé traduit", () => {
  assert.equal(auditTarget("caisse.acomptes", "fr"), "Acomptes");
  assert.equal(auditTarget("caisse.acomptes", "en"), "Deposits");
  assert.equal(auditTarget("caisse.avoirs_reception", "fr"), "Avoirs émis par la réception");
  assert.equal(auditTarget("caisse.avoirs_reception", "en"), "Credit notes issued by reception");
});

test("préfixe des factures (distribution D-01) : modifiable seulement par qui l'écrit et avant la première facture ; saisie mise en majuscules", () => {
  const base = { key: "caisse.prefixe", secret: false, set: true };
  assert.deepEqual(prefixeEtat({ ...base, value: "FAC", editable: true, frozen: null }), { valeur: "FAC", fige: null, modifiable: true });
  assert.deepEqual(prefixeEtat({ ...base, value: "FAC", editable: false, frozen: null }), { valeur: "FAC", fige: null, modifiable: false }, "gérante : lecture seule");
  assert.deepEqual(prefixeEtat({ ...base, value: "XYZ", editable: false, frozen: { numero: "XYZ-2026-000001" } }), { valeur: "XYZ", fige: "XYZ-2026-000001", modifiable: false });
  assert.deepEqual(prefixeEtat({ ...base, value: "XYZ", editable: true, frozen: { numero: "XYZ-2026-000001" } }), { valeur: "XYZ", fige: "XYZ-2026-000001", modifiable: false }, "figé l'emporte");
  assert.equal(prefixeEtat(undefined), null, "réglage absent pour ce rôle");
  assert.deepEqual(prefixeSaisi(" xyz "), { value: "XYZ" });
  for (const ko of ["X", "ABCDEFG", "AB-C", "av", "ac", "", "1234"]) assert.deepEqual(prefixeSaisi(ko), { error: "reglages_caisse.prefixe_erreur" }, ko);
  assert.equal(auditTarget("caisse.prefixe", "fr"), "Préfixe des factures");
  assert.equal(auditTarget("caisse.prefixe", "en"), "Invoice prefix");
});
