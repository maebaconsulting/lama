import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesSearch, pickText } from "./bilingual.ts";

test("l'anglais s'il est rempli et si l'écran est en anglais, sinon le français (spec § 5.2)", () => {
  assert.equal(pickText("en", "Soin du visage", "Facial"), "Facial");
  assert.equal(pickText("fr", "Soin du visage", "Facial"), "Soin du visage");
  assert.equal(pickText("en", "Soin du visage", ""), "Soin du visage");
  assert.equal(pickText("en", "Soin du visage", "   "), "Soin du visage", "espaces seules : repli sur le français");
  assert.equal(pickText("en", "Soin du visage", null), "Soin du visage");
  assert.equal(pickText("en", null, undefined), "");
});

test("la recherche trouve un nom français ou anglais, sans tenir compte des majuscules ni des accents", () => {
  assert.equal(matchesSearch("visage", "Soin du visage", "Facial"), true);
  assert.equal(matchesSearch("FACIAL", "Soin du visage", "Facial"), true);
  assert.equal(matchesSearch("epilation", "Épilation des jambes", ""), true);
  assert.equal(matchesSearch("massage", "Soin du visage", "Facial"), false);
  assert.equal(matchesSearch("  ", "Soin du visage"), true, "recherche vide : tout correspond");
  assert.equal(matchesSearch("x", null, undefined), false);
});
