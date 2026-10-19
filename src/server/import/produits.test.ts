import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { registerFunctions } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { lireTableau } from "./csv.ts";
import { importable } from "./commun.ts";
import { analyserProduits, cibleStock, COLONNES_PRODUITS, ecrireProduits } from "./produits.ts";

const ENTETE = "nom;nom_en;marque;categorie;categorie_en;reference;prix;cout;stock;seuil_alerte;devise";

function base() {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}
function tableau(texte: string) {
  const l = lireTableau(texte, COLONNES_PRODUITS);
  if (!l.ok) throw new Error(l.erreur.motif);
  return l.tableau;
}
const produit = (db: DatabaseSync, nom: string) => ({ ...(db.prepare("SELECT name, name_en, brand, category, sku, price, cost, stock, low_stock_alert FROM products WHERE name = ?").get(nom) as object) });

test("ajout : valeurs par défaut de la création (coût 0, stock 0, seuil 5), l'analyse n'écrit rien", () => {
  const db = base();
  const a = analyserProduits(db, tableau(`${ENTETE}\nCrème hydratante;Moisturising cream;Marque exemple;Soins;Care;EX-001;8000;;;;XAF\n`), { base: "XAF" });
  assert.deepEqual([a.ajouts, a.misesAJour, a.refusees.length, a.erreurFichier], [1, 0, 0, null]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM products").get() as { n: number }).n, 0);
  ecrireProduits(db, a.operations);
  assert.deepEqual(produit(db, "Crème hydratante"), { name: "Crème hydratante", name_en: "Moisturising cream", brand: "Marque exemple", category: "Soins", sku: "EX-001", price: 8000, cost: 0, stock: 0, low_stock_alert: 5 });
  db.close();
});

test("doublon en base : par référence si elle est renseignée, sinon par le nom ; stock vide gardé, stock renseigné noté au journal", () => {
  const db = base();
  db.prepare("INSERT INTO products (name, brand, sku, price, cost, stock, low_stock_alert) VALUES ('Huile de coco', 'Ancienne', 'HC-1', 4000, 2000, 12, 3)").run();
  db.prepare("INSERT INTO products (name, brand, sku, price, cost, stock, low_stock_alert) VALUES ('Savon noir', '', '', 1500, 500, 7, 2)").run();
  const t = tableau([ENTETE,
    "Huile de coco vierge;;;;;hc-1;4500;;8;;XAF",
    "savon NOIR;;Marque exemple;;;;1500;;;;XAF",
  ].join("\n"));
  const a = analyserProduits(db, t, { base: "XAF" });
  assert.deepEqual([a.ajouts, a.misesAJour, a.inchangees], [0, 2, 0]);
  assert.deepEqual(a.journal, [{ action: "produit.stock", cible: "Huile de coco vierge\u00a0: 12 → 8" }]);
  ecrireProduits(db, a.operations);
  assert.deepEqual(produit(db, "Huile de coco vierge"), { name: "Huile de coco vierge", name_en: "", brand: "Ancienne", category: "", sku: "HC-1", price: 4500, cost: 2000, stock: 8, low_stock_alert: 3 });
  assert.deepEqual(produit(db, "Savon noir"), { name: "Savon noir", name_en: "", brand: "Marque exemple", category: "", sku: "", price: 1500, cost: 500, stock: 7, low_stock_alert: 2 });
  db.close();
});

test("rien de changé : ligne comptée inchangée ; même fichier envoyé deux fois, second envoi sans effet", () => {
  const db = base();
  const texte = `${ENTETE}\nCrème hydratante;;;;;EX-001;8000;4000;10;3;XAF\n`;
  ecrireProduits(db, analyserProduits(db, tableau(texte), { base: "XAF" }).operations);
  const second = analyserProduits(db, tableau(texte), { base: "XAF" });
  assert.deepEqual([second.ajouts, second.misesAJour, second.inchangees, second.journal.length], [0, 0, 1, 0]);
  db.close();
});

test("lignes refusées : nom, prix, entiers, doublons du fichier, fiches ambiguës en base", () => {
  const db = base();
  db.prepare("INSERT INTO products (name, sku, price) VALUES ('Masque', 'M-1', 1000), ('Masque', 'M-1', 1000)").run();
  const t = tableau([ENTETE,
    ";;;;;;1000;;;;XAF",
    "Lotion;;;;;;;;;;XAF",
    "Lotion;;;;;;1 000;;;;XAF",
    "Lotion;;;;;;1000;;-2;;XAF",
    "Gel;;;;;G-1;1000;;;;XAF",
    "Gel bis;;;;;g-1;1000;;;;XAF",
    "Gel;;;;;;1000;;;;XAF",
    "Gel;;;;;;1000;;;;XAF",
    "Masque;;;;;;1000;;;;XAF",
    "Autre masque;;;;;M-1;1000;;;;XAF",
  ].join("\n"));
  const a = analyserProduits(db, t, { base: "XAF" });
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.nom_vide" },
    { ligne: 3, motif: "import.entier", valeurs: { colonne: "prix" } },
    { ligne: 4, motif: "import.entier", valeurs: { colonne: "prix" } },
    { ligne: 5, motif: "import.entier", valeurs: { colonne: "stock" } },
    { ligne: 7, motif: "import.doublon_produit", doublon: true },
    { ligne: 8, motif: "import.doublon_produit", doublon: true },
    { ligne: 9, motif: "import.doublon_produit", doublon: true },
    { ligne: 10, motif: "import.nom_ambigu" },
    { ligne: 11, motif: "import.reference_ambigue" },
  ]);
  assert.equal(importable(a), false);
  db.close();
});

