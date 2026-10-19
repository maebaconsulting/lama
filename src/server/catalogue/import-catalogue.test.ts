import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { cliBundle } from "../test-support.ts";
import { analyserCatalogue, COLONNES, description, importerCatalogue, lireCatalogue } from "./import-catalogue.ts";

const ENTETE = COLONNES.join(";");
const TISSAGE = "Coiffure femme;Women's hair;Tissages et chignons;Weaves and buns;Chignon lace;Lace bun;60;10000;15000;#4B4B4B;;";
const KNOTLESS = "Tresses africaines;African braids;Knotless braids;Knotless braids;Knotless micro, long;Knotless micro, long;;30000;;#4A5D73;Durée à confirmer;Duration to be confirmed";

function base() {
  const dir = mkdtempSync(join(tmpdir(), "lama-catalogue-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  return { dir, db };
}

test("lecture : durée vide lue comme 60 minutes, fourchette gardée, BOM et fins de ligne Windows acceptés", () => {
  const { lignes, erreurs } = lireCatalogue(`﻿${ENTETE}\r\n${TISSAGE}\r\n${KNOTLESS}\r\n`);
  assert.deepEqual(erreurs, []);
  assert.equal(lignes.length, 2);
  assert.deepEqual([lignes[0].duree, lignes[0].prix, lignes[0].prixMax], [60, 10000, 15000]);
  assert.deepEqual([lignes[1].duree, lignes[1].prixMax], [60, null]);
});

test("lecture : toutes les lignes fautives sont signalées, avec leur numéro et leur motif", () => {
  const texte = [ENTETE,
    "Coiffure femme;;;;;;60;5000;;#4B4B4B;;",
    "Coiffure femme;;;;Brushing;;3 jours;5000;;#4B4B4B;;",
    "Coiffure femme;;;;Brushing;;45;5 000;;#4B4B4B;;",
    "Coiffure femme;;;;Chignon;;45;5000;5000;#4B4B4B;;",
    "Coiffure femme;;;;Défrisage;;45;5000;;gris;;",
    "Coiffure femme;;;;Tissage;;45;5000;;#4B4B4B;;",
    "Coiffure femme;;;;Tissage;;45;6000;;#4B4B4B;;",
    "Coiffure femme;un;deux",
  ].join("\n");
  assert.deepEqual(lireCatalogue(texte).erreurs, [
    { ligne: 2, motif: "catalogue.nom_vide" },
    { ligne: 3, motif: "catalogue.duree" },
    { ligne: 4, motif: "catalogue.prix" },
    { ligne: 5, motif: "catalogue.prix_max" },
    { ligne: 6, motif: "catalogue.couleur" },
    { ligne: 8, motif: "catalogue.doublon", doublon: true },
    { ligne: 9, motif: "import.colonnes", valeurs: { attendu: 12, lu: 3 } },
  ]);
  assert.equal(lireCatalogue("nom;prix\nTissage;5000").erreurs[0].motif, "import.entete_manque");
});

test("description : groupe, fourchette en francs CFA et remarque, dans chaque langue", () => {
  const [chignon, knotless] = lireCatalogue(`${ENTETE}\n${TISSAGE}\n${KNOTLESS}`).lignes;
  assert.equal(description(chignon, "fr"), "Tissages et chignons. De 10\u202f000\u00a0FCFA à 15\u202f000\u00a0FCFA.");
  assert.equal(description(chignon, "en"), "Weaves and buns. From 10,000 FCFA to 15,000 FCFA.");
  assert.equal(description(knotless, "fr"), "Knotless braids. Durée à confirmer.");
});

test("écriture : ajout, puis un second chargement met à jour sans doubler et garde le réglage « en ligne »", () => {
  const { db } = base();
  const { lignes } = lireCatalogue(`${ENTETE}\n${TISSAGE}\n${KNOTLESS}`);
  assert.deepEqual(importerCatalogue(db, lignes, { desactiverAbsentes: false, devise: "XAF" }), { ajoutees: 2, misesAJour: 0, desactivees: 0 });
  db.prepare("UPDATE services SET en_ligne = 1, price = 1, active = 0 WHERE name = 'Chignon lace'").run();
  assert.deepEqual(importerCatalogue(db, lignes, { desactiverAbsentes: false, devise: "XAF" }), { ajoutees: 0, misesAJour: 2, desactivees: 0 });
  const chignon = db.prepare("SELECT * FROM services WHERE name = 'Chignon lace'").all() as Record<string, unknown>[];
  assert.equal(chignon.length, 1);
  assert.equal(chignon[0].price, 10000);
  assert.equal(chignon[0].duration, 60);
  assert.equal(chignon[0].active, 1);
  assert.equal(chignon[0].en_ligne, 1);
  assert.equal(chignon[0].category_en, "Women's hair");
  assert.equal(chignon[0].name_en, "Lace bun");
  db.close();
});

test("écriture : les prestations absentes du fichier sont désactivées sur demande, jamais supprimées", () => {
  const { db } = base();
  db.prepare("INSERT INTO services (name, category, duration, price) VALUES ('Maquillage de soirée', 'Maquillage', 60, 20000)").run();
  const { lignes } = lireCatalogue(`${ENTETE}\n${TISSAGE}`);
  assert.deepEqual(importerCatalogue(db, lignes, { desactiverAbsentes: false, devise: "XAF" }).desactivees, 0);
  assert.deepEqual(importerCatalogue(db, lignes, { desactiverAbsentes: true, devise: "XAF" }), { ajoutees: 0, misesAJour: 1, desactivees: 1 });
  const maquillage = db.prepare("SELECT active FROM services WHERE name = 'Maquillage de soirée'").get() as { active: number };
  assert.equal(maquillage.active, 0);
  db.close();
});

test("lecture : guillemets (point-virgule dans une remarque), séparateur virgule, colonnes dans un autre ordre", () => {
  const guillemets = lireCatalogue(`${ENTETE}\nCoiffure femme;;;;Brushing;;45;5000;;#4B4B4B;"Long; sur cheveux secs";\n`);
  assert.deepEqual(guillemets.erreurs, []);
  assert.equal(guillemets.lignes[0].remarque, "Long; sur cheveux secs");
  const virgules = lireCatalogue(`${COLONNES.join(",")}\nCoiffure femme,,,,Brushing,,45,5000,,#4B4B4B,"Long, sur cheveux secs",\n`);
  assert.deepEqual(virgules.erreurs, []);
  assert.equal(virgules.lignes[0].remarque, "Long, sur cheveux secs");
  const desordre = lireCatalogue(`${[...COLONNES].reverse().join(";")}\n;;#4B4B4B;;5000;45;;Brushing;;;;Coiffure femme\n`);
  assert.deepEqual(desordre.erreurs, []);
  assert.equal(desordre.lignes[0].nom, "Brushing");
});

test("lecture : un ancien fichier, sans colonnes facultatives, est en XAF et sans suppléments", () => {
  const l = lireCatalogue(`${ENTETE}\n${TISSAGE}\n`);
  assert.equal(l.devise, "XAF");
  assert.equal(l.lignes[0].supplementSeulement, null);
  assert.equal(l.lignes[0].supplementsPossibles, null);
});

test("lecture : forme des colonnes de suppléments (noms reconnus à l'aperçu et à l'import)", () => {
  const entete = `${ENTETE};supplement_seulement;supplements_possibles`;
  const l = lireCatalogue([entete,
    "Soins;;;;Masque;;30;3000;;#4B4B4B;;;oui;",
    "Soins;;;;Soin hydratant;;60;15000;;#4B4B4B;;;;Masque | Soins > Gommage|Huile",
    "Soins;;;;Gommage;;20;2000;;#4B4B4B;;;peut-être;",
    "Soins;;;;Soin éclat;;60;15000;;#4B4B4B;;;non;Masque||Huile",
    "Soins;;;;Soin nuit;;60;15000;;#4B4B4B;;;;a > b > c",
  ].join("\n"));
  assert.deepEqual(l.lignes.map((x) => [x.nom, x.supplementSeulement, x.supplementsPossibles]), [
    ["Masque", true, []],
    ["Soin hydratant", false, ["Masque", "Soins > Gommage", "Huile"]],
  ]);
  assert.deepEqual(l.erreurs, [
    { ligne: 4, motif: "import.oui_non", valeurs: { colonne: "supplement_seulement" } },
    { ligne: 5, motif: "catalogue.supplements_possibles" },
    { ligne: 6, motif: "catalogue.supplements_possibles" },
  ]);
});

test("lecture : colonne devise, fourchette écrite dans cette devise", () => {
  const l = lireCatalogue(`${ENTETE};devise\nSoins;Care;;;Soin hydratant;Facial;60;1500;2500;#4B4B4B;;;EUR\n`);
  assert.deepEqual(l.erreurs, []);
  assert.equal(l.devise, "EUR");
  assert.equal(description(l.lignes[0], "fr", "EUR"), "De 15,00\u00a0EUR à 25,00\u00a0EUR.");
  assert.equal(description(l.lignes[0], "en", "EUR"), "From 15.00 EUR to 25.00 EUR.");
});

test("aperçu : ajouts, mises à jour, désactivations comptés sans rien écrire ; devise signalée ; colonnes de suppléments appliquées sans avertissement", () => {
  const { db } = base();
  db.prepare("INSERT INTO services (name, category, duration, price) VALUES ('Chignon lace', 'Coiffure femme', 60, 1)").run();
  db.prepare("INSERT INTO services (name, category, duration, price) VALUES ('Maquillage de soirée', 'Maquillage', 60, 20000)").run();
  const lecture = lireCatalogue(`${ENTETE}\n${TISSAGE}\n${KNOTLESS}`);
  const a = analyserCatalogue(db, lecture, { base: "XAF", desactiverAbsentes: true });
  assert.deepEqual([a.lignes, a.ajouts, a.misesAJour, a.desactivees, a.erreurFichier], [2, 1, 1, 1, null]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number }).n, 2, "rien d'écrit");
  assert.deepEqual(analyserCatalogue(db, lecture, { base: "EUR", desactiverAbsentes: false }).erreurFichier, { motif: "import.devise_base", valeurs: { fichier: "XAF", base: "EUR" } });
  const avecSupplements = lireCatalogue(`${ENTETE};supplement_seulement\n${TISSAGE};non\n`);
  assert.deepEqual(analyserCatalogue(db, avecSupplements, { base: "XAF", desactiverAbsentes: false }).avertissements, []);
  db.close();
});

