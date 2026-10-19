import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { registerFunctions } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { lireTableau } from "./csv.ts";
import { analyseVide, cle, controlerDevise, importable, indexerPraticiennes, indexerPrestations, lireDevises, lireEntier, ouiNon } from "./commun.ts";

function base() {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

const COLS = { obligatoires: ["nom"], facultatives: ["devise"] } as const;
function tableau(texte: string) {
  const l = lireTableau(texte, COLS);
  if (!l.ok) throw new Error(l.erreur.motif);
  return l.tableau;
}

test("cle : sans accents, sans majuscules, espaces en trop retirés", () => {
  assert.equal(cle("  Soin   du Visage "), cle("soin du visage"));
  assert.equal(cle("Épilation"), "epilation");
});

test("ouiNon et lireEntier : saisies du tableur", () => {
  assert.deepEqual(["", "oui", "OUI", "non", " Non ", "peut-être"].map((v) => ouiNon(v, true)), [true, true, true, false, false, null]);
  assert.equal(ouiNon("", false), false);
  assert.deepEqual(["0", "15000", "", "5 000", "5000.5", "-3"].map(lireEntier), [0, 15000, null, null, null, null]);
  assert.equal(lireEntier("  5000 "), 5000, "espaces autour coupés");
  assert.equal(lireEntier("99999999999999999999"), null, "au-delà des entiers sûrs");
  assert.equal(lireEntier("9007199254740991"), 9007199254740991);
});

test("devise déclarée : sans colonne, XAF ; sinon la même sur toutes les lignes, connue et non vide", () => {
  assert.deepEqual(lireDevises(tableau("nom\nA\n")), { devise: "XAF", refusees: [] });
  assert.deepEqual(lireDevises(tableau("nom;devise\nA;eur\nB;EUR\n")), { devise: "EUR", refusees: [] });
  assert.deepEqual(lireDevises(tableau("nom;devise\nA;EUR\nB;\nC;ZZZ\nD;XAF\n")).refusees, [
    { ligne: 3, motif: "import.devise_vide" },
    { ligne: 4, motif: "import.devise_code", valeurs: { devise: "ZZZ" } },
    { ligne: 5, motif: "import.devise_melangee", valeurs: { devise: "XAF", premiere: "EUR" } },
  ]);
  assert.equal(controlerDevise("XAF", "XAF"), null);
  assert.deepEqual(controlerDevise("XAF", "EUR"), { motif: "import.devise_base", valeurs: { fichier: "XAF", base: "EUR" } });
});

test("prestations : par nom, ou « Univers > Nom » quand le nom n'est pas unique ; fiches actives seulement", () => {
  const db = base();
  const ajouter = db.prepare("INSERT INTO services (name, category, duration, price, active) VALUES (?, ?, ?, ?, ?)");
  ajouter.run("Brushing", "Coiffure", 45, 8000, 1);
  ajouter.run("Brushing", "Enfants", 30, 5000, 1);
  ajouter.run("Soin éclat", "Visage", 60, 15000, 1);
  ajouter.run("Ancien soin", "Visage", 60, 1000, 0);
  const trouver = indexerPrestations(db);
  assert.deepEqual(trouver("soin eclat"), { trouve: { id: 3, name: "Soin éclat", category: "Visage", duration: 60, price: 15000, supplement_seulement: 0 } });
  assert.deepEqual(trouver("Brushing"), { motif: "import.prestation_ambigue", valeurs: { nom: "Brushing" } });
  assert.equal((trouver("Enfants > Brushing") as { trouve: { id: number } }).trouve.id, 2);
  assert.equal((trouver(" coiffure >brushing ") as { trouve: { id: number } }).trouve.id, 1);
  assert.deepEqual(trouver("Ancien soin"), { motif: "import.prestation_introuvable", valeurs: { nom: "Ancien soin" } });
  assert.deepEqual(trouver("a > b > c"), { motif: "import.prestation_introuvable", valeurs: { nom: "a > b > c" } });
  db.close();
});

test("praticiennes : par nom affiché, fiches actives seulement, homonymes refusés", () => {
  const db = base();
  const ajouter = db.prepare("INSERT INTO staff (name, email, title, color, active) VALUES (?, '', '', '#4A5D73', ?)");
  ajouter.run("Awa", 1);
  ajouter.run("Brenda", 1);
  ajouter.run("Brenda", 1);
  ajouter.run("Carole", 0);
  const trouver = indexerPraticiennes(db);
  assert.deepEqual(trouver("AWA"), { trouve: { id: 1, name: "Awa" } });
  assert.deepEqual(trouver("Brenda"), { motif: "import.praticienne_ambigue", valeurs: { nom: "Brenda" } });
  assert.deepEqual(trouver("Carole"), { motif: "import.praticienne_introuvable", valeurs: { nom: "Carole" } });
  db.close();
});

test("importable : au moins une ligne, aucune refusée, pas d'erreur de fichier", () => {
  assert.equal(importable(analyseVide(0)), false);
  assert.equal(importable(analyseVide(2)), true);
  assert.equal(importable(analyseVide(2, [{ ligne: 2, motif: "import.nom_vide" }])), false);
  assert.equal(importable({ ...analyseVide(2), erreurFichier: { motif: "import.devise_base" } }), false);
});
