import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL(".", import.meta.url).pathname;
const ALLOWED = new Set([
  "#161514", "#f3eee4", "#fbf9f4", "#6e6a64", "#d8d1c4", "#7a1f1f",
  "#5b6b7a", "#3f5e4a", "#2e3a5c", "#7a6556",
  "#4a5d73", "#4f6552", "#6b4660", "#2f5d62", "#6d6480", "#35544a", "#8c5a6b", "#4b4b4b",
  "#ffffff",
  // Thème sombre (sous-projet 4 § 3.1) : rail plus sombre que le cuir, cartes et
  // touches en gris chaud très foncé, encre grise, filet et encre rouge
  // éclaircis pour rester lisibles sur le cuir (test theme-contrast).
  "#0d0c0b", "#1f1d1b", "#2a2724", "#a8a197", "#3a3632", "#e0877d",
]);
const TAILWIND_PALETTE = /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|decoration|divide|shadow)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("le client n'utilise aucune couleur hors charte", () => {
  const offenders: string[] = [];
  for (const file of files(ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const hex of text.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
      if (!ALLOWED.has(hex.toLowerCase())) offenders.push(`${relative(ROOT, file)} : ${hex}`);
    }
    for (const cls of text.match(TAILWIND_PALETTE) ?? []) offenders.push(`${relative(ROOT, file)} : ${cls}`);
    if (/oklch\(/.test(text)) offenders.push(`${relative(ROOT, file)} : oklch()`);
  }
  assert.deepEqual(offenders, []);
});

// Règle du logo (consigne produit, renommage lama) : blanc sur fond
// noir, noir sur fond blanc, jamais d'or.
test("renommage lama : plus d'or, ni jeton ni valeur", () => {
  const users = files(ROOT)
    .filter((f) => /#b8964e|or-cygne/i.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(users, []);
});

test("règle du logo : la marque du cadre est blanche (papier) sur le cuir, et passe toujours par MarqueCadre", () => {
  const brand = readFileSync(join(ROOT, "components/brand.tsx"), "utf8");
  assert.match(brand.slice(brand.indexOf("export function MarqueCadre")), /className=\{cn\("[^"]*\btext-papier\b/);
  for (const name of ["components/cadre/rail.tsx", "components/cadre/telephone.tsx", "components/auth/couverture.tsx"]) {
    const text = readFileSync(join(ROOT, name), "utf8");
    assert.match(text, /<MarqueCadre\b/, name);
    assert.doesNotMatch(text, /<(SigneLama|MotLama)\b/, `${name} : la marque passe par MarqueCadre`);
  }
});

test("jetons de couleur : fond blanc, touches ivoire", () => {
  const css = readFileSync(join(ROOT, "styles.css"), "utf8");
  const root = css.match(/:root,\s*\[data-theme="light"\]\s*\{([^}]*)\}/)?.[1] ?? "";
  const token = (name: string) => root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toUpperCase();
  assert.equal(token("background"), "#FFFFFF", "--background doit être blanc pur");
  assert.equal(token("card"), "#FFFFFF", "--card doit être blanc pur");
  assert.equal(token("popover"), "#FFFFFF", "--popover doit être blanc pur");
  assert.equal(token("muted"), "#F3EEE4", "--muted reste l'ivoire plein (survol, sélection)");
});

test("page /charte : la marque lama en deux versions, blanche sur cuir et noire sur papier, sans or", () => {
  const text = readFileSync(join(ROOT, "components/charte.tsx"), "utf8");
  assert.match(text, /bg-cuir[^\n]*\n\s*<SigneLama[^>]*text-papier[^>]*title="Version blanche, sur cuir"[^>]*\/>\n\s*<MotLama[^>]*text-papier[^>]*\/>/);
  assert.match(text, /bg-papier[^\n]*\n\s*<SigneLama[^>]*text-cuir[^>]*title="Version noire, sur papier"[^>]*\/>\n\s*<MotLama[^>]*text-cuir[^>]*\/>/);
  assert.doesNotMatch(text, /Cygne|Logotype|doré|or-cygne/i);
});

// Sous-projet 4 § 3.1 : les matériaux de la charte (cuir, papier, ivoire,
// blanc) ne changent pas avec le thème. Un écran de travail passe donc par les
// jetons (`bg-card`, `text-foreground`, `bg-muted`, `bg-primary`…) ; seuls la
// charte, le logo et la couverture (rail, en-tête, écrans d'entrée) les
// emploient directement, pour le logo blanc sur cuir.
const MATERIALS = /\b(?:bg|text|border(?:-[trblxy])?|outline|decoration|ring|accent|divide|fill|stroke)-(?:cuir|papier|ivoire|blanc)(?:\/\d+)?\b/g;
const MATERIAL_FILES = new Set(["components/charte.tsx", "components/brand.tsx", "components/auth/couverture.tsx", "components/cadre/rail.tsx", "components/cadre/telephone.tsx"]);

test("thème sombre : aucun écran de travail n'emploie un matériau fixe au lieu d'un jeton", () => {
  const offenders = files(ROOT)
    .filter((f) => f.endsWith(".tsx") && !MATERIAL_FILES.has(relative(ROOT, f)))
    .flatMap((f) => (readFileSync(f, "utf8").match(MATERIALS) ?? []).map((cls) => `${relative(ROOT, f)} : ${cls}`));
  assert.deepEqual(offenders, []);
});

test("thème sombre : la page /charte reste en thème clair, référence de conception", () => {
  const text = readFileSync(join(ROOT, "components/charte.tsx"), "utf8");
  // Décision du contrôleur (C1) : l'enveloppe data-theme="light" couvre toute la
  // largeur de la page (pas de max-w-5xl sur cette balise), afin que les marges
  // restent claires en thème sombre sur grand écran ; la colonne centrale
  // (mx-auto max-w-5xl) est une balise imbriquée à l'intérieur.
  const envelope = text.match(/<div data-theme="light" className="([^"]*)"/);
  assert.ok(envelope, "enveloppe data-theme=\"light\" introuvable");
  assert.match(envelope![1], /\bbg-background\b/);
  assert.match(envelope![1], /\btext-foreground\b/);
  assert.doesNotMatch(envelope![1], /\bmax-w-5xl\b/, "l'enveloppe data-theme doit couvrir toute la largeur, pas seulement la colonne centrale");
  assert.match(text, /<div data-theme="light" className="[^"]*">\s*<div className="[^"]*\bmx-auto\b[^"]*\bmax-w-5xl\b/, "la colonne centrale est imbriquée dans l'enveloppe pleine largeur");
});