/** Lance `cli importer-catalogue` sur une base jetable. */
function importer(contenu: string | null, extra: string[] = [], dir = mkdtempSync(join(tmpdir(), "lama-cli-catalogue-"))) {
  const fichier = join(dir, "catalogue.csv");
  if (contenu !== null) writeFileSync(fichier, contenu);
  const env = { ...process.env, LAMA_DEV: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_LANGUE: "fr" };
  const r = spawnSync(process.execPath, ["--no-warnings", cliBundle(), "importer-catalogue", fichier, ...extra], { env, encoding: "utf8" });
  return { ...r, dir };
}

test("cli importer-catalogue : chargement, bilan affiché et inscrit au journal", () => {
  const r = importer(`${ENTETE}\n${TISSAGE}\n${KNOTLESS}\n`, ["--desactiver-absentes"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 prestations lues, 2 ajoutées, 0 mises à jour, 0 désactivées\./);
  const db = openDatabase(join(r.dir, "lama.db"));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM services WHERE active = 1").get() as { n: number }).n, 2);
  const journal = db.prepare("SELECT account_id, target FROM audit_log WHERE action = 'catalogue.import'").all() as { account_id: number | null; target: string }[];
  assert.equal(journal.length, 1);
  assert.equal(journal[0].account_id, null);
  assert.match(journal[0].target, /^catalogue\.csv\u00a0: 2 prestations lues/);
  db.close();
});

test("cli importer-catalogue : un fichier fautif est refusé en entier, sans même ouvrir la base", () => {
  const r = importer(`${ENTETE}\n${TISSAGE}\nCoiffure femme;;;;Brushing;;45;cinq mille;;#4B4B4B;;\n`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Ligne 3\u00a0: prix attendu en nombre entier/);
  assert.match(r.stderr, /rien n'a été écrit/);
  assert.equal(existsSync(join(r.dir, "lama.db")), false);
  assert.equal(importer(null).status, 1, "fichier absent");
  assert.equal(importer(`${ENTETE}\n${TISSAGE}\n`, ["--tout-supprimer"]).status, 1, "option inconnue : usage");
});

test("cli importer-catalogue : une base dans une autre devise que le franc CFA est refusée", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-cli-catalogue-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('institut.devise', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify("EUR"));
  db.close();
  const r = importer(`${ENTETE}\n${TISSAGE}\n`, [], dir);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /La devise de l'institut est EUR/);
  const relue = openDatabase(join(dir, "lama.db"));
  assert.equal((relue.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number }).n, 0);
  relue.close();
});

