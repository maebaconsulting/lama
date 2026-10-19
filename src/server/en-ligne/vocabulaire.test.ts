import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Vocabulaire anglais de la réservation en ligne (règle V1-38) : le mot interdit est composé ici
 * pour que ce garde-fou ne se dénonce pas lui-même.
 */
const RACINE = new URL("../../../", import.meta.url).pathname;
const INTERDIT = new RegExp(["boo", "king"].join(""), "i");

/** Fichiers livrés : les essais, qui vérifient justement l'absence du mot, sont laissés de côté. */
function sources(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "dist" || e.name === "node_modules") return [];
    const chemin = join(dossier, e.name);
    if (e.isDirectory()) return sources(chemin);
    return /\.(ts|tsx|js|md|css|html)$/.test(e.name) && !e.name.endsWith(".test.ts") ? [chemin] : [];
  });
}

test("réservation en ligne : jamais le mot anglais interdit, ni dans le code, ni dans les textes, ni dans les documents", () => {
  const fichiers = [
    ...sources(join(RACINE, "src/server/en-ligne")),
    ...sources(join(RACINE, "relais")),
    ...sources(join(RACINE, "docs/reservation-en-ligne")),
    join(RACINE, "src/client/i18n/en.ts"),
  ];
  const fautes = fichiers.flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((l, i) => (INTERDIT.test(l) ? [`${f.slice(RACINE.length)}:${i + 1}`] : [])));
  assert.deepEqual(fautes, []);
});
