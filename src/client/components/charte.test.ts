import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./charte.tsx", import.meta.url), "utf8");

test("le spécimen de la charte est calculé au rendu, après la pose de la devise reçue du serveur", () => {
  assert.doesNotMatch(source, /^const SPECIMEN\b/m, "une constante de module est évaluée à l'import");
  assert.match(source, /function specimen\(\): string \{[^}]*formatPrice\(15000, "fr"\)/);
  assert.equal((source.match(/\{specimen\(\)\}/g) ?? []).length, 2);
});
