import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createLongPressGate } from "./appui-long.ts";

const DELAI = 500;

test("rail replié : relâcher après un appui long affiche le libellé sans ouvrir l'écran (décision D6)", () => {
  const gate = createLongPressGate(DELAI);
  gate.press(1000);
  assert.equal(gate.ignoreClick(1000 + DELAI, false), true, "clic qui suit un appui long ignoré");
  // Le clic suivant, lui, navigue normalement.
  assert.equal(gate.ignoreClick(3000, false), false);
});

test("un appui bref ouvre l'écran", () => {
  const gate = createLongPressGate(DELAI);
  gate.press(1000);
  assert.equal(gate.ignoreClick(1000 + DELAI - 1, false), false);
});

test("un appui interrompu (défilement) ou un pointeur non tactile n'annule aucun clic", () => {
  const gate = createLongPressGate(DELAI);
  gate.press(1000);
  gate.cancel();
  assert.equal(gate.ignoreClick(2000, false), false);
  // Souris : pas d'appui long, clic toujours pris.
  assert.equal(gate.ignoreClick(5000, false), false);
});

test("un clic au clavier (Entrée, Espace) n'est jamais ignoré, même après un appui long resté sans clic", () => {
  const gate = createLongPressGate(DELAI);
  gate.press(1000);
  assert.equal(gate.ignoreClick(9000, true), false);
  assert.equal(gate.ignoreClick(9500, false), false, "l'appui long est oublié après le premier clic");
});

test("le rail branche la garde sur les boutons repliés", () => {
  const rail = readFileSync(new URL("../components/cadre/rail.tsx", import.meta.url), "utf8");
  assert.match(rail, /createLongPressGate\(LONG_PRESS_MS\)/);
  assert.match(rail, /gate\.current\.press\(e\.timeStamp\)/);
  assert.match(rail, /ignoreClick\(e\.timeStamp, e\.detail === 0\)/);
});
