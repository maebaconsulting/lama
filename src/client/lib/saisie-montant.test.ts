import assert from "node:assert/strict";
import { test } from "node:test";
import { editAmount } from "./saisie-montant.ts";

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
  assert.equal(editAmount(g("1 2345 000"), 6, 1_234_000, "insertText", "fr").amount, 12_345_000);
  assert.equal(editAmount("10000", 2, 10_000, "deleteContentBackward", "fr").amount, 1_000);
  assert.equal(editAmount("", 0, 5, "deleteContentBackward", "fr").amount, 0);
});

test("les champs de montant reformatés à la frappe passent tous par typeAmount", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const avoir = read("../components/caisse/formulaire-avoir.tsx");
  const acompte = read("../components/caisse/acompte-rdv.tsx");
  assert.match(avoir, /setRefund\(draft, i, \{ amount: typeAmount\(e, r\.amount, lang\) \}\)/);
  assert.match(acompte, /setDepositAmount\(draft, typeAmount\(e, draft\.amount, lang\)\)/);
  assert.match(acompte, /setDepositPayment\(draft, i, \{ amount: typeAmount\(e, p\.amount, lang\) \}\)/);
  for (const text of [avoir, acompte]) assert.doesNotMatch(text, /amount: parseAmount\(|parseAmount\(\(e\.currentTarget/);
});
