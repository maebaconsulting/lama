import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const dir = new URL("./components/reglages/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), "utf8");
const components = () => readdirSync(dir).filter((n) => n.endsWith(".tsx"));

test("chaque rubrique branchée a son composant", () => {
  const registry = read("reglages.tsx");
  for (const id of ["mon-compte", "institut", "caisse", "comptes", "postes", "file-envoi", "sauvegardes", "heure", "connexions", "journal"]) {
    assert.match(registry, new RegExp(`"?${id}"?\\s*:`), id);
  }
});

test("aucune trace dans la console depuis les Réglages", () => {
  for (const name of components()) assert.doesNotMatch(read(name), /console\./, name);
});

test("aucun tiret cadratin dans les Réglages", () => {
  for (const name of components()) assert.doesNotMatch(read(name), /\u2014/, name);
});

test("un échec dans Mon compte efface les secrets saisis, jamais réaffichés", () => {
  const text = read("mon-compte.tsx");
  const blocks = [...text.matchAll(/catch \(err\) \{([\s\S]*?)\} finally \{/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2, "deux blocs catch attendus (mot de passe et PIN)");
  const [motDePasse, pin] = blocks;
  assert.match(motDePasse, /actuel: ""/, "mot de passe actuel à effacer");
  assert.match(motDePasse, /nouveau: ""/, "nouveau mot de passe à effacer");
  assert.match(motDePasse, /confirmation: ""/, "confirmation à effacer");
  assert.match(pin, /setActuel\(""\)/, "mot de passe actuel à effacer");
  assert.match(pin, /setPin\(""\)/, "PIN saisi à effacer");
});

test("un échec dans Équipe et comptes efface les secrets saisis, jamais réaffichés", () => {
  const text = read("comptes.tsx");
  const blocks = [...text.matchAll(/catch \(err\) \{([\s\S]*?)\} finally \{/g)].map((m) => m[1]);
  assert.equal(blocks.length, 2, "deux blocs catch attendus (création et édition)");
  const [creation, edition] = blocks;
  assert.match(creation, /password: ""/, "mot de passe saisi à effacer (création)");
  assert.match(creation, /confirmation: ""/, "confirmation saisie à effacer (création)");
  assert.match(creation, /pin: ""/, "PIN saisi à effacer (création)");
  assert.match(edition, /password: ""/, "mot de passe saisi à effacer (édition)");
  assert.match(edition, /pin: ""/, "PIN saisi à effacer (édition)");
});

test("la clé privée de restauration n'est ni proposée par le navigateur ni gardée après l'envoi", () => {
  const text = read("sauvegardes.tsx");
  const restaurationStart = text.indexOf("function Restauration");
  assert.ok(restaurationStart >= 0, "composant Restauration introuvable");
  const restauration = text.slice(restaurationStart);
  const textarea = restauration.match(/<Textarea[^>]*>/);
  assert.ok(textarea, "balise Textarea introuvable");
  assert.match(textarea[0], /autoComplete="off"/, "autoComplete sur le Textarea");
  assert.match(textarea[0], /spellcheck=\{false\}/, "spellcheck sur le Textarea");
  const setCleIndex = restauration.indexOf('setCle("")');
  const apiIndex = restauration.indexOf("api(");
  assert.ok(setCleIndex >= 0, 'setCle("") introuvable');
  assert.ok(apiIndex >= 0, "appel api( introuvable");
  assert.ok(setCleIndex < apiIndex, "la clé doit être effacée avant l'envoi au serveur");
});

test("heures des Réglages : « 2 h » avec une espace insécable (relecture finale)", () => {
  for (const name of components()) assert.doesNotMatch(read(name), /\d h(?![-\w])/, name);
});

test("langue : choisie par chacun dans Mon compte, par la gérante et l'administrateur dans Équipe et comptes (spec § 3.2)", () => {
  const monCompte = read("mon-compte.tsx");
  assert.match(monCompte, /api\("PUT", "\/api\/auth\/me\/language", \{ language: next \}\)/);
  const comptes = read("comptes.tsx");
  assert.match(comptes, /language: form\.language/);
  assert.match(comptes, /t\("colonne\.langue"\)/);
});

test("les listes au texte traduit par le serveur (dernière erreur, message de sauvegarde) sont redemandées à la bascule de langue (vérification finale)", () => {
  assert.match(read("file-envoi.tsx"), /useLoad\(\(\) => api<OutboxReply>\("GET", "\/api\/outbox"\), \["outbox"\], \{ reloadOnLang: true \}\)/);
  assert.match(read("sauvegardes.tsx"), /useLoad\(\(\) => api<BackupsReply>\("GET", "\/api\/backups"\), \["outbox"\], \{ reloadOnLang: true \}\)/);
  const hook = readFileSync(new URL("./hooks/use-load.ts", import.meta.url), "utf8");
  assert.match(hook, /reloadOnLang/);
  assert.match(hook, /\}, \[lang\]\);/);
});
