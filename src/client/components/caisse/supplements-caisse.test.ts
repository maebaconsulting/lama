import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Caisse et suppléments (spec du 18/10/2026 § 3.4), câblée sur `lib/ticket.ts` et `lib/supplements.ts` (testés en exécution). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const catalogue = read("./catalogue.tsx");
const ticket = read("./ticket-vente.tsx");
const fenetre = read("./fenetre-supplement.tsx");
const libre = read("../supplements/libre.tsx");
const vente = read("./vente.tsx");

test("un article « supplément seulement » n'a pas de tuile seule", () => {
  assert.match(catalogue, /const actives = sellableAlone\(services\);/);
});

test("ticket : suppléments en retrait sous leur prestation, quantité d'un produit, retrait, « + Supplément » sur chaque prestation", () => {
  assert.match(ticket, /l\.supplements\.map\(\(s\) =>/);
  assert.match(ticket, /onChange\(removeSupplement\(ticket, l\.index, s\.index\)\)/);
  assert.match(ticket, /onChange\(setSupplementQuantity\(ticket, l\.index, s\.index, s\.supplement\.quantity \+ 1, s\.stock \?\? undefined\)\)/);
  assert.match(ticket, /onClick=\{\(\) => setSupplementDe\(l\.index\)\}/);
  assert.match(ticket, /onChange\(addSupplement\(ticket, supplementDe, sup, stock\)\)/);
  assert.match(ticket, /libre=\{account\.role !== "practitioner"\}/, "la praticienne n'ajoute pas de supplément libre (le serveur refuse)");
  assert.match(vente, /catalog=\{\{ services, products: products\.data\?\.products \?\? \[\] \}\}/);
});

test("le + d'une ligne de produit compte aussi le même produit en supplément", () => {
  assert.match(ticket, /quantityOf\(ticket, l\.line\.ref_id\) >= l\.stock/);
});

test("rangée d'un supplément : commandes sous le libellé quand la place manque, nom calculé une fois, « + Supplément » nommé et absent sous une prestation retirée", () => {
  assert.match(ticket, /flex flex-wrap items-center gap-x-2 gap-y-1 text-sm/);
  assert.match(ticket, /min-w-\[8rem\] flex-1 break-words/);
  assert.match(ticket, /const nom = s\.missing \? t\("caisse\.article_retire"\) : s\.label;/);
  assert.doesNotMatch(ticket, /designation: s\.label/);
  assert.match(ticket, /aria-label=\{t\("supplement\.ajouter_a", \{ nom: l\.label \}\)\}/);
  assert.match(ticket, /\{!l\.missing && \(\n\s+<Button[^\n]*supplement\.ajouter_a/);
});

test("clés : « supplement.ajouter_a » dans les deux langues, plus de clé morte « supplement.ajoute »", () => {
  for (const f of ["../../i18n/fr.ts", "../../i18n/en.ts"]) {
    assert.match(read(f), /"supplement\.ajouter_a":/);
    assert.doesNotMatch(read(f), /"supplement\.ajoute"/);
  }
});

test("fenêtre « + Supplément » : suppléments possibles de la prestation, supplément libre contrôlé comme le serveur", () => {
  assert.match(fenetre, /const choix = choicesFor\(serviceId, catalog, lang\);/);
  assert.match(fenetre, /onDone\(\{ kind: c\.kind, ref_id: c\.ref_id, quantity: 1 \}, stock\)/);
  assert.match(fenetre, /<ChampsLibre minutes=\{false\}/);
  assert.match(libre, /libreProblem\(value\)/);
  assert.match(libre, /amountProblem\(price, "prix"\)/);
});

test("fenêtre : produit sans place désactivé avec « en stock : 0 », fermeture seulement à la fermeture ; champs libres à identifiants uniques", () => {
  assert.match(fenetre, /disabled=\{rupture\}/);
  assert.match(fenetre, /t\("caisse\.en_stock", \{ n: 0 \}\)/);
  assert.match(fenetre, /onOpenChange=\{\(o\) => !o && onClose\(\)\}/);
  assert.match(libre, /const id = useId\(\);/);
  assert.match(libre, /minutes && "grid-cols-2"/);
  assert.doesNotMatch(libre, /id="supplement-/);
});

test("facture et avoir à l'écran : suppléments en retrait ; reprendre une prestation propose ses suppléments", () => {
  const facture = read("./fiche-facture.tsx");
  const avoir = read("./formulaire-avoir.tsx");
  assert.match(facture, /\{orderedLines\(inv\.lines\)\.map\(\(l\) => \(/);
  assert.match(avoir, /\{draftRows\(invoice, draft\)\.map\(\(\{ draft: d, line, supplement \}\) => \{/);
  assert.match(avoir, /d\.quantity > 0 && supplementsLeft\(invoice, draft, line\.id\)/);
  assert.match(avoir, /setDraft\(takeSupplements\(invoice, draft, line\.id\)\);/);
  assert.match(avoir, /aria-label=\{t\("avoir\.reprendre_supplements_de", \{ designation: name \}\)\}/);
  assert.match(avoir, /document\.getElementById\(`avoir-ligne-\$\{line\.id\}`\)\?\.focus\(\)/);
  assert.match(facture, /<span className="min-w-0 break-words">\{pickText\(lang, l\.label_fr, l\.label_en\)\}<\/span>/);
});
