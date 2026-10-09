import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultNewRole } from "../lib/roles.ts";

/**
 * Passe de finition V 1.0, vague E (V1-54, V1-55, V1-58 à V1-62, V1-70) :
 * saisie suivie à la frappe, avis effacé au changement de jour, PIN absent
 * pour l'administrateur, rôle proposé à la création, icône de l'écran
 * d'accueil, cadre du logo clair, clavier de l'adresse IP, formulaire
 * d'installation sans champ mort.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const racine = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url));

test("V1-54 : « Remboursé X sur Y » suit la frappe du montant remboursé", () => {
  const avoir = read("./caisse/formulaire-avoir.tsx");
  assert.match(avoir, /id=\{`avoir-montant-\$\{i\}`\}[\s\S]{0,400}?onInput=\{\(e: Event\) => setDraft\(setRefund\(draft, i, \{ amount: typeAmount\(e, r\.amount, lang\) \}\)\)\}/);
  assert.doesNotMatch(avoir, /onChange=\{\(e: Event\) => setDraft\(setRefund\(draft, i, \{ amount:/);
});

test("V1-55 : l'avis « N rendez-vous transférés » disparaît quand on change de jour", () => {
  assert.match(read("./calendar-view.tsx"), /useEffect\(\(\) => \{ setTransferNotice\(null\); \}, \[calendarDate\]\);/);
});

test("V1-58 : pas de bloc PIN pour l'administrateur, qui ne passe jamais par un poste", () => {
  assert.match(read("./reglages/mon-compte.tsx"), /\{account\.role !== "admin" && !fige && <Pin hasPin=\{account\.has_pin\} \/>\}/);
});

test("V1-59 : la réception est proposée à la création d'un compte, PIN masqué pour l'administrateur", () => {
  assert.equal(defaultNewRole(["admin", "manager", "reception"]), "reception");
  assert.equal(defaultNewRole(["manager", "reception", "practitioner"]), "reception");
  assert.equal(defaultNewRole(["manager"]), "manager");
  const comptes = read("./reglages/comptes.tsx");
  assert.match(comptes, /role: defaultNewRole\(roles\)/);
  assert.match(comptes, /setForm\(\{ \.\.\.form, role, pin: role === "admin" \? "" : form\.pin \}\)/);
  assert.match(comptes, /\{form\.role !== "admin" && <Champ id="nc-pin"/);
  assert.match(comptes, /pin: form\.role === "admin" \? null : form\.pin \|\| null/);
  // modification : ni « Nouveau PIN » ni « Retirer le PIN » pour un compte administrateur
  assert.match(comptes, /\{cible\.role !== "admin" && <Champ id="mc-pin"/);
  assert.match(comptes, /\{cible\.role !== "admin" && cible\.has_pin && <Case id="mc-sans-pin"/);
});

test("V1-60 : icône PNG 180 × 180 pour l'écran d'accueil iOS, manifeste lié", () => {
  const html = racine("index.html").toString("utf8");
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  const png = racine("apple-touch-icon.png");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "signature PNG");
  assert.equal(png.readUInt32BE(16), 180, "largeur");
  assert.equal(png.readUInt32BE(20), 180, "hauteur");
});

test("V1-61 : le cadre blanc du logo clair reste en thème clair (« Aucun logo » lisible en sombre)", () => {
  assert.match(
    read("./reglages/logos-institut.tsx"),
    /<div data-theme=\{clair \? "light" : undefined\} className=\{`flex h-32 items-center justify-center rounded-sm border border-filet p-3 \$\{clair \? "bg-white" : "bg-sidebar"\}`\}>/,
  );
});

test("V1-62 : clavier d'adresse (point et deux-points) pour l'adresse IP de la passerelle SMS", () => {
  const sms = read("./reglages/fournisseur-sms.tsx");
  assert.match(sms, /<Champ id="sms-adresse" inputMode="url" /);
  assert.doesNotMatch(sms, /inputMode="decimal"/);
});

test("V1-70 : plus de champ « pin » dans l'état du formulaire d'installation", () => {
  const installation = read("./auth/installation.tsx");
  assert.match(installation, /useState\(\{ display_name: "", login: "", password: "", confirmation: "" \}\)/);
  assert.match(installation, /newAccountProblem\(\{ \.\.\.form, pin: "" \}\)/);
  assert.doesNotMatch(installation, /pin: form\.pin/);
});