test("cli importer-catalogue : fichier en euros avec sa colonne devise chargé dans une base en euros", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-cli-catalogue-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('institut.devise', ?, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify("EUR"));
  db.close();
  const r = importer(`${ENTETE};devise\nSoins;;;;Soin hydratant;;60;1500;;#4A5D73;;;EUR\n`, [], dir);
  assert.equal(r.status, 0, r.stderr);
  const relue = openDatabase(join(dir, "lama.db"));
  assert.equal((relue.prepare("SELECT price FROM services WHERE name = 'Soin hydratant'").get() as { price: number }).price, 1500);
  relue.close();
});

test("cli importer-catalogue : fichier qui n'est pas en UTF-8 refusé sans ouvrir la base", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-cli-catalogue-"));
  const fichier = join(dir, "catalogue.csv");
  writeFileSync(fichier, Buffer.concat([Buffer.from(`${ENTETE}\nSoins;;;;Soin `), Buffer.from([0xe9]), Buffer.from("clat;;60;1500;;#4A5D73;;\n")]));
  const env = { ...process.env, LAMA_DEV: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_LANGUE: "fr" };
  const r = spawnSync(process.execPath, ["--no-warnings", cliBundle(), "importer-catalogue", fichier], { env, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CSV UTF-8/);
  assert.equal(existsSync(join(dir, "lama.db")), false);
});

