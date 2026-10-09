import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { translate, translatePlural } from "../i18n/translate.ts";

/**
 * Passe de finition V 1.0, vague E (V1-63 à V1-69) : noms accessibles,
 * annonces et rôles manquants relevés par l'inventaire de l'écran.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("V1-63 : le champ de recherche des rendez-vous a un nom accessible", () => {
  assert.match(read("./appointment-list.tsx"), /<Input\s+aria-label=\{t\("rdv\.rechercher"\)\}\s+className="h-11 pl-9"/);
});

test("V1-64 : le conflit de la prise de rendez-vous est annoncé", () => {
  assert.match(read("./create-appointment.tsx"), /\{conflicts && \(\s*<div ref=\{conflictRef\} role="alert" className="flex gap-2\.5 rounded-sm border border-encre-rouge bg-card p-3 text-sm text-encre-rouge">/);
});

test("V1-65 : « une unité de moins / de plus » nomme le produit de la ligne", () => {
  const ticket = read("./caisse/ticket-vente.tsx");
  assert.match(ticket, /aria-label=\{t\("caisse\.moins", \{ designation: l\.missing \? t\("caisse\.article_retire"\) : l\.label \}\)\}/);
  assert.match(ticket, /aria-label=\{t\("caisse\.plus", \{ designation: l\.missing \? t\("caisse\.article_retire"\) : l\.label \}\)\}/);
  assert.equal(translate("fr", "caisse.moins", { designation: "Huile de coco" }), "Une unité de moins\u00a0: Huile de coco");
  assert.equal(translate("fr", "caisse.plus", { designation: "Huile de coco" }), "Une unité de plus\u00a0: Huile de coco");
  assert.equal(translate("en", "caisse.moins", { designation: "Coconut oil" }), "One less: Coconut oil");
  assert.equal(translate("en", "caisse.plus", { designation: "Coconut oil" }), "One more: Coconut oil");
  assert.notEqual(
    translate("fr", "caisse.moins", { designation: "Huile de coco" }),
    translate("fr", "caisse.moins", { designation: "Beurre de karité" }),
    "deux lignes, deux noms distincts",
  );
});

test("V1-66 : les icônes de la note et de l'envoi sont cachées aux lecteurs d'écran", () => {
  const fiche = read("./appointment-detail.tsx");
  const icones = fiche.match(/<(Trash2|Send)\b[^>]*\/>/g) ?? [];
  assert.ok(icones.length >= 3, `au moins trois icônes attendues, trouvées : ${icones.length}`);
  for (const icone of icones) assert.match(icone, /aria-hidden="true"/, icone);
});

test("V1-67 : le chargement général est annoncé (role=status)", () => {
  const app = read("../app.tsx");
  assert.match(app, /appState\.loading \? \(\s*<div className="flex h-full items-center justify-center"><EtatChargement \/><\/div>/);
  assert.doesNotMatch(app, /text-muted-foreground">\{t\("commun\.chargement"\)\}<\/div>/);
});

test("V1-68 : le compteur de stock bas est annoncé, y compris dans le rail replié", () => {
  assert.equal(translatePlural("fr", "stock_bas.pastille", 1), "1\u00a0produit en stock bas");
  assert.equal(translatePlural("fr", "stock_bas.pastille", 3), "3\u00a0produits en stock bas");
  assert.equal(translatePlural("en", "stock_bas.pastille", 1), "1 product low on stock");
  assert.equal(translatePlural("en", "stock_bas.pastille", 3), "3 products low on stock");
  assert.match(read("./cadre/navigation.tsx"), /<span role="img" aria-label=\{tn\("stock_bas\.pastille", stats\.low_stock_products\)\} className="absolute -right-2 -top-2 /);
  const rail = read("./cadre/rail.tsx");
  assert.match(rail, /aria-label=\{expanded \? undefined : extraLabel \? `\$\{label\}, \$\{extraLabel\}` : label\}/);
  assert.match(rail, /extraLabel=\{view === "products" && lowStock > 0 \? tn\("stock_bas\.pastille", lowStock\) : undefined\}/);
});

test("V1-69 : le libellé « Couleur » nomme le groupe des pastilles", () => {
  const picker = read("./ink-picker.tsx");
  assert.match(picker, /const id = useId\(\);/);
  assert.match(picker, /<div role="group" aria-labelledby=\{id\} className="space-y-1\.5">\s*<Label id=\{id\}>\{t\("commun\.couleur"\)\}<\/Label>/);
});
