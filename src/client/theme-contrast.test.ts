import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRatio, mixSrgb, STAFF_INKS, STATUS_INKS } from "./lib/inks.ts";

/**
 * Contrastes WCAG AA des deux thèmes (sous-projet 4 § 3.1), calculés sur les
 * valeurs réelles de styles.css : texte courant 4,5 pour 1, grands textes et
 * contours 3 pour 1.
 */
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/** Variables d'un bloc de styles.css, repéré par le début exact de son sélecteur. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `bloc ${selector} introuvable`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** `#RRGGBB` d'une valeur : hexadécimal ou `color-mix(in srgb, #A p%, #B)`. */
function color(value: string): string {
  const mix = value.match(/^color-mix\(in srgb, (#[0-9a-fA-F]{6}) (\d+)%, (#[0-9a-fA-F]{6})\)$/);
  if (mix) return mixSrgb(mix[1], mix[3], Number(mix[2]) / 100);
  assert.match(value, /^#[0-9a-fA-F]{6}$/, `valeur non résolue : ${value}`);
  return value.toUpperCase();
}

const THEMES = { clair: block(':root,\n[data-theme="light"]'), sombre: block('[data-theme="dark"]') };

/** Paires [texte, fond] de texte courant (4,5 pour 1). */
const TEXT: [string, string][] = [
  ["--foreground", "--background"], ["--foreground", "--card"], ["--foreground", "--muted"],
  ["--card-foreground", "--card"], ["--popover-foreground", "--popover"],
  ["--primary-foreground", "--primary"], ["--secondary-foreground", "--secondary"], ["--accent-foreground", "--accent"],
  ["--muted-foreground", "--background"], ["--muted-foreground", "--card"], ["--muted-foreground", "--muted"],
  ["--color-encre-grise", "--background"], ["--color-encre-grise", "--card"], ["--color-encre-grise", "--muted"],
  ["--destructive", "--background"], ["--destructive", "--card"], ["--color-encre-rouge", "--card"],
  ["--destructive-foreground", "--destructive"],
  ["--sidebar-foreground", "--sidebar"], ["--sidebar-foreground", "--sidebar-accent"],
];
/** Paires [contour, fond] d'éléments interactifs et de focus (3 pour 1). */
const OUTLINE: [string, string][] = [
  ["--input", "--background"], ["--input", "--card"], ["--ring", "--background"], ["--ring", "--card"], ["--sidebar-ring", "--sidebar"],
];

for (const [name, tokens] of Object.entries(THEMES)) {
  const value = (token: string) => color(tokens[token]);

  test(`thème ${name} : texte courant à 4,5 pour 1 au moins`, () => {
    const faults = TEXT.map(([fg, bg]) => [fg, bg, contrastRatio(value(fg), value(bg))] as const).filter(([, , r]) => r < 4.5);
    assert.deepEqual(faults, []);
  });

  test(`thème ${name} : contours et focus à 3 pour 1 au moins`, () => {
    const faults = OUTLINE.map(([fg, bg]) => [fg, bg, contrastRatio(value(fg), value(bg))] as const).filter(([, , r]) => r < 3);
    assert.deepEqual(faults, []);
  });

  test(`thème ${name} : badges de statut et encres des praticiennes lisibles (4,5 pour 1)`, () => {
    const part = Number(tokens["--encre-part"].replace("%", "")) / 100;
    const inks = [...Object.values(STATUS_INKS), ...STAFF_INKS.map((i) => i.hex), "#6E6A64"];
    const faults = inks.flatMap((ink) => ["--background", "--card", "--muted"].map((bg) => {
      const shown = mixSrgb(ink, "#F3EEE4", part);
      return [ink, bg, contrastRatio(shown, value(bg))] as const;
    })).filter(([, , r]) => r < 4.5);
    assert.deepEqual(faults, []);
  });

  test(`thème ${name} : liserés et carrés des praticiennes (repères graphiques) à 3 pour 1 et distincts deux à deux`, () => {
    const part = Number(tokens["--encre-part-trait"].replace("%", "")) / 100;
    const shown = STAFF_INKS.map((i) => mixSrgb(i.hex, "#F3EEE4", part));
    const faults = shown.flatMap((ink) => ["--background", "--card"].map((bg) => [ink, bg, contrastRatio(ink, value(bg))] as const)).filter(([, , r]) => r < 3);
    assert.deepEqual(faults, []);
    // Écart de couleur minimal entre deux praticiennes (distance euclidienne en sRGB 0-255) : 9,5 à 40 %, 17,5 à 75 %.
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const gaps = shown.flatMap((a, i) => shown.slice(i + 1).map((b) => Math.hypot(...rgb(a).map((v, k) => v - rgb(b)[k]))));
    assert.ok(Math.min(...gaps) >= 16, `écart minimal ${Math.min(...gaps).toFixed(1)}`);
  });
}

test("le rail et l'en-tête restent les plus sombres de l'écran dans les deux thèmes", () => {
  for (const tokens of Object.values(THEMES)) {
    const rail = color(tokens["--sidebar"]);
    for (const surface of ["--background", "--card", "--muted"]) {
      assert.ok(contrastRatio(rail, "#000000") <= contrastRatio(color(tokens[surface]), "#000000"), `${surface} plus sombre que le rail`);
    }
  }
});

test("clair : l'encre pure ; sombre : 40 % d'encre dans l'ivoire", () => {
  assert.equal(THEMES.clair["--encre-part"], "100%");
  assert.equal(THEMES.sombre["--encre-part"], "40%");
  // Repères graphiques (liserés, carrés) : plus d'encre en sombre, pour distinguer les praticiennes (revue impeccable, D2).
  assert.equal(THEMES.clair["--encre-part-trait"], "100%");
  assert.equal(THEMES.sombre["--encre-part-trait"], "75%");
  assert.match(css, /\.encre-lisere \{\s*border-left-color: color-mix\(in srgb, var\(--encre\) var\(--encre-part-trait\), #F3EEE4\);/);
  // Décision du contrôleur (D1) : la vérification à poids 1 (mixSrgb(a, b, 1) === a)
  // ne fait que comparer la constante d'entrée à elle-même, sans exercer le mélange ;
  // seul le cas à 50 % (ci-dessous) vérifie réellement le calcul.
  assert.equal(mixSrgb("#000000", "#FFFFFF", 0.5), "#808080");
  assert.match(css, /\.encre \{\s*color: color-mix\(in srgb, var\(--encre\) var\(--encre-part\), #F3EEE4\);/);
});

test("les deux thèmes définissent les mêmes variables", () => {
  assert.deepEqual(Object.keys(THEMES.sombre).sort(), Object.keys(THEMES.clair).sort());
});

test("V1-61 : texte atténué du thème clair sur le blanc pur du cadre du logo clair, 4,5 pour 1 au moins", () => {
  const ratio = contrastRatio(color(THEMES.clair["--muted-foreground"]), "#FFFFFF");
  assert.ok(ratio >= 4.5, `contraste ${ratio.toFixed(2)} pour 1`);
});