test("même fiche visée par sa référence puis par son nom : la seconde ligne est refusée, le journal ne note qu'un changement", () => {
  const db = base();
  db.prepare("INSERT INTO products (name, sku, price, stock) VALUES ('Huile de coco', 'HC-1', 4000, 12)").run();
  const a = analyserProduits(db, tableau([ENTETE, "Huile de coco;;;;;HC-1;4000;;8;;XAF", "Huile de coco;;;;;;4000;;5;;XAF"].join("\n")), { base: "XAF" });
  assert.deepEqual(a.refusees, [{ ligne: 3, motif: "import.doublon_produit", doublon: true }]);
  assert.deepEqual(a.journal, [{ action: "produit.stock", cible: "Huile de coco\u00a0: 12 → 8" }]);
  db.close();
});

test("ligne qui renomme une fiche puis ligne au nouveau nom : la seconde est refusée ; produit neuf avec puis sans référence aussi", () => {
  const db = base();
  db.prepare("INSERT INTO products (name, sku, price) VALUES ('Ancien nom', 'AN-1', 1000)").run();
  const a = analyserProduits(db, tableau([ENTETE,
    "Nouveau nom;;;;;AN-1;1000;;;;XAF",
    "Nouveau nom;;;;;;1000;;;;XAF",
    "Sérum;;;;;SE-1;1000;;;;XAF",
    "Sérum;;;;;;1000;;;;XAF",
  ].join("\n")), { base: "XAF" });
  assert.deepEqual(a.refusees.map((r) => r.ligne), [3, 5]);
  assert.deepEqual([a.ajouts, a.misesAJour], [1, 1]);
  db.close();
});

test("devise : fichier sans colonne devise lu en XAF, refusé en entier dans une base en euros", () => {
  const db = base();
  const sansColonne = lireTableau("nom;prix\nCrème;1500\n", COLONNES_PRODUITS);
  assert.ok(sansColonne.ok);
  assert.deepEqual(analyserProduits(db, sansColonne.tableau, { base: "EUR" }).erreurFichier, { motif: "import.devise_base", valeurs: { fichier: "XAF", base: "EUR" } });
  const enEuros = analyserProduits(db, tableau(`${ENTETE}\nCrème;;;;;;1500;;;;EUR\n`), { base: "EUR" });
  assert.deepEqual([enEuros.erreurFichier, enEuros.ajouts], [null, 1]);
  db.close();
});

test("cible du journal : le nom est raccourci pour que les deux valeurs tiennent dans 64 caractères", () => {
  const cible = cibleStock("x".repeat(80), 120, 95);
  assert.equal([...cible].length, 64);
  assert.match(cible, /…\u00a0: 120 → 95$/);
});

test("référence inconnue : la fiche du même nom sans référence est mise à jour et reçoit la référence", () => {
  const db = base();
  db.prepare("INSERT INTO products (name, sku, price, stock) VALUES ('Savon noir', '', 1500, 7)").run();
  db.prepare("INSERT INTO products (name, sku, price, stock) VALUES ('Huile de coco', 'HC-1', 4000, 12)").run();
  const t = tableau([ENTETE,
    "savon NOIR;;;;;SN-1;1500;;;;XAF",
    "Huile de coco;;;;;HC-2;4000;;;;XAF",
    "Savon noir;;;;;;1500;;;;XAF",
  ].join("\n"));
  const a = analyserProduits(db, t, { base: "XAF" });
  assert.deepEqual([a.ajouts, a.misesAJour], [1, 1], "le savon reçoit sa référence ; l'huile référencée HC-1 n'est pas prise pour HC-2");
  assert.deepEqual(a.refusees, [{ ligne: 4, motif: "import.doublon_produit", doublon: true }]);
  ecrireProduits(db, a.operations.filter((op) => op.type === "maj"));
  assert.deepEqual(db.prepare("SELECT name, sku FROM products ORDER BY id").all().map((r) => ({ ...r })), [
    { name: "Savon noir", sku: "SN-1" },
    { name: "Huile de coco", sku: "HC-1" },
  ]);
  db.close();
});

test("noms : suites d'espaces et retours à la ligne ramenés à une espace", () => {
  const db = base();
  const a = analyserProduits(db, tableau(`${ENTETE}\n"Crème\n  hydratante";"Moisturising   cream";;;;;8000;;;;XAF\n`), { base: "XAF" });
  ecrireProduits(db, a.operations);
  assert.deepEqual(db.prepare("SELECT name, name_en FROM products").all().map((r) => ({ ...r })), [{ name: "Crème hydratante", name_en: "Moisturising cream" }]);
  db.close();
});

test("devise à décimales : montant non entier refusé avec l'unité (centimes) ; premier prix lu rendu pour l'aperçu", () => {
  const db = base();
  const a = analyserProduits(db, tableau(`${ENTETE}\nCrème;;;;;;15,00;;;;EUR\nSavon;;;;;;1500;800;2,5;;EUR\nHuile;;;;;;2500;;;;EUR\n`), { base: "EUR" });
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.entier_centimes", valeurs: { colonne: "prix", devise: "EUR" } },
    { ligne: 3, motif: "import.entier", valeurs: { colonne: "stock" } },
  ]);
  assert.equal(a.premierPrix, 2500);
  const xaf = analyserProduits(db, tableau(`${ENTETE}\nCrème;;;;;;15,00;;;;XAF\n`), { base: "XAF" });
  assert.deepEqual(xaf.refusees, [{ ligne: 2, motif: "import.entier", valeurs: { colonne: "prix" } }]);
  db.close();
});
