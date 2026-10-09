import assert from "node:assert/strict";
import { test } from "node:test";
import { DICTIONARIES } from "../i18n/translate.ts";
import { aroundAmount, blockerText, changeText, discountLabel, methodLabel, vatLabel } from "./caisse-texte.ts";
import { blocker, cashSuggestions, chooseMethod, PAD_KEYS, padAction, paymentsBody, pressKey, removeEntry, setReference, setTendered, settlementOf, startPayment, type PadKey } from "./paiement.ts";

/** Paiement de l'écran « Vente » (sous-projet 5 § 4.2), vérifié en exécution. */

const type = (keys: PadKey[], due: number, start = startPayment(["cash", "card", "orange_money", "momo"])) => keys.reduce((d, k) => pressKey(d, k, due), start);

test("pavé : chiffres, « 000 » et « Effacer » sur le versement d'espèces ; espèces choisies d'abord", () => {
  assert.deepEqual([...PAD_KEYS], ["7", "8", "9", "4", "5", "6", "1", "2", "3", "000", "0", "effacer"]);
  const d = type(["7", "000"], 59000);
  assert.deepEqual(d.entries, [{ method: "cash", amount: 7000, reference: "", proposed: false }]);
  assert.equal(pressKey(pressKey(d, "0", 59000), "effacer", 59000).entries[0].amount, 7000);
  assert.equal(startPayment(["card", "momo"]).method, "card", "sans espèces : le premier moyen activé");
  const big = type(["9", "9", "9", "9", "9", "9", "9", "9", "9"], 59000);
  assert.equal(big.entries[0].amount, 999_999_999);
  assert.equal(pressKey(big, "0", 59000).entries[0].amount, 999_999_999, "neuf chiffres au plus");
});

test("espèces : 70 000 reçus pour 59 000, reste nul, 11 000 à rendre ; montants rapides remplacés par la première touche", () => {
  const d = type(["7", "0", "000"], 59000);
  const s = settlementOf(d, 59000);
  assert.deepEqual([s.received, s.remaining, s.change], [70000, 0, 11000]);
  assert.equal(blocker(d, 59000), null);
  assert.deepEqual(paymentsBody(d, 59000), [{ method: "cash", amount: 59000, cash_given: 70000 }]);
  const quick = setTendered(startPayment(["cash"]), 60000, 59000);
  assert.deepEqual(quick.entries[0], { method: "cash", amount: 60000, reference: "", proposed: true });
  assert.equal(pressKey(quick, "5", 59000).entries[0].amount, 5, "la première touche remplace le montant rapide");
});

test("montants proposés aux espèces : l'exact qui solde le reste, puis trois montants ronds ; rien quand tout est réglé", () => {
  assert.deepEqual(cashSuggestions(startPayment(["cash", "card"]), 59000), [59000, 60000, 65000, 70000]);
  const apresCarte = chooseMethod(chooseMethod(startPayment(["cash", "card"]), "card", 59000), "cash", 59000);
  assert.deepEqual(cashSuggestions(pressKey(chooseMethod(startPayment(["cash", "card"]), "card", 59000), "5", 59000), 59000), [58995, 59000, 60000, 65000], "carte de 5 francs : l'exact suit le reste");
  assert.deepEqual(cashSuggestions(apresCarte, 59000), [59000, 60000, 65000, 70000], "carte choisie par erreur puis espèces");
  assert.deepEqual(cashSuggestions(type(["7", "0", "000"], 59000), 59000), [59000, 60000, 65000, 70000], "le versement d'espèces en cours ne compte pas");
});

test("paiement mixte : espèces puis Orange Money au reste, référence obligatoire avant d'émettre", () => {
  let d = type(["2", "0", "000"], 59000);
  d = chooseMethod(d, "orange_money", 59000);
  assert.deepEqual(d.entries[1], { method: "orange_money", amount: 39000, reference: "", proposed: true }, "montant proposé : le reste à payer");
  assert.equal(blocker(d, 59000), "reference");
  d = setReference(d, 1, "OM-4471");
  assert.equal(blocker(d, 59000), null);
  assert.deepEqual(paymentsBody(d, 59000), [{ method: "cash", amount: 20000, cash_given: 20000 }, { method: "orange_money", amount: 39000, reference: "OM-4471" }]);
  assert.equal(blocker(removeEntry(d, 0), 59000), "reste");
});

test("carte choisie par erreur : son montant proposé n'est pas acquis, le moyen change ; carte au-delà du reste refusée", () => {
  let d = chooseMethod(startPayment(["cash", "card"]), "card", 59000);
  d = chooseMethod(d, "cash", 59000);
  assert.deepEqual(d.entries, [{ method: "cash", amount: 0, reference: "", proposed: true }]);
  const over = type(["6", "0", "000"], 59000, chooseMethod(startPayment(["card"]), "card", 59000));
  assert.equal(blocker(over, 59000), "trop");
  assert.equal(blocker(startPayment(["cash"]), 59000), "reste");
});

