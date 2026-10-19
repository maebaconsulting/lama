import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { registerFunctions } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { lireTableau } from "./csv.ts";
import { importable } from "./commun.ts";
import { analyserClientes, anniversaireDeFichier, COLONNES_CLIENTES, ecrireClientes } from "./clientes.ts";

const ENTETE = "nom;telephone;langue;anniversaire;preferences;whatsapp;notes";
const CTX = { indicatif: "237" };

function base() {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}
function tableau(texte: string) {
  const l = lireTableau(texte, COLONNES_CLIENTES);
  if (!l.ok) throw new Error(l.erreur.motif);
  return l.tableau;
}
const fiches = (db: DatabaseSync) => db.prepare("SELECT name, phone, language, birthday, preferences, channel, notes FROM clients ORDER BY id").all().map((r) => ({ ...r }));

test("anniversaire : JJ-MM du fichier enregistré MM-JJ, date impossible refusée", () => {
  assert.equal(anniversaireDeFichier("14-02"), "02-14");
  assert.equal(anniversaireDeFichier("29-02"), "02-29");
  assert.equal(anniversaireDeFichier("31-02"), null);
  assert.equal(anniversaireDeFichier("02/14"), null);
});

test("anniversaire : JJ/MM laissé par le tableur accepté comme JJ-MM", () => {
  assert.equal(anniversaireDeFichier("14/02"), "02-14");
  assert.equal(anniversaireDeFichier("31/04"), null);
  assert.equal(anniversaireDeFichier("14.02"), null);
});

test("nom : suites d'espaces et retours à la ligne ramenés à une espace ; les notes gardent leurs retours", () => {
  const db = base();
  const a = analyserClientes(db, tableau(`${ENTETE}\n"Awa\n  Exemple";699000001;;;;;"ligne 1\nligne 2"\n`), CTX);
  ecrireClientes(db, a.operations);
  assert.deepEqual(db.prepare("SELECT name, notes FROM clients").all().map((r) => ({ ...r })), [{ name: "Awa Exemple", notes: "ligne 1\nligne 2" }]);
  db.close();
});

test("ajout : téléphone normalisé, anniversaire, langue, canal ; l'analyse n'écrit rien", () => {
  const db = base();
  const t = tableau(`${ENTETE}\nAwa Exemple;699 00 00 01;FR;14-02;Thé sans sucre;oui;\nBella Exemple;+237 677 00 00 02;;;;non;Allergie au latex\n`);
  const a = analyserClientes(db, t, CTX);
  assert.deepEqual([a.lignes, a.ajouts, a.misesAJour, a.inchangees, a.refusees.length], [2, 2, 0, 0, 0]);
  assert.equal(importable(a), true);
  assert.deepEqual(fiches(db), [], "rien d'écrit par l'analyse");
  ecrireClientes(db, a.operations);
  assert.deepEqual(fiches(db), [
    { name: "Awa Exemple", phone: "+237699000001", language: "fr", birthday: "02-14", preferences: "Thé sans sucre", channel: "whatsapp", notes: "" },
    { name: "Bella Exemple", phone: "+237677000002", language: "", birthday: "", preferences: "", channel: "none", notes: "Allergie au latex" },
  ]);
  db.close();
});

test("doublon en base : la fiche est seulement complétée, rien n'est écrasé ; nom différent signalé", () => {
  const db = base();
  db.prepare("INSERT INTO clients (name, phone, language, notes, preferences) VALUES (?, ?, '', ?, '')").run("Awa Exemple", "699 00 00 01", "Cliente fidèle");
  db.prepare("INSERT INTO clients (name, phone, language, birthday) VALUES (?, ?, 'en', '03-01')").run("Carla Exemple", "677000003");
  const t = tableau(`${ENTETE}\nA. Exemple;+237699000001;en;14-02;Thé;non;Autre note\nCarla Exemple;0677000003;fr;05-05;;;\n`);
  const a = analyserClientes(db, t, CTX);
  assert.deepEqual([a.ajouts, a.misesAJour, a.inchangees], [0, 1, 1]);
  assert.deepEqual(a.avertissements, [{ ligne: 2, motif: "import.nom_different", valeurs: { fichier: "A. Exemple", fiche: "Awa Exemple" } }]);
  ecrireClientes(db, a.operations);
  const awa = { ...(db.prepare("SELECT name, phone, language, birthday, preferences, channel, notes FROM clients WHERE id = 1").get() as object) };
  assert.deepEqual(awa, { name: "Awa Exemple", phone: "699 00 00 01", language: "en", birthday: "02-14", preferences: "Thé", channel: "whatsapp", notes: "Cliente fidèle" });
  db.close();
});

test("doublon reconnu sous une autre forme : deux lignes au même numéro normalisé, la seconde refusée", () => {
  const db = base();
  const t = tableau(`${ENTETE}\nAwa;699 00 00 01;;;;;\nAwa bis;+237 699-00-00-01;;;;;\nBella;00237677000002;;;;;\n`);
  const a = analyserClientes(db, t, CTX);
  assert.deepEqual(a.refusees, [{ ligne: 3, motif: "import.doublon_telephone", doublon: true }]);
  assert.equal(a.ajouts, 2);
  db.close();
});

test("lignes refusées : nom, téléphone, langue, anniversaire, préférences, whatsapp ; chacune avec son numéro", () => {
  const db = base();
  const t = tableau([ENTETE,
    ";699000001;;;;;",
    "Awa;12;;;;;",
    "Bella;699000002;de;;;;",
    "Carla;699000003;;31-02;;;",
    `Dina;699000004;;;${"x".repeat(501)};;`,
    "Ella;699000005;;;;peut-être;",
    "Fanny;699000006;;;;;",
  ].join("\n"));
  const a = analyserClientes(db, t, CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.nom_vide" },
    { ligne: 3, motif: "import.telephone" },
    { ligne: 4, motif: "import.langue" },
    { ligne: 5, motif: "import.anniversaire" },
    { ligne: 6, motif: "cliente.preferences_longueur" },
    { ligne: 7, motif: "import.oui_non", valeurs: { colonne: "whatsapp" } },
  ]);
  assert.equal(a.ajouts, 1);
  assert.equal(importable(a), false);
  db.close();
});

test("une ligne refusée pour un autre motif ne fait pas refuser sa jumelle valide comme doublon", () => {
  const db = base();
  const t = tableau(`${ENTETE}\nAwa;699 00 00 01;de;;;;\nAwa;+237 699 00 00 01;fr;;;;\nAwa bis;699000001;;;;;\n`);
  const a = analyserClientes(db, t, CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.langue" },
    { ligne: 4, motif: "import.doublon_telephone", doublon: true },
  ]);
  assert.equal(a.ajouts, 1);
  db.close();
});
