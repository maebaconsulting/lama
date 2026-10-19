import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TEXTES } from "./textes.ts";

const lire = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
const ECRANS = ["main.tsx", "app.tsx", "rappel.tsx", "suivi.tsx", "composants.tsx"];

test("écrans : chaque clé de texte appelée existe dans les deux langues", () => {
  for (const f of ECRANS) {
    for (const m of lire(f).matchAll(/\bt\(lang, "([a-z_.]+)"/g)) assert.ok(m[1] in TEXTES, `${f} : ${m[1]}`);
  }
});

test("gestion : chaque clé de texte appelée existe", async () => {
  const { TEXTES_GESTION } = await import("./gestion-textes.ts");
  for (const m of lire("gestion.tsx").matchAll(/\btg\(lang, "([a-z_.]+)"/g)) assert.ok(m[1] in TEXTES_GESTION, m[1]);
});

test("intégration : le cadre n'écoute que la page du relais et borne la hauteur", () => {
  const s = lire("statique/integrer.js");
  assert.match(s, /e\.origin !== origine/);
  assert.match(s, /e\.source !== cadre\.contentWindow/);
  assert.match(s, /h < 20000/);
  assert.match(s, /dataset\.salon/);
});

test("page : la prestation choisie d'avance par l'adresse ouvre le parcours sur le jour et l'heure", () => {
  assert.match(lire("main.tsx"), /prestationInitiale=\{prestationDepuisAdresse\(location\.search, vitrine\.prestations\)\}/);
  assert.match(lire("app.tsx"), /useState<Etape>\(prestationInitiale \? "horaire" : "prestation"\)/);
  assert.match(lire("app.tsx"), /useState<Choix>\(prestationInitiale \? \{ \.\.\.VIDE, prestation: prestationInitiale \} : VIDE\)/);
});

test("page : le champ piège est hors de l'écran et hors de la tabulation", () => {
  assert.match(lire("composants.tsx"), /tabIndex=\{-1\}/);
  assert.match(lire("styles.css"), /\.piege \{[^}]*left: -10000px/);
});

test("intégration : identifiant du salon validé, jamais de cadre dans <head>, message de retour en haut écouté", () => {
  const s = lire("statique/integrer.js");
  assert.match(s, /\[a-z0-9\]\(\?:\[a-z0-9-\]\{0,30\}\[a-z0-9\]\)\?/);
  assert.match(s, /document\.head/);
  assert.match(s, /lamaRelaisHaut/);
  assert.match(lire("main.tsx"), /body\.getBoundingClientRect\(\)\.height/);
});

test("thème : couleurs en variables, plus aucune couleur de la charte écrite en dur hors de :root ; polices par data-police, servies par le relais", () => {
  const css = lire("styles.css");
  const hors = css.slice(css.indexOf("}") + 1);
  assert.doesNotMatch(hors, /#[0-9A-Fa-f]{6}/, "couleurs seulement dans :root");
  assert.doesNotMatch(css + lire("gestion.css"), /--cuir|--ivoire/, "anciennes variables retirées");
  for (const v of ["--fond", "--texte", "--accent", "--sur-accent", "--papier", "--encre-grise", "--filet", "--encre-rouge", "--vert-confirme"]) assert.match(css, new RegExp(`${v}:`), v);
  assert.match(css, /\.bouton \{[^}]*background: var\(--accent\); color: var\(--sur-accent\)/);
  for (const p of ["classique", "elegante", "moderne"]) assert.match(css, new RegExp(`html\\[data-police="${p}"\\]`), p);
  assert.match(css, /@font-face \{ font-family: "Cinzel";[^}]*url\("\.\/polices\/cinzel-latin-500-normal\.woff2"\)/);
  assert.doesNotMatch(css, /fonts\.googleapis|fonts\.gstatic|https?:\/\//, "jamais un service de polices tiers");
  assert.ok(readFileSync(new URL("./polices/cinzel-latin-500-normal.woff2", import.meta.url)).length > 5_000);
  assert.match(lire("polices/OFL-Cinzel.txt"), /SIL Open Font License/);
  assert.match(lire("main.tsx"), /import "@fontsource\/eb-garamond\/400\.css";/);
});

test("« Demande reçue » : le message suit la réponse du dépôt, créneau comme rappel", () => {
  assert.match(lire("app.tsx"), /t\(lang, texteRecu\(rappel, horsHoraires\)\)/);
  assert.match(lire("app.tsx"), /envoye\(r\.jeton, r\.hors_horaires === true\)/);
  assert.match(lire("rappel.tsx"), /envoye\(r\.jeton, r\.hors_horaires === true\)/);
  for (const cle of ["recu.ouverture", "recu.rappel_ouverture"]) assert.ok(cle in TEXTES, cle);
});

test("coordonnées : prénom et nom dans deux champs, envoyés par clienteEnvoyee dans les deux formulaires", () => {
  const c = lire("composants.tsx");
  assert.match(c, /t\(lang, "coordonnees\.prenom"\)/);
  assert.match(c, /autoComplete="given-name"/);
  assert.match(c, /autoComplete="family-name"/);
  for (const f of ["app.tsx", "rappel.tsx"]) assert.match(lire(f), /cliente: clienteEnvoyee\(saisie, c\.telephone\)/, f);
  assert.equal(TEXTES["coordonnees.nom"].fr, "Nom");
});
