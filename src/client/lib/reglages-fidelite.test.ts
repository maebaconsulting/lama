import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWhole, parseWholeAmount, pointsText } from "./fidelite.ts";
import { addTier, examplePoints, fideliteChanges, fideliteForm, removeTier, setTier } from "./reglages-fidelite.ts";
import { auditTarget } from "./libelles.ts";
import { parseRoute, pathFor } from "./routes.ts";
import { forbiddenSection, sectionsFor } from "./roles.ts";

/** Rubrique « Fidélité » des Réglages (mini CRM § 2) : formulaire, contrôles comme au serveur, exemple, adresse, journal. */

const SETTINGS = [
  { key: "fidelite.active", secret: false, value: false, set: true },
  { key: "fidelite.tranche", secret: false, value: 1000, set: true },
  { key: "fidelite.points", secret: false, value: 1, set: true },
  { key: "fidelite.paliers", secret: false, value: [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }], set: true },
];

test("formulaire : valeurs du serveur en texte ; exemple calculé ; nombres entiers saisis", () => {
  const form = fideliteForm(SETTINGS);
  assert.deepEqual(form, { crm: true, active: false, tranche: "1000", points: "1", tiers: [{ points: "100", montant: "5000" }, { points: "250", montant: "15000" }] });
  assert.equal(examplePoints(form), 23, "23 500 F rapportent 23 points");
  assert.equal(examplePoints({ ...form, tranche: "500", points: "2" }), 94);
  assert.equal(examplePoints({ ...form, tranche: "50" }), null, "règle refusée : pas d'exemple");
  assert.deepEqual(fideliteForm([]), { crm: true, active: false, tranche: "1000", points: "1", tiers: [{ points: "100", montant: "5000" }, { points: "250", montant: "15000" }] });
  assert.equal(parseWhole("1 000"), 1000);
  assert.equal(parseWhole("1\u202f000"), 1000);
  assert.equal(parseWhole("1,5"), null);
  assert.equal(parseWhole(""), null);
});

test("changements : seulement ce qui change ; premier champ fautif ; paliers contrôlés comme au serveur", () => {
  const base = fideliteForm(SETTINGS);
  assert.deepEqual(fideliteChanges(base, base), { changes: [] });
  assert.deepEqual(fideliteChanges(base, { ...base, tranche: "1 000" }), { changes: [] }, "même valeur retapée");
  assert.deepEqual(fideliteChanges(base, { ...base, active: true, points: "2" }), { changes: [{ key: "fidelite.active", value: true }, { key: "fidelite.points", value: 2 }] });
  assert.deepEqual(fideliteChanges(base, { ...base, tranche: "99" }), { error: "reglages_fidelite.erreur_tranche", field: "tranche" });
  assert.deepEqual(fideliteChanges(base, { ...base, points: "0" }), { error: "reglages_fidelite.erreur_points", field: "points" });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [{ points: "250", montant: "15000" }, { points: "100", montant: "5000" }] }), { error: "reglages_fidelite.erreur_paliers_ordre", field: "paliers" });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [{ points: "100", montant: "50" }] }), { error: "reglages_fidelite.erreur_paliers_montant", field: "paliers" });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [{ points: "dix", montant: "5000" }] }), { error: "reglages_fidelite.erreur_paliers_points", field: "paliers" });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [] }), { error: "reglages_fidelite.erreur_paliers_nombre", field: "paliers" });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [{ points: "50", montant: "2 000" }] }), { changes: [{ key: "fidelite.paliers", value: [{ points: 50, montant: 2000 }] }] });
});

test("paliers : ajout jusqu'à cinq, retrait, saisie d'un champ", () => {
  let form = fideliteForm(SETTINGS);
  form = addTier(addTier(addTier(form)));
  assert.equal(form.tiers.length, 5);
  assert.deepEqual(form.tiers[4], { points: "", montant: "" });
  assert.equal(addTier(form).tiers.length, 5, "cinq au plus");
  assert.deepEqual(removeTier(form, 0).tiers[0], { points: "250", montant: "15000" });
  assert.deepEqual(setTier(form, 1, { montant: "16000" }).tiers[1], { points: "250", montant: "16000" });
});

test("points écrits dans la langue de l'écran : accord, zéro, négatif, milliers", () => {
  assert.equal(pointsText(140, "fr"), "140\u00a0points");
  assert.equal(pointsText(1, "fr"), "1\u00a0point");
  assert.equal(pointsText(0, "fr"), "0\u00a0point");
  assert.equal(pointsText(0, "en"), "0\u00a0points");
  assert.equal(pointsText(1, "en"), "1\u00a0point");
  assert.equal(pointsText(-20, "fr"), "−20\u00a0points");
  assert.equal(pointsText(1200, "fr"), "1\u202f200\u00a0points");
});

test("rubrique « Fidélité » : gérante seule, juste après « Caisse », adresse dans les deux langues, libellés du journal", () => {
  assert.ok(sectionsFor("manager").some((s) => s.id === "fidelite"));
  for (const role of ["reception", "practitioner", "admin"] as const) {
    assert.ok(!sectionsFor(role).some((s) => s.id === "fidelite"), role);
    assert.equal(forbiddenSection(role, "fidelite"), true, role);
  }
  assert.equal(sectionsFor("manager").findIndex((s) => s.id === "fidelite"), sectionsFor("manager").findIndex((s) => s.id === "caisse") + 1);
  assert.equal(pathFor("reglages", "fr", "fidelite"), "/reglages/fidelite");
  assert.equal(pathFor("reglages", "en", "fidelite"), "/settings/loyalty");
  const route = parseRoute("/settings/loyalty");
  assert.deepEqual([route.view, route.id], ["reglages", "fidelite"]);
  assert.equal(auditTarget("fidelite.paliers", "fr"), "Paliers de récompense");
  assert.equal(auditTarget("fidelite.active", "en"), "Loyalty turned on or off");
});

test("montants en francs : séparateurs de milliers comme parseAmount, décimales refusées", () => {
  for (const text of ["15.000", "15,000", "15 000", "15\u202f000", "15000"]) assert.equal(parseWholeAmount(text), 15000, text);
  assert.equal(parseWholeAmount("1.000"), 1000);
  assert.equal(parseWholeAmount("1.500.000"), 1500000);
  for (const text of ["1,5", "2.50", "", "dix", "15.00"]) assert.equal(parseWholeAmount(text), null, text);
  const base = fideliteForm(SETTINGS);
  assert.deepEqual(fideliteChanges(base, { ...base, tranche: "1.000" }), { changes: [] });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [{ points: "100", montant: "15.000" }] }), { changes: [{ key: "fidelite.paliers", value: [{ points: 100, montant: 15000 }] }] });
  assert.deepEqual(fideliteChanges(base, { ...base, tiers: [{ points: "100", montant: "1,5" }] }), { error: "reglages_fidelite.erreur_paliers_montant", field: "paliers" });
});
