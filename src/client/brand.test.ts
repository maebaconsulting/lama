import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { en } from "./i18n/en.ts";
import { fr } from "./i18n/fr.ts";

/**
 * Marque lama (renommage lama, § 1) : signe provisoire dans un seul fichier,
 * mot en Cormorant Garamond 300 embarquée, cygne et logotype de l'ancienne charte
 * sortis du code.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("signe-lama.svg est vectoriel, recolorable, sans couleur figée, seul dans les ressources de marque", () => {
  const svg = read("./assets/brand/signe-lama.svg");
  assert.match(svg, /<svg[^>]*viewBox="[\d. ]+"/);
  assert.match(svg, /fill="currentColor"/);
  assert.doesNotMatch(svg, /#[0-9a-fA-F]{3,6}\b/);
  assert.doesNotMatch(svg, /<image\b/);
  assert.ok(svg.length < 60_000, "SVG trop lourd");
  assert.deepEqual(readdirSync(new URL("./assets/brand/", import.meta.url)), ["signe-lama.svg"]);
});

test("cygne et logotype de l'ancienne charte sortis du code (docs/brand quitte le dépôt public en vague 5 de la distribution)", () => {
  const brand = read("./components/brand.tsx");
  for (const name of ["SigneLama", "MotLama", "MarqueCadre"]) assert.match(brand, new RegExp(`export function ${name}\\(`), name);
  assert.doesNotMatch(brand, /cygne|logotype/i);
});

test("mot lama : Cormorant Garamond 300 embarquée (jeu latin), minuscules espacées ; Cinzel retirée", () => {
  const main = read("./main.tsx");
  assert.match(main, /import "@fontsource\/cormorant-garamond\/latin-300\.css";/);
  assert.doesNotMatch(main, /cinzel/i);
  const css = read("./styles.css");
  assert.match(css, /--font-marque: "Cormorant Garamond", Georgia, serif;/);
  assert.doesNotMatch(css, /Cinzel|--font-display/);
  const brand = read("./components/brand.tsx");
  assert.match(brand, /font-marque font-light/);
  assert.match(brand, /tracking-\[0\.3em\]/);
  const pkg = JSON.parse(read("../../package.json")) as { dependencies: Record<string, string> };
  assert.ok(pkg.dependencies["@fontsource/cormorant-garamond"]);
  assert.equal(pkg.dependencies["@fontsource/cinzel"], undefined);
});

test("le cadre passe par MarqueCadre : entrée, rail ouvert ou replié, en-tête du téléphone", () => {
  assert.match(read("./components/auth/couverture.tsx"), /<MarqueCadre place="entree" \/>/);
  assert.match(read("./components/cadre/rail.tsx"), /<MarqueCadre place=\{expanded \? "rail" : "replie"\} \/>/);
  assert.match(read("./components/cadre/telephone.tsx"), /<MarqueCadre place="telephone" \/>/);
});

test("réglage marque.ecran : lu dans l'état public par la porte, appliqué par MarqueCadre, choisi dans la rubrique Institut", () => {
  const porte = read("./components/auth/porte.tsx");
  assert.match(porte, /<MarqueContext\.Provider value=\{marqueEtat\(state\?\.marque\)\}>/);
  const brand = read("./components/brand.tsx");
  assert.match(brand, /const etat = useMarque\(\);/);
  assert.match(brand, /motVisible\(place, etat\.ecran\)/);
  const institut = read("./components/reglages/institut.tsx");
  assert.match(institut, /"marque\.ecran"/);
  assert.match(institut, /<select id="marque-ecran"/);
  assert.match(institut, /AFFICHAGES_MARQUE\.map/);
  // Le rail de la gérante suit son choix sans attendre une nouvelle connexion.
  assert.match(institut, /if \(changed\.includes\("marque\.ecran"\) \|\| changed\.includes\("institut\.nom"\)\) await auth\.reload\(\);/);
});

test("couverture : « propulsé par lama » seulement quand l'entrée montre un logo ou le nom de l'institut", () => {
  const couverture = read("./components/auth/couverture.tsx");
  assert.match(couverture, /contenuMarque\("entree", etat, false\)\.kind/);
  assert.match(couverture, /t\("marque\.propulse"\)/);
  assert.match(couverture, /kind === "logo" \|\| [\w.]+ === "nom"/);
  assert.equal(fr["marque.propulse"], "propulsé par lama");
  assert.equal(en["marque.propulse"], "powered by lama");
});
