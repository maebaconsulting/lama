import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Catalogue des suppléments à l'écran (spec du 18/10/2026 § 3.1), câblé sur `lib/supplements.ts` (testé en exécution). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const formulaire = read("../create-service.tsx");
const fiche = read("./fiche-prestation.tsx");
const liste = read("../supplements/liste-prestation.tsx");
const hook = read("../../hooks/use-app.ts");

test("formulaire : case « Supplément seulement », durée 0 permise pour elle seule, jamais en ligne", () => {
  assert.match(formulaire, /supplement_seulement: seulement \? 1 : 0/);
  assert.match(formulaire, /min=\{seulement \? "0" : "5"\}/);
  assert.match(formulaire, /if \(!seulement && \(dureeLue < 5 \|\| dureeLue > 720\)\) \{ setError\(t\("prestation\.duree_bornes"\)\); return; \}/);
  assert.match(formulaire, /\{!seulement && \(/, "la case « en ligne » disparaît");
  assert.match(formulaire, /if \(!seulement\) setEnLigne\(false\);/);
});

test("fiche : suppléments possibles lus par tous ; modifier et recopier, gérante seulement", () => {
  assert.match(fiche, /t\("prestation\.supplements_possibles"\)/);
  assert.match(fiche, /\{commands\.manage && \(\s*<div className="flex flex-wrap gap-2">/);
  assert.match(fiche, /<ListeSupplements service=\{service\} onClose=\{\(\) => setListe\(false\)\} \/>/);
  assert.match(fiche, /<RecopierSupplements service=\{service\} onClose=\{\(\) => setRecopie\(false\)\} \/>/);
  // Produits chargés par page : un produit absent n'est pas forcément retiré, il est nommé par son numéro.
  assert.match(fiche, /if \(kind === "product"\) return item \? pickText\(lang, item\.name, item\.name_en\) : t\("prestation\.produit_numero", \{ id \}\);/);
});

test("liste et copie : articles proposés filtrés, copie confirmée, appels au serveur", () => {
  assert.match(liste, /const choix = pickable\(services, products, service\.id, items\);/);
  assert.match(liste, /await saveServiceSupplements\(service\.id, items\);/);
  assert.match(liste, /const \{ candidates, preselected \} = copyTargets\(services, service\);/);
  assert.match(liste, /<BoutonDestructif/);
  assert.match(liste, /await copyServiceSupplements\(service\.id, \[\.\.\.chosen\]\);/);
  assert.match(hook, /await api\("PUT", `\/api\/services\/\$\{id\}\/supplements`, \{ items \}\);/);
  assert.match(hook, /await api\("POST", `\/api\/services\/\$\{id\}\/supplements\/copie`, \{ targets \}\);/);
});

test("produits : chargés à la demande, erreur et troncature visibles, recherche faite par le serveur, jamais de nom vide", () => {
  assert.match(fiche, /useProduits\(refs\.some\(\(r\) => r\.kind === "product"\)\)/);
  assert.match(fiche, /<Erreur message=\{charge\.error\} \/>/);
  assert.match(liste, /params\.set\("search", terme\)/);
  assert.match(liste, /total > products\.length/);
  assert.match(liste, /<Erreur message=\{error \?\? erreurProduits\} \/>/);
  assert.match(liste, /t\("caisse\.article_retire"\)/);
  assert.match(fiche, /t\("caisse\.article_retire"\)/);
});

test("clavier et lecteurs d'écran : focus suivi, annonces, groupes de cases", () => {
  assert.match(liste, /moveSupplement\(items, i, by\)/);
  assert.match(liste, /removeSupplement\(items, i\)/);
  assert.match(liste, /aria-live="polite"/);
  assert.match(liste, /prestation\.supplement_position/);
  assert.match(liste, /prestation\.resultats/);
  assert.match(liste, /<fieldset key=\{group\.category\}/);
  assert.match(liste, /<legend /);
});
