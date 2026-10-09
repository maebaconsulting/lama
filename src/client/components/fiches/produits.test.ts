import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Produits (sous-projet 4 § 6) : carte avec stock et badge, fiche avec − et +. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liste = read("../product-list.tsx");
const fiche = read("./fiche-produit.tsx");
const hook = read("../../hooks/use-app.ts");

test("liste : nom, marque, prix, stock, badge « Stock bas » au trait rouge à côté du stock (pas sous le prix) ; fiche dans le panneau", () => {
  assert.match(liste, /export const isLowStock = \(p: Pick<Product, "stock" \| "low_stock_alert">\) => p\.stock <= p\.low_stock_alert;/);
  assert.match(liste, /border border-encre-rouge px-2 py-0\.5 text-encre-rouge/, "au trait, jamais en pastille pleine");
  assert.match(liste, /secondaire=\{<>\{t\("produit\.en_stock", \{ stock: p\.stock \}\)\}\{low && <> <BadgeStockBas \/><\/>\}<\/>\}/, "le badge suit le texte du stock, dans secondaire");
  assert.match(liste, /fin=\{\s*<span className="chiffres whitespace-nowrap font-medium"><Montant valeur=\{formatPrice\(p\.price, lang\)\} \/><\/span>\s*\}/, "fin ne montre que le prix");
  assert.match(liste, /onOpen=\{\(\) => openPanel\("product", p\.id\)\}/);
  assert.doesNotMatch(liste, /<Table|Pencil|Trash2|AlertTriangle/);
});

test("stock : − et + pour la gérante et la réception, jamais sous zéro, inactifs pendant l'envoi ; la praticienne lit", () => {
  assert.equal(fiche.match(/\{commands\.adjustStock && \(/g)?.length, 2);
  assert.match(fiche, /await updateProduct\(product\.id, \{ stock: stockAfter\(product\.stock, delta\) \}\);/);
  assert.match(fiche, /disabled=\{saving \|\| product\.stock <= 0\} onClick=\{\(\) => adjust\(-1\)\}/);
  assert.match(fiche, /disabled=\{saving\} onClick=\{\(\) => adjust\(1\)\}/);
  assert.match(fiche, /className="h-12 w-12"/, "boutons de 48 px");
});

test("fiche lue par son identifiant (produit hors de la page chargée) et relue après un ajustement", () => {
  assert.match(hook, /async \(\) => await api<\{ product: Product \}>\("GET", `\/api\/products\/\$\{id\}`\)/);
  assert.match(hook, /if \(latest\.current\.selectedProduct\?\.id === id\) setSelectedProduct\(res\.product\);/);
  assert.equal(fiche.match(/\{commands\.manage && \(/g)?.length, 2, "Modifier et Supprimer pour la gérante seulement");
});

test("prix d'achat montré seulement quand le serveur l'envoie (absent pour la praticienne, V1-04)", () => {
  assert.match(fiche, /\{product\.cost !== undefined && <LigneDetail libelle=\{t\("colonne\.cout"\)\}>/);
});
