import assert from "node:assert/strict";
import { test } from "node:test";
import { SAMPLE_LENGTHS, estimateTemplate, smsCount } from "./sms.ts";

test("alphabet GSM : 160 caractères pour un SMS, 153 par segment au-delà ; é è à ù restent en GSM", () => {
  assert.deepEqual(smsCount("Bonjour Aïcha"), { encoding: "unicode", units: 13, segments: 1 }, "ï n'est pas dans l'alphabet GSM");
  assert.deepEqual(smsCount("Votre rendez-vous est confirmé à 10:00, à très vite."), { encoding: "gsm", units: 52, segments: 1 });
  assert.equal(smsCount("a".repeat(160)).segments, 1);
  assert.equal(smsCount("a".repeat(161)).segments, 2);
  assert.equal(smsCount("a".repeat(306)).segments, 2);
  assert.equal(smsCount("a".repeat(307)).segments, 3);
});

test("extension GSM comptée double ; un caractère hors alphabet passe tout le texte en Unicode (70, puis 67)", () => {
  assert.deepEqual(smsCount("Prix : 10 €"), { encoding: "gsm", units: 12, segments: 1 });
  assert.equal(smsCount("€".repeat(80)).segments, 1);
  assert.equal(smsCount("€".repeat(81)).segments, 2);
  assert.deepEqual(smsCount("À bientôt"), { encoding: "unicode", units: 9, segments: 1 });
  assert.equal(smsCount("ê" + "a".repeat(69)).segments, 1);
  assert.equal(smsCount("ê" + "a".repeat(70)).segments, 2);
  assert.equal(smsCount("ê" + "a".repeat(133)).segments, 2);
  assert.equal(smsCount("ê" + "a".repeat(134)).segments, 3);
  assert.equal(smsCount("Bonjour\u00a0!").encoding, "unicode", "espace insécable hors alphabet");
  assert.deepEqual(smsCount(""), { encoding: "gsm", units: 0, segments: 0 });
});

test("estimation d'un texte à variables : longueurs types, variable inconnue laissée telle quelle", () => {
  assert.equal(estimateTemplate("Bonjour {prenom}"), 1);
  const fr = "Bonjour {prenom}, nous vous rappelons votre rendez-vous {prestation} le {date} à {heure} chez {institut}. À bientôt\u00a0!";
  assert.equal(estimateTemplate(fr), 3, "« À » et l'espace insécable : Unicode");
  const en = "Hello {prenom}, this is a reminder of your {prestation} appointment on {date} at {heure} at {institut}. See you soon!";
  assert.equal(estimateTemplate(en), 1);
});

test("estimation du texte d'un produit recommandé : {produit} et {prix} à leur longueur type", () => {
  assert.equal(estimateTemplate("{prenom}, here is {produit} ({prix}), which we recommend at {institut}."), 1);
  assert.equal(estimateTemplate("{produit}".repeat(6)), 2, "six noms de produit de 30 caractères : 180, deux SMS");
});

test("longueur type du prix : 16 caractères (montant à centimes avec libellé)", () => {
  assert.equal(SAMPLE_LENGTHS.prix, 16);
});
