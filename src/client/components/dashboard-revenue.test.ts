import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Garde-fous D2 et constat 1 (audit-responsive.md, relecture finale), repris
 * sur l'accueil de la vague 3 (« Aujourd'hui ») : un chiffre d'affaires d'un
 * million de FCFA ou plus ne déborde jamais ; la grille des chiffres clés
 * suit la largeur réelle (rail déployé, panneau), pas celle de l'écran ; un
 * montant n'est jamais tronqué ni coupé au milieu (`ChiffreCle` passe par
 * `Montant`, comptoir.tsx).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const accueil = read("./accueil/aujourdhui.tsx");
const comptoir = read("./comptoir.tsx");

test("constat 1 : la grille des chiffres clés suit la place réelle, jamais les points de rupture de l'écran", () => {
  assert.match(accueil, /const CHIFFRES = "grid grid-cols-\[repeat\(auto-fit,minmax\(min\(100%,9rem\),1fr\)\)\] gap-3";/);
  assert.doesNotMatch(accueil, /sm:grid-cols-|lg:grid-cols-/);
});

test("D2 et constat 1 bis : chaque chiffre clé passe par ChiffreCle, dont la valeur passe par Montant, sans troncature", () => {
  assert.doesNotMatch(accueil, /<Card\b|Table\b/, "plus de cartes ni de tableau (colonne Prix coupée à 390 px, D15)");
  const valeur = comptoir.slice(comptoir.indexOf("export function ChiffreCle"), comptoir.indexOf("export function ListeComptoir"));
  assert.match(valeur, /<Montant valeur=\{valeur\} \/>/);
  assert.doesNotMatch(valeur.match(/<span className="max-w-full font-sans[^"]*"/)?.[0] ?? "", /truncate|break-words/);
  assert.match(accueil, /<ChiffreCle valeur=\{formatPrice\(figures\.plannedRevenue, lang\)\}/);
});
