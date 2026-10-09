import assert from "node:assert/strict";
import { test } from "node:test";
import { accountPatch, accountPatchProblem, changedKeys, changedKeysIn, rebase, restoreProblem, valuesOf } from "./reglages.ts";

const settings = [
  { key: "institut.nom", secret: false, value: "Institut Akwa", set: true },
  { key: "postes.verrouillage_minutes", secret: false, value: 5, set: true },
  { key: "whatsapp.jeton_acces", secret: true, value: null, set: false },
];

test("valeurs des réglages en texte, vide si absent", () => {
  assert.deepEqual(valuesOf(settings, ["institut.nom", "postes.verrouillage_minutes", "institut.adresse"]), {
    "institut.nom": "Institut Akwa", "postes.verrouillage_minutes": "5", "institut.adresse": "",
  });
});

test("seuls les champs modifiés sont enregistrés", () => {
  assert.deepEqual(changedKeys({ a: "1", b: "2" }, { a: "1", b: "3" }), ["b"]);
  assert.deepEqual(changedKeys({ a: "1" }, { a: "1" }), []);
});

test("rebase : sans saisie, tout prend la valeur fraîche", () => {
  const baseline = { a: "1", b: "2" };
  const form = { a: "1", b: "2" };
  const fresh = { a: "9", b: "8" };
  assert.deepEqual(rebase(baseline, form, fresh), { baseline: fresh, form: fresh });
});

test("rebase : un champ modifié garde sa saisie, les autres se mettent à jour", () => {
  const baseline = { a: "1", b: "2" };
  const form = { a: "1", b: "modifié" };
  const fresh = { a: "9", b: "8" };
  assert.deepEqual(rebase(baseline, form, fresh), {
    baseline: { a: "9", b: "2" },
    form: { a: "9", b: "modifié" },
  });
});

test("rebase : changedKeys sur le résultat ne contient que le champ modifié", () => {
  const baseline = { a: "1", b: "2" };
  const form = { a: "1", b: "modifié" };
  const fresh = { a: "9", b: "8" };
  const { baseline: nextBaseline, form: nextForm } = rebase(baseline, form, fresh);
  assert.deepEqual(changedKeys(nextBaseline, nextForm), ["b"]);
});

const grace = { id: 4, display_name: "Grace", login: "grace", role: "practitioner" as const, staff_id: 7, active: 1, has_pin: true, locked_until: null, language: "fr" as const };
const intact = { display_name: "Grace", active: true, password: "", pin: "", removePin: false, staff_id: "7", language: "fr" as const };

test("modification de compte : seulement ce qui change", () => {
  assert.deepEqual(accountPatch(grace, intact), {});
  assert.deepEqual(accountPatch(grace, { ...intact, active: false }), { active: false });
  assert.deepEqual(accountPatch(grace, { ...intact, display_name: " Grace N. ", password: "nouveau-mdp-10", staff_id: "9" }), {
    display_name: "Grace N.", password: "nouveau-mdp-10", staff_id: 9,
  });
  assert.deepEqual(accountPatch(grace, { ...intact, pin: "2580" }), { pin: "2580" });
  assert.deepEqual(accountPatch(grace, { ...intact, pin: "2580", removePin: true }), { pin: null });
  const reception = { ...grace, role: "reception" as const, staff_id: null };
  assert.deepEqual(accountPatch(reception, { ...intact, staff_id: "" }), {}, "fiche ignorée hors praticienne");
});

test("modification de compte : contrôles avant envoi", () => {
  assert.equal(accountPatchProblem(intact), null);
  assert.equal(accountPatchProblem({ ...intact, display_name: " " }), "formulaire.nom_obligatoire");
  assert.equal(accountPatchProblem({ ...intact, password: "court" }), "formulaire.mot_de_passe_court");
  assert.equal(accountPatchProblem({ ...intact, pin: "12" }), "formulaire.pin_format");
  assert.equal(accountPatchProblem({ ...intact, pin: "12", removePin: true }), null);
});

const restauration = { source: "usb" as const, name: "lama-20260928-0200.db.gz.age", identity: "AGE-SECRET-KEY-1QQQ", understood: true };

test("restauration : nom de sauvegarde, clé privée et accord explicite exigés", () => {
  assert.equal(restoreProblem(restauration), null);
  assert.equal(restoreProblem({ ...restauration, name: "../lama.db" }), "restauration.probleme.nom");
  assert.equal(restoreProblem({ ...restauration, identity: "age1abc" }), "restauration.probleme.cle");
  assert.equal(restoreProblem({ ...restauration, understood: false }), "restauration.probleme.compris");
  assert.equal(restoreProblem({ ...restauration, identity: "  AGE-SECRET-KEY-1QQQ\n" }), null, "espaces et retour à la ligne tolérés");
});

test("modification de compte : la langue n'est envoyée que si elle change", () => {
  const target = { ...grace, language: "fr" as const };
  assert.deepEqual(accountPatch(target, { ...intact, language: "fr" }), {});
  assert.deepEqual(accountPatch(target, { ...intact, language: "en" }), { language: "en" });
});

test("changedKeysIn : seuls les champs du groupe, même si un autre formulaire a des modifications", () => {
  const before = { a: "1", b: "2", c: "3" };
  const after = { a: "9", b: "2", c: "8" };
  assert.deepEqual(changedKeysIn(before, after, ["a", "b"]), ["a"]);
  assert.deepEqual(changedKeysIn(before, after, ["b"]), []);
});
