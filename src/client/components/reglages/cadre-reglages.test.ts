import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en } from "../../i18n/en.ts";
import { fr } from "../../i18n/fr.ts";

/**
 * Cadre des Réglages (sous-projet 4 § 7.1) : liste des rubriques à gauche et
 * rubrique à droite dès que le cadre fait 42 rem ; au téléphone, la liste puis la
 * rubrique en plein écran avec retour. Reports D6 (onglet actif hors de
 * l'écran) et adresse d'une rubrique interdite gardée.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const cadre = read("./reglages.tsx");

test("plus d'onglets qui défilent (D6) : une liste verticale de rubriques, la rubrique ouverte marquée", () => {
  assert.doesNotMatch(cadre, /overflow-x-auto/, "plus de rangée d'onglets hors de l'écran");
  assert.match(cadre, /<nav aria-label=\{t\("reglages\.rubriques"\)\}/);
  assert.match(cadre, /aria-current=\{s\.id === current \? "page" : undefined\}/);
  assert.match(cadre, /min-h-12/, "rubriques de 48 px");
});

test("deux colonnes selon la largeur réelle du cadre (42 rem), jamais selon l'écran ; en dessous : l'une ou l'autre, avec retour (retouche 2)", () => {
  // Cadre de 580 px (820 px, rail déployé) : motif du téléphone ; 756 px (rail replié) et plus : côte à côte.
  assert.match(cadre, /<div className="@container\/reglages mx-auto max-w-6xl">/, "le cadre est le conteneur nommé");
  assert.match(cadre, /className="hors-panneau @2xl\/reglages:flex @2xl\/reglages:gap-8 @2xl\/reglages:px-8 @2xl\/reglages:py-6"/);
  assert.doesNotMatch(cadre, /\b(sm|md|lg|xl):/, "aucune variante selon la largeur de l'écran");
  assert.match(cadre, /@2xl\/reglages:w-56 @2xl\/reglages:shrink-0/, "colonne des rubriques de 14 rem");
  assert.match(cadre, /section !== null && "hidden @2xl\/reglages:block"/, "cadre étroit : rubrique ouverte, liste cachée");
  assert.match(cadre, /section === null && "hidden @2xl\/reglages:block"/, "cadre étroit : liste seule sur /reglages");
  assert.match(cadre, /@2xl\/reglages:hidden", FOCUS\)\}\s*>\s*<ChevronLeft/, "retour dans le cadre étroit seulement");
  assert.match(cadre, /<ChevronRight className="h-4 w-4 shrink-0 text-encre-grise @2xl\/reglages:hidden"/);
  assert.match(cadre, /\{t\("reglages\.retour"\)\}/);
  for (const dict of [fr, en]) assert.ok("reglages.retour" in dict);
  assert.equal(fr["reglages.retour"], "Tous les réglages");
  assert.equal(en["reglages.retour"], "All settings");
});

test("rubrique sans cadre à filet, séparée de la liste des rubriques par un filet vertical (retouche 5)", () => {
  const section = cadre.match(/<section className=\{cn\("([^"]*)"/)?.[1] ?? "";
  assert.ok(section, "rubrique introuvable");
  for (const cls of ["@2xl/reglages:border-l", "@2xl/reglages:border-filet", "@2xl/reglages:pl-8"]) {
    assert.ok(section.split(/\s+/).includes(cls), cls);
  }
  assert.doesNotMatch(section, /bg-card|rounded|:border(\s|$)|:p-6/, "plus de cadre ni de fond de carte autour de la rubrique");
});

test("fiche ouverte dans le panneau posé (768 à 1279 px) : la liste des rubriques s'efface pour laisser la place à la rubrique", () => {
  assert.match(cadre, /rubriques-reglages/);
  assert.match(cadre, /hors-panneau/);
  assert.match(read("../../styles.css"), /\.panneau-ouvert \.rubriques-reglages \{\s*display: none;\s*\}/);
});

test("adresse d'une rubrique interdite ou inconnue : remplacée par /reglages, jamais gardée affichée sur une autre rubrique", () => {
  const app = read("../../app.tsx");
  assert.match(app, /if \(view === "reglages" && forbiddenSection\(role, id, formation\)\) replace\(pathFor\("reglages", lang\)\);/);
});
