import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRatio } from "./lib/inks.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("le compteur de stock bas reste lisible sur le cuir du rail et de « Plus »", () => {
  const navigation = read("./components/cadre/navigation.tsx");
  const badge = navigation.match(/<span\b[^>]*>\s*\{stats\.low_stock_products\}\s*<\/span>/g) ?? [];
  assert.ok(badge.length > 0, "compteur de stock bas introuvable");
  for (const b of badge) {
    // Aplat de l'encre rouge du thème, chiffre de sa couleur de texte (contraste vérifié par theme-contrast).
    assert.match(b, /bg-destructive/, "fond plein encre rouge attendu");
    assert.match(b, /text-destructive-foreground/, "chiffre clair sur rouge (sombre sur rouge éclairci en sombre) attendu");
  }
  assert.ok(contrastRatio("#FFFFFF", "#7A1F1F") >= 4.5);
});

test("aucune séquence d'échappement d'espace insécable n'est écrite en clair dans le JSX de la charte", () => {
  // En JSX, le texte brut entre balises et les attributs en chaîne simple ("...")
  // ne sont pas interprétés comme des chaînes JS : " " y resterait affiché
  // tel quel (barre oblique inverse visible) au lieu de produire l'espace réelle.
  // Seule une expression JS entre accolades et guillemets ({"... ..."}) est sûre.
  const charte = read("./components/charte.tsx");
  const sansExpressionsJs = charte.replace(/\{"(?:[^"\\]|\\.)*"\}/g, "");
  const attributsSuspects = [...sansExpressionsJs.matchAll(/="[^"]*\\u[0-9a-fA-F]{4}[^"]*"/g)].map((m) => m[0]);
  const texteSuspect = [...sansExpressionsJs.matchAll(/>[^<>{}]*\\u[0-9a-fA-F]{4}[^<>{}]*</g)].map((m) => m[0]);
  assert.deepEqual(attributsSuspects, [], `attribut JSX avec échappement littéral : ${attributsSuspects.join(", ")}`);
  assert.deepEqual(texteSuspect, [], `texte JSX avec échappement littéral : ${texteSuspect.join(", ")}`);
});

test("aucune graisse n'est synthétisée : gras et demi-gras pointent vers une graisse chargée", () => {
  const css = read("./styles.css");
  assert.match(css, /--font-weight-semibold:\s*500/);
  assert.match(css, /--font-weight-bold:\s*500/);
  const main = read("./main.tsx");
  for (const family of ["eb-garamond", "jost"]) {
    assert.match(main, new RegExp(`@fontsource/${family}/500\\.css`), `${family} 500 non chargée`);
  }
});
