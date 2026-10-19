import assert from "node:assert/strict";
import { test } from "node:test";
import { editAmount, texteRendu } from "./saisie-montant.ts";
import { definirDevise } from "../../shared/devise-active.ts";

/**
 * Restes de la V 1.0, point 2 : curseur d'un champ de montant reformaté à la
 * frappe (avoir, acompte). La position suit le nombre de chiffres à sa gauche.
 * `|` marque le curseur dans les cas écrits ci-dessous.
 */
const THIN = "\u202f";
const g = (text: string) => text.replaceAll(" ", THIN);

/** Frappe `raw` (curseur au `|`) sur un champ qui valait `previous` ; rend le texte reformaté avec son curseur. */
function type(raw: string, previous: number, inputType = "insertText"): string {
  const caret = raw.indexOf("|");
  const edit = editAmount(g(raw.replace("|", "")), caret, previous, inputType, "fr");
  return edit.text.slice(0, edit.caret) + "|" + edit.text.slice(edit.caret);
}

test("a : chiffres tapés au milieu, le nombre gagne un séparateur, le curseur reste après le chiffre tapé", () => {
  assert.equal(type("123| 000", 12_000), g("123| 000"));
  assert.equal(type("1234| 000", 123_000), g("1 234| 000"));
  assert.equal(type("1 2345| 000", 1_234_000), g("12 345| 000"));
});

test("b : Retour arrière juste après l'espace des milliers efface le chiffre qui le précède", () => {
  // « 10 000 », curseur après l'espace : le navigateur a retiré l'espace seul.
  assert.equal(type("10|000", 10_000, "deleteContentBackward"), g("1| 000"));
  // Suppr juste avant l'espace : le chiffre qui le suit.
  assert.equal(type("10|000", 10_000, "deleteContentForward"), g("1 0|00"));
});

test("insertion au début, au milieu et à la fin", () => {
  assert.equal(type("5|12 000", 12_000), g("5|12 000"));
  assert.equal(type("2 05|00", 2_000), g("20 5|00"));
  assert.equal(type("12 0007|", 12_000), g("120 007|"));
  assert.equal(type("0|12 000", 12_000), g("|12 000"), "zéro de tête ignoré, curseur devant le premier chiffre");
});

test("Retour arrière ordinaire : le groupage suit, le curseur reste après le chiffre précédent", () => {
  assert.equal(type("1 00| 000", 1_000_000, "deleteContentBackward"), g("100| 000"));
  assert.equal(type("| 000", 1_000, "deleteContentBackward"), "|", "plus rien : champ vide");
});

test("collage d'un montant écrit à la main", () => {
  assert.equal(type("15000|", 0, "insertFromPaste"), g("15 000|"));
  assert.equal(type(`15 000 F|`, 0, "insertFromPaste"), g("15 000|"));
  assert.equal(type("122500| 000", 12_000, "insertFromPaste"), g("122 500| 000"), "collé au milieu : curseur après le dernier chiffre collé");
});

test("le montant rendu est celui de la saisie", () => {
  assert.equal(editAmount(g("1 2345 000"), 6, 1_234_000, "insertText", "fr", "").amount, 12_345_000);
  assert.equal(editAmount("10000", 2, 10_000, "deleteContentBackward", "fr", "").amount, 1_000);
  assert.equal(editAmount("", 0, 5, "deleteContentBackward", "fr", "").amount, 0);
});

