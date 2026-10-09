import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Garde-fou D13 (audit-responsive.md) : le bandeau d'erreur doit être
 * opaque, avec des marges des deux côtés, et son bouton de fermeture doit
 * faire au moins 44 x 44 px.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("D13 : le bandeau d'erreur est opaque, avec marges, et un bouton de fermeture de 44 px", () => {
  const text = read("./error-banner.tsx");
  assert.doesNotMatch(text, /bg-destructive\/10/, "le fond doit être opaque, pas translucide");
  assert.match(text, /inset-x-4/, "des marges des deux côtés, pas seulement à droite");
  assert.match(text, /safe-area-inset-bottom/, "ne doit pas empiéter sur l'indicateur d'accueil de l'iPhone");
  assert.match(text, /h-11 w-11/, "bouton de fermeture d'au moins 44 x 44 px");
});