test("textes : moyens, coupures à rendre (tablette et téléphone), remise, TVA, ce qui bloque", () => {
  assert.deepEqual([methodLabel("cash", "fr"), methodLabel("momo", "en"), methodLabel("orange_money", "fr")], ["Espèces", "MoMo", "Orange Money"]);
  assert.equal(changeText(11000, "fr"), "1\u00a0billet\u00a0de\u00a010\u202f000 + 1\u00a0billet\u00a0de\u00a01\u202f000");
  assert.equal(changeText(11000, "fr", true), "10\u202f000 + 1\u202f000");
  assert.equal(changeText(2700, "en"), "1\u00a0note\u00a0of\u00a02\u202f000 + 1\u00a0coin\u00a0of\u00a0500 + 2\u00a0coins\u00a0of\u00a0100");
  assert.equal(changeText(2700, "fr", true), "2\u202f000 + 500 + 2\u00a0×\u00a0100");
  assert.equal(changeText(1005, "fr"), "1\u00a0billet\u00a0de\u00a01\u202f000 + 5\u00a0F\u00a0en\u00a0petite\u00a0monnaie");
  assert.equal(discountLabel({ kind: "percent", value: 5, reason: "fidelite", note: "" }, "fr"), "Remise fidélité 5\u00a0%");
  assert.equal(discountLabel({ kind: "amount", value: 2000, reason: "autre", note: "anniversaire" }, "en"), "Discount: anniversaire");
  assert.equal(vatLabel(19.25, "fr"), "dont TVA 19,25\u00a0%");
  assert.equal(vatLabel(19.25, "en"), "incl. VAT 19.25%");
  assert.equal(blockerText("reste", 29000, "fr"), "Reste à payer\u00a0: 29\u202f000\u00a0F.");
});

// Retouche 9 (critique de la vague 1) : à 820 px, « + 1 / pièce de 50 » se coupait entre le nombre et la coupure.
test("coupures : chaque terme d'un seul tenant, la ligne ne se coupe qu'autour de « + » ; insécable entre le nombre et la coupure", () => {
  for (const lang of ["fr", "en"] as const) {
    for (const amount of [11000, 2700, 1005, 60, 88885]) {
      for (const term of changeText(amount, lang).split(" + ")) assert.doesNotMatch(term, / /, `${lang} ${amount} : « ${term} »`);
    }
    for (const key of ["caisse.billets.one", "caisse.billets.other", "caisse.pieces.one", "caisse.pieces.other"] as const) {
      assert.match(DICTIONARIES[lang][key], /^\{count\}\u00a0/, `${lang} ${key}`);
    }
  }
});

// Retouche 8 : le montant d'un libellé (« Encaisser 33 350 F », « Montant exact · 33 350 ») se compose en chiffres de la charte.
test("libellé et montant : le texte traduit est coupé autour du montant, dans l'ordre de la langue", () => {
  assert.deepEqual(aroundAmount("Encaisser 33\u202f350\u00a0F", "33\u202f350\u00a0F"), ["Encaisser ", "33\u202f350\u00a0F", ""]);
  assert.deepEqual(aroundAmount("Montant exact · 59\u202f000", "59\u202f000"), ["Montant exact · ", "59\u202f000", ""]);
  assert.deepEqual(aroundAmount("Payer 5 000 maintenant", "5 000"), ["Payer ", "5 000", " maintenant"]);
  assert.deepEqual(aroundAmount("Sans montant", "5 000"), ["Sans montant", "", ""], "montant absent : texte seul");
});

// Retouche 7 : au poste fixe, le pavé répond au clavier physique pendant l'étape de paiement.
test("clavier : chiffres, Retour arrière (« Effacer ») et Entrée (« Valider »), jamais dans un champ ni une fenêtre", () => {
  const key = (k: string, place: Parameters<typeof padAction>[1] = "libre", mod = false) => padAction({ key: k, ctrlKey: mod, metaKey: false, altKey: false }, place);
  for (const d of ["0", "1", "5", "9"]) assert.equal(key(d), d);
  assert.equal(key("Backspace"), "effacer");
  assert.equal(key("Enter"), "valider");
  assert.equal(key("a"), null);
  assert.equal(key("Delete"), null);
  assert.equal(key(" "), null, "Espace garde son rôle sur un bouton");
  assert.equal(key("5", "libre", true), null, "Ctrl ou Cmd + chiffre : raccourci du navigateur");
  assert.equal(padAction({ key: "5", ctrlKey: false, metaKey: true, altKey: false }, "libre"), null);
  assert.equal(padAction({ key: "5", ctrlKey: false, metaKey: false, altKey: true }, "libre"), null);
  assert.equal(key("5", "champ"), null, "référence de transaction : la frappe reste au champ");
  assert.equal(key("Backspace", "champ"), null);
  assert.equal(key("Enter", "champ"), null);
  assert.equal(key("5", "fenetre"), null, "fenêtre d'approbation ou de confirmation ouverte");
  assert.equal(key("Enter", "fenetre"), null);
  assert.equal(key("5", "pave"), "5", "touche du pavé cliquée à la souris, restée sous le focus");
  assert.equal(key("Enter", "pave"), "valider", "Entrée valide au lieu de rappuyer la touche cliquée");
  assert.equal(key("5", "controle"), "5");
  assert.equal(key("Backspace", "controle"), "effacer");
  assert.equal(key("Enter", "controle"), null, "Entrée sur « Retour au ticket » ou un moyen : action du bouton");
});
