import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DICTIONARIES } from "./i18n/translate.ts";
import { estCompteDemo } from "./lib/demo.ts";
import type { CompteDemo } from "./lib/auth-types.ts";

/** Démonstration publique à l'écran (démo publique DP-03, DP-04, DP-05, DP-06) : comptes publics, bandeau, gestes figés. */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const COMPTES: CompteDemo[] = [
  { login: "gerante", role: "manager", mot_de_passe: "gerante-demo", pin: "2580" },
  { login: "reception", role: "reception", mot_de_passe: "reception-demo", pin: "1357" },
];

test("textes : bandeau de la démonstration et comptes publics dans les deux langues", () => {
  assert.equal(DICTIONARIES.fr["demo.bandeau"], "Démonstration\u00a0: données fictives, remises à zéro chaque nuit.");
  assert.equal(DICTIONARIES.en["demo.bandeau"], "Demo: fictitious data, reset every night.");
  assert.equal(DICTIONARIES.fr["demo.comptes.ligne"], "Identifiant\u00a0: {login}, mot de passe\u00a0: {mot_de_passe}, code PIN\u00a0: {pin}");
  assert.equal(DICTIONARIES.en["demo.comptes.ligne"], "Username: {login}, password: {mot_de_passe}, PIN: {pin}");
  const cles = Object.keys(DICTIONARIES.fr).filter((k) => k.startsWith("demo."));
  assert.equal(cles.length, 9);
  for (const cle of cles) assert.ok(DICTIONARIES.en[cle as keyof typeof DICTIONARIES.en], cle);
});

test("texte du compte figé : court, tient sur une ligne dans la fiche, dans les deux langues", () => {
  assert.equal(DICTIONARIES.fr["demo.compte_fige"], "Compte de démonstration, non modifiable.");
  assert.equal(DICTIONARIES.en["demo.compte_fige"], "Demo account, cannot be changed.");
  assert.ok(DICTIONARIES.fr["demo.compte_fige"].length <= 45);
  assert.ok(DICTIONARIES.en["demo.compte_fige"].length <= 45);
});

test("compte public : reconnu par son identifiant, seulement dans la démonstration publique", () => {
  assert.equal(estCompteDemo(COMPTES, "gerante"), true);
  assert.equal(estCompteDemo(COMPTES, "visiteuse"), false);
  assert.equal(estCompteDemo(null, "gerante"), false, "hors démonstration publique, rien de figé");
});

test("état public lu par la porte : comptes publics posés pour tous les écrans, entrée comprise", () => {
  assert.match(read("./lib/auth-types.ts"), /demo\?: \{ comptes: CompteDemo\[\] \} \| null;/);
  assert.match(read("./components/auth/porte.tsx"), /<DemoContext\.Provider value=\{state\?\.demo\?\.comptes \?\? null\}>/);
  assert.match(read("./demo-context.tsx"), /export const DemoContext = createContext<CompteDemo\[\] \| null>\(null\);/);
});

test("écran de connexion : les trois comptes publics (rôle, identifiant, mot de passe, PIN), un toucher remplit le formulaire ; PIN aussi sur le poste partagé", () => {
  const comptes = read("./components/auth/comptes-demo.tsx");
  assert.match(comptes, /if \(!comptes\) return null;/);
  assert.match(comptes, /\{t\(ROLE_KEYS\[compte\.role\]\)\}/);
  assert.match(comptes, /t\("demo\.comptes\.ligne", \{ login: compte\.login, mot_de_passe: compte\.mot_de_passe, pin: compte\.pin \}\)/);
  assert.match(comptes, /onClick=\{\(\) => onChoisir\(compte\)\}/);
  // Identifiants copiables : hors du bouton, en texte sélectionnable ; un clic sans sélection remplit encore le formulaire.
  const bouton = comptes.slice(comptes.indexOf("<button"), comptes.indexOf("</button>"));
  assert.doesNotMatch(bouton, /\{ligne\}/, "identifiants jamais dans le bouton");
  assert.match(comptes, /<\/button>\s*\{\/\*[^*]*\*\/\}\s*<p id=\{ligneId\} className="[^"]*\bselect-text\b[^"]*" onClick=\{\(\) => \{ if \(!window\.getSelection\(\)\?\.toString\(\)\) onChoisir\(compte\); \}\}>\s*\{ligne\}/);
  assert.match(comptes, /aria-describedby=\{ligneId\}/);
  assert.match(comptes, /<span className="select-text text-encre-grise">\{ligne\}<\/span>/, "poste partagé : identifiants sélectionnables aussi");
  assert.doesNotMatch(comptes, /"admin"/, "jamais l'administration");
  assert.match(read("./components/auth/connexion.tsx"), /<ComptesDemo onChoisir=\{\(compte\) => \{ setLogin\(compte\.login\); setPassword\(compte\.mot_de_passe\); setError\(null\); \}\} \/>/);
  assert.match(read("./components/auth/poste.tsx"), /<ComptesDemo \/>/);
});

test("compte public : mot de passe, PIN et fiche masqués à l'écran ; envoi de fichiers masqué (logo, photo de produit) ; remise de la démonstration décrite", () => {
  const monCompte = read("./components/reglages/mon-compte.tsx");
  assert.match(monCompte, /const fige = estCompteDemo\(useDemo\(\), account\.login\);/);
  assert.match(monCompte, /\{fige \? <p className="max-w-prose text-sm text-encre-grise">\{t\("demo\.compte_fige"\)\}<\/p> : <MotDePasse \/>\}/);
  assert.match(monCompte, /\{account\.role !== "admin" && !fige && <Pin hasPin=\{account\.has_pin\} \/>\}/);
  const fiche = read("./components/reglages/fiche-compte.tsx");
  assert.match(fiche, /const modifier = commands\.edit && !fige;/);
  assert.match(fiche, /\{modifier && <Button/);
  const logos = read("./components/reglages/logos-institut.tsx");
  assert.match(logos, /<BlocLogo variante="clair" version=\{marque\.clair\} fige=\{demo\} \/>/);
  assert.match(logos, /\{!fige && \(/);
  const photo = read("./components/produits/photo-produit.tsx");
  assert.match(photo, /\{gerer && demo && <p className="text-xs text-muted-foreground">\{t\("demo\.fichiers_coupes"\)\}<\/p>\}/);
  assert.match(photo, /\{gerer && !demo && \(/);
  assert.match(read("./components/reglages/formation.tsx"), /description=\{t\(demo \? "demo\.description" : "formation\.description"\)\}/);
});
