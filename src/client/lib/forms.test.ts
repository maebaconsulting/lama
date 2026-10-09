import assert from "node:assert/strict";
import { test } from "node:test";
import { translate } from "../i18n/translate.ts";
import { amountProblem, confirmationProblem, loginProblem, lowStockValue, nameProblem, newAccountProblem, passwordProblem, pinProblem } from "./forms.ts";

test("mêmes règles que le serveur, messages par clés traduites dans les deux langues", () => {
  assert.equal(nameProblem("  "), "formulaire.nom_obligatoire");
  assert.equal(nameProblem("Grace"), null);
  assert.equal(loginProblem("gr"), "formulaire.identifiant_invalide");
  assert.equal(loginProblem("grace.n"), null);
  assert.equal(passwordProblem("court"), "formulaire.mot_de_passe_court");
  assert.equal(passwordProblem("éééééééééé"), null, "10 caractères accentués suffisent");
  assert.equal(confirmationProblem("motdepasse10", "motdepasse11"), "formulaire.confirmation_differente");
  assert.equal(pinProblem("12a4"), "formulaire.pin_format");
  assert.equal(pinProblem("2580"), null);
  assert.equal(translate("fr", "formulaire.nom_obligatoire"), "Le nom est obligatoire.");
  assert.equal(translate("en", "formulaire.pin_format"), "The PIN must have 4 to 6 digits.");
});

test("premier problème d'un nouveau compte, PIN facultatif", () => {
  const ok = { display_name: "Dan", login: "dan", password: "motdepasse10", confirmation: "motdepasse10", pin: "" };
  assert.equal(newAccountProblem(ok), null);
  assert.equal(newAccountProblem({ ...ok, pin: "25" }), "formulaire.pin_format");
  assert.equal(newAccountProblem({ ...ok, pin: "1234" }), "formulaire.pin_simple", "refusé avant la confirmation du mot de passe");
  assert.equal(newAccountProblem({ ...ok, display_name: "", login: "x" }), "formulaire.nom_obligatoire");
  assert.equal(newAccountProblem({ ...ok, confirmation: "autre-chose" }), "formulaire.confirmation_differente");
});

test("PIN trop simple refusé à l'écran, comme par le serveur", () => {
  for (const pin of ["0000", "1234", "4321", "1212", "123456", "987654", "999999"]) assert.equal(pinProblem(pin), "formulaire.pin_simple", pin);
  for (const pin of ["2580", "1357", "13579", "120394"]) assert.equal(pinProblem(pin), null, pin);
  assert.equal(translate("fr", "formulaire.pin_simple"), "Ce code PIN est trop simple, choisissez-en un autre.");
  assert.equal(translate("en", "formulaire.pin_simple"), "This PIN is too simple, choose another one.");
});

test("seuil d'alerte de stock (V1-19) : 0 reste 0, un champ vide ou illisible vaut 5", () => {
  assert.equal(lowStockValue("0"), 0);
  assert.equal(lowStockValue("12"), 12);
  assert.equal(lowStockValue(""), 5);
  assert.equal(lowStockValue("abc"), 5);
});

test("prix ou coût illisible : refusé par une clé traduite, jamais enregistré à 0 F (décision 8, V1-12)", () => {
  assert.equal(amountProblem("abc", "prix"), "formulaire.prix_illisible");
  assert.equal(amountProblem("douze mille", "prix"), "formulaire.prix_illisible");
  assert.equal(amountProblem("3 5OO francs", "cout"), "formulaire.cout_illisible");
  assert.equal(amountProblem("", "prix"), null, "vide reste permis (0 F, prestation offerte)");
  assert.equal(amountProblem("15 000", "prix"), null);
  assert.equal(amountProblem("15.000", "cout"), null);
  for (const key of ["formulaire.prix_illisible", "formulaire.cout_illisible"] as const) {
    assert.match(translate("fr", key), /illisible\u00a0: saisissez un nombre de francs en chiffres/);
    assert.match(translate("en", key), /cannot be read/);
  }
});
