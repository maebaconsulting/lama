import assert from "node:assert/strict";
import { test } from "node:test";
import { translate } from "../i18n/translate.ts";
import { FALLBACK_INK, STAFF_INKS, STATUS_INKS, contrastRatio, statusInk, toInk } from "./inks.ts";

const IVOIRE = "#F3EEE4";
const PAPIER = "#FBF9F4";

test("chaque encre de statut est lisible en texte sur ivoire et papier (AA)", () => {
  for (const [status, ink] of Object.entries(STATUS_INKS)) {
    assert.ok(contrastRatio(ink, IVOIRE) >= 4.5, `${status} sur ivoire`);
    assert.ok(contrastRatio(ink, PAPIER) >= 4.5, `${status} sur papier`);
  }
});

test("chaque encre de praticienne tient au moins 3:1 sur ivoire", () => {
  assert.equal(STAFF_INKS.length, 8);
  for (const { name, hex } of STAFF_INKS) assert.ok(contrastRatio(hex, IVOIRE) >= 3, name);
});

test("contrastRatio est symétrique et vaut 1 pour une même couleur", () => {
  assert.equal(contrastRatio("#161514", "#161514"), 1);
  assert.equal(contrastRatio("#161514", IVOIRE), contrastRatio(IVOIRE, "#161514"));
});

test("toInk ramène les anciennes couleurs vives à l'encre de teinte la plus proche", () => {
  assert.equal(toInk("#3b82f6"), "#4A5D73"); // bleu → ardoise
  assert.equal(toInk("#10b981"), "#35544A"); // vert → bouteille
  assert.equal(toInk("#8b5cf6"), "#6D6480"); // violet → lilas
  assert.equal(toInk("#ec4899"), "#8C5A6B"); // rose → rose
  assert.equal(toInk("#f59e0b"), "#8C5A6B"); // ambre → rose, jamais un doré
  assert.equal(toInk("#14b8a6"), "#2F5D62"); // sarcelle → pétrole (12,5° du pétrole contre 12,8° de la bouteille)
});

test("toInk garde une encre déjà conforme, quelle que soit la casse", () => {
  assert.equal(toInk("#6b4660"), "#6B4660");
  assert.equal(toInk("#2F5D62"), "#2F5D62");
});

test("toInk renvoie l'anthracite pour un gris ou une valeur invalide", () => {
  assert.equal(toInk("#6b7280"), "#4A5D73"); // gris bleuté (saturation 0,09) → ardoise
  assert.equal(toInk("#808080"), FALLBACK_INK);
  for (const bad of ["", "red", "#abc", "#12345", null, undefined]) assert.equal(toInk(bad), FALLBACK_INK);
});

test("statusInk connaît les six statuts et replie sur l'encre grise", () => {
  assert.equal(statusInk("cancelled"), "#7A1F1F");
  assert.equal(statusInk("inconnu"), "#6E6A64");
});

test("chaque encre a un nom dans les deux langues", () => {
  assert.deepEqual(STAFF_INKS.map((ink) => translate("en", ink.labelKey)),
    ["slate", "sage", "plum", "petrol blue", "lilac", "bottle green", "dusty rose", "charcoal"]);
  assert.deepEqual(STAFF_INKS.map((ink) => translate("fr", ink.labelKey)),
    ["ardoise", "sauge", "prune", "bleu pétrole", "lilas", "vert bouteille", "vieux rose", "anthracite"]);
});