test("reconnaissance sans accents ni majuscules : la fiche existante est mise à jour et garde son nom et son univers", () => {
  const { db } = base();
  db.prepare("INSERT INTO services (name, category, duration, price) VALUES ('Soin hydratant', 'Soins du visage', 60, 1000)").run();
  const lecture = lireCatalogue(`${ENTETE}\nSoins du Visage;;;;Soin Hydratant;;45;15000;;#4A5D73;;\n`);
  assert.deepEqual(lecture.erreurs, []);
  const a = analyserCatalogue(db, lecture, { base: "XAF", desactiverAbsentes: false });
  assert.deepEqual([a.ajouts, a.misesAJour], [0, 1]);
  assert.deepEqual(importerCatalogue(db, lecture.lignes, { desactiverAbsentes: false, devise: "XAF" }), { ajoutees: 0, misesAJour: 1, desactivees: 0 });
  assert.deepEqual(db.prepare("SELECT name, category, duration, price FROM services").all().map((r) => ({ ...r })), [
    { name: "Soin hydratant", category: "Soins du visage", duration: 45, price: 15000 },
  ]);
  db.close();
});

test("doublon du fichier : deux lignes qui ne diffèrent que par la casse ou les accents", () => {
  const { erreurs } = lireCatalogue(`${ENTETE}\nVisage;;;;Soin éclat;;60;1000;;#4A5D73;;\nVISAGE;;;;Soin Eclat;;60;1000;;#4A5D73;;\n`);
  assert.deepEqual(erreurs, [{ ligne: 3, motif: "catalogue.doublon", doublon: true }]);
});

test("prix : entier sûr seulement, un nombre démesuré est refusé", () => {
  const { erreurs } = lireCatalogue(`${ENTETE}\nVisage;;;;Soin;;60;99999999999999999999;;#4A5D73;;\n`);
  assert.deepEqual(erreurs, [{ ligne: 2, motif: "catalogue.prix" }]);
});

test("devise à décimales : prix non entier refusé avec l'unité (centimes) ; premier prix lu rendu par l'aperçu", () => {
  const { db } = base();
  const lecture = lireCatalogue(`${ENTETE};devise\nVisage;;;;Soin;;60;15,00;;#4A5D73;;;EUR\nVisage;;;;Soin éclat;;60;1500;;#4A5D73;;;EUR\n`);
  assert.deepEqual(lecture.erreurs, [{ ligne: 2, motif: "catalogue.prix_centimes", valeurs: { devise: "EUR" } }]);
  assert.equal(analyserCatalogue(db, lecture, { base: "EUR", desactiverAbsentes: false }).premierPrix, 1500);
  db.close();
});

test("cli importer-catalogue : un supplément introuvable refuse le fichier, ligne et motif imprimés, rien n'est écrit", () => {
  const r = importer(`${ENTETE};supplement_seulement;supplements_possibles\nCoiffure;;;;Nattes;;60;15000;;#4A5D73;;;non;Paillettes\n`);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Ligne 2\u00a0: supplément introuvable\u00a0: «\u00a0Paillettes\u00a0»/);
  assert.match(r.stderr, /rien n'a été écrit/);
  const db = openDatabase(join(r.dir, "lama.db"));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'catalogue.import'").get() as { n: number }).n, 0);
  db.close();
});

test("cli importer-catalogue : base présente, refus de lecture et suppléments introuvables montrés en une passe ; rien n'est écrit", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-cli-catalogue-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.close();
  const r = importer(`${ENTETE};supplement_seulement;supplements_possibles\nCoiffure;;;;Brushing;;45;cinq mille;;#4B4B4B;;;;\nCoiffure;;;;Nattes;;60;15000;;#4A5D73;;;non;Paillettes\n`, [], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Ligne 2\u00a0: prix attendu/);
  assert.match(r.stderr, /Ligne 3\u00a0: supplément introuvable/);
  assert.match(r.stderr, /\(2 lignes à corriger\)/);
  const relue = openDatabase(join(dir, "lama.db"));
  assert.equal((relue.prepare("SELECT COUNT(*) AS n FROM services").get() as { n: number }).n, 0);
  relue.close();
});