test("les champs de montant reformatés à la frappe passent tous par typeAmount", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const avoir = read("../components/caisse/formulaire-avoir.tsx");
  const acompte = read("../components/caisse/acompte-rdv.tsx");
  assert.match(avoir, /setRefund\(draft, i, \{ amount: typeAmount\(e, r\.amount, lang, avant\) \}\)/);
  assert.match(acompte, /setDepositAmount\(draft, typeAmount\(e, draft\.amount, lang, avant\)\)/);
  assert.match(acompte, /setDepositPayment\(draft, i, \{ amount: typeAmount\(e, p\.amount, lang, avant\) \}\)/);
  for (const text of [avoir, acompte]) assert.doesNotMatch(text, /amount: parseAmount\(|parseAmount\(\(e\.currentTarget/);
  for (const text of [avoir, acompte]) {
    assert.match(text, /<ChampMontant/, "le champ garde le texte tapé (texteRendu)");
    assert.doesNotMatch(text, /value=\{[^}]*formatAmount/, "plus de value recalculée par formatAmount");
  }
});

test("champ de montant en euros : la virgule en cours de frappe reste", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    assert.deepEqual(editAmount("15", 2, 0, "insertText", "fr", ""), { amount: 1500, text: "15", caret: 2 });
    assert.deepEqual(editAmount("15,", 3, 1500, "insertText", "fr", ""), { amount: 1500, text: "15,", caret: 3 });
    assert.deepEqual(editAmount("15,5", 4, 1500, "insertText", "fr", ""), { amount: 1550, text: "15,5", caret: 4 });
    assert.deepEqual(editAmount("15000", 5, 0, "insertText", "fr", ""), { amount: 1500000, text: "15\u202f000", caret: 6 });
    assert.deepEqual(editAmount("15.5", 4, 1500, "insertText", "en", ""), { amount: 1550, text: "15.5", caret: 4 });
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});

test("euros : le texte que le champ rendra égale le texte tapé (« 1 », « 15 », « 15, », « 15,5 »)", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    let previous = 0;
    for (const typed of ["1", "15", "15,", "15,5", "15,55"]) {
      const edit = editAmount(typed, typed.length, previous, "insertText", "fr", "");
      assert.equal(texteRendu(edit.text, edit.amount, "fr", true), typed, typed);
      previous = edit.amount;
    }
    // Montant posé par le programme : le texte tapé n'est plus le bon.
    assert.equal(texteRendu("15,", 0, "fr", true), "");
    assert.equal(texteRendu("15,", 2500, "fr", true), "25,00");
    assert.equal(texteRendu(null, 1550, "fr", true), "15,50");
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});

test("XAF : le texte rendu reste le montant groupé d'avant", () => {
  assert.equal(texteRendu(null, 15000, "fr", true), "15\u202f000");
  assert.equal(texteRendu("15\u202f000", 15000, "fr", true), "15\u202f000");
  assert.equal(texteRendu(null, 0, "fr", true), "");
  assert.equal(texteRendu(null, 0, "fr", false), "0");
});

test("euros : un chiffre de plus après les décimales complètes est refusé", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    assert.deepEqual(editAmount("15,555", 6, 1555, "insertText", "fr", "15,55"), { amount: 1555, text: "15,55", caret: 5 });
    assert.deepEqual(editAmount("15.555", 6, 1555, "insertText", "en", "15.55"), { amount: 1555, text: "15.55", caret: 5 });
    assert.deepEqual(editAmount("15,515", 5, 1555, "insertText", "fr", "15,55"), { amount: 1555, text: "15,55", caret: 5 });
    assert.deepEqual(editAmount("1.500", 5, 0, "insertFromPaste", "fr", ""), { amount: 150000, text: "1\u202f500", caret: 5 });
    assert.deepEqual(editAmount("15,56", 5, 1555, "insertText", "fr", "15,5"), { amount: 1556, text: "15,56", caret: 5 });
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
  assert.equal(editAmount("1.500", 5, 150, "insertText", "fr", "").amount, 1500);
});

test("euros : champ prérempli, insertion au milieu des décimales refusée", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    const prerempli = texteRendu(null, 1550, "fr", true);
    assert.equal(prerempli, "15,50");
    assert.deepEqual(editAmount("15,510", 5, 1550, "insertText", "fr", prerempli), { amount: 1550, text: "15,50", caret: 5 });
    // Réinitialisation par le programme (nouveau montant) : le texte précédent est le texte rendu du nouveau montant.
    const reinit = texteRendu("15,5", 2500, "fr", true);
    assert.equal(reinit, "25,00");
    assert.deepEqual(editAmount("25,100", 4, 2500, "insertText", "fr", reinit), { amount: 2500, text: "25,00", caret: 5 });
    assert.deepEqual(editAmount("25,01", 5, 2500, "insertText", "fr", "25,0"), { amount: 2501, text: "25,01", caret: 5 });
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});
