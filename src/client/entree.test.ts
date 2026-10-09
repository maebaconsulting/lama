import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("la couverture d'entrée pose la marque lama, blanche, sur le cuir (règle du logo)", () => {
  const couverture = read("./components/auth/couverture.tsx");
  assert.match(couverture, /bg-sidebar/);
  assert.match(couverture, /<MarqueCadre place="entree" \/>/);
  assert.doesNotMatch(couverture, /or-cygne|doré/);
});

test("aucun formulaire d'entrée ne peut partir en GET (mot de passe dans l'adresse)", () => {
  const dir = new URL("./components/auth/", import.meta.url);
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".tsx"))) {
    const text = readFileSync(new URL(name, dir), "utf8");
    for (const form of text.match(/<form\b[^>]*>/g) ?? []) assert.match(form, /onSubmit=/, `${name} : ${form}`);
  }
});

test("l'app n'est montée qu'à travers la porte d'entrée", () => {
  assert.match(read("./main.tsx"), /<Porte>\s*<App \/>\s*<\/Porte>/);
});

test("un échec de connexion efface le secret saisi, jamais réaffiché", () => {
  const catchBlock = (file: string) => {
    const text = read(`./components/auth/${file}`);
    const match = text.match(/catch \(err\) \{([\s\S]*?)setPending\(false\);/);
    assert.ok(match, `${file} : bloc catch introuvable`);
    return match![1];
  };
  assert.match(catchBlock("installation.tsx"), /password: ""/, "installation.tsx : le mot de passe doit être effacé après un échec");
  assert.match(catchBlock("installation.tsx"), /confirmation: ""/, "installation.tsx : la confirmation doit être effacée après un échec");
  assert.match(catchBlock("connexion.tsx"), /setPassword\(""\)/, "connexion.tsx : le mot de passe doit être effacé après un échec");
  assert.match(catchBlock("poste.tsx"), /setPin\(""\)/, "poste.tsx : le PIN doit être effacé après un échec");
});

test("écrans d'entrée : bouton FR / EN sur la couverture, installation dans la langue de l'écran (spec § 3.1)", () => {
  const couverture = read("./components/auth/couverture.tsx");
  assert.match(couverture, /<LangSwitch\b/);
  assert.match(read("./components/auth/installation.tsx"), /language: lang/);
});

test("un message affiché avant une bascule de langue est masqué après elle", () => {
  const champ = read("./components/champ.tsx");
  assert.match(champ, /function useSameLang\(/);
  assert.match(champ, /export function Erreur[\s\S]*useSameLang\(message\)/);
  assert.match(champ, /export function Succes[\s\S]*useSameLang\(message\)/);
});
