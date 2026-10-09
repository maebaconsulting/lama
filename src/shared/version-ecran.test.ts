import assert from "node:assert/strict";
import { test } from "node:test";
import { ecranAccepte, VERSION_ECRAN, VERSION_ECRAN_MINIMALE } from "./version-ecran.ts";

test("version d'écran : l'écran de cette fabrication est accepté par le serveur de la même fabrication", () => {
  assert.ok(VERSION_ECRAN >= VERSION_ECRAN_MINIMALE);
  assert.equal(ecranAccepte(String(VERSION_ECRAN)), true);
});

test("version d'écran : seul un écran plus ancien que la minimale est refusé ; sans en-tête ou illisible, accepté", () => {
  assert.equal(ecranAccepte("1", 2), false);
  assert.equal(ecranAccepte("0", 1), false);
  assert.equal(ecranAccepte("2", 2), true);
  assert.equal(ecranAccepte("3", 2), true);
  for (const entete of [undefined, null, "", "  ", "abc", "1.5"]) assert.equal(ecranAccepte(entete, 2), true, String(entete));
});
