import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { registerFunctions } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { analyserCatalogue, CatalogueRefuse, COLONNES, importerCatalogue, lireCatalogue } from "./import-catalogue.ts";

const ENTETE = [...COLONNES, "supplement_seulement", "supplements_possibles"].join(";");
/** Ligne du fichier : univers, nom, durée, case et liste ; le reste est neutre. */
const ligne = (categorie: string, nom: string, seulement = "", possibles = "", duree = "60") => `${categorie};;;;${nom};;${duree};5000;;#4A5D73;;;${seulement};${possibles}`;

/** Deux « Tresses » (Coiffure, Enfants), « Mèches » (Coiffure), « Soin » (Visage) qui accepte « Masque », le produit « Perles ». */
function base(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  db.exec(`
    INSERT INTO services (id, name, category, duration, price, en_ligne) VALUES
      (1, 'Tresses', 'Coiffure', 60, 15000, 1), (2, 'Tresses', 'Enfants', 45, 10000, 0), (3, 'Mèches', 'Coiffure', 30, 5000, 1),
      (4, 'Soin', 'Visage', 60, 20000, 0), (5, 'Masque', 'Visage', 15, 4000, 0);
    INSERT INTO products (id, name, price) VALUES (7, 'Perles', 500);
    INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (4, 'service', 5, 0);
  `);
  return db;
}

const idDe = (db: DatabaseSync, categorie: string, nom: string) => (db.prepare("SELECT id FROM services WHERE category = ? AND name = ?").get(categorie, nom) as { id: number }).id;
const liste = (db: DatabaseSync, id: number) => db.prepare("SELECT kind, ref_id FROM service_supplements WHERE service_id = ? ORDER BY position").all(id).map((r) => ({ ...r }));
const compte = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** Aperçu puis import du texte ; rend les refus de l'aperçu, et ceux de l'import (`null` s'il a écrit). */
function charger(db: DatabaseSync, lignes: string[], desactiverAbsentes = false) {
  const lecture = lireCatalogue([ENTETE, ...lignes].join("\n"));
  assert.deepEqual(lecture.erreurs, []);
  const apercu = analyserCatalogue(db, lecture, { base: "XAF", desactiverAbsentes });
  let refusImport: unknown = null;
  try {
    importerCatalogue(db, lecture.lignes, { desactiverAbsentes, devise: "XAF" });
  } catch (e) {
    if (!(e instanceof CatalogueRefuse)) throw e;
    refusImport = e.refus;
  }
  return { apercu, refusImport };
}

test("suppléments possibles : prestation unique, « Univers > Nom », produit, prestation du fichier ; doublon gardé une fois, sans accents ni majuscules", () => {
  const db = base();
  const { apercu, refusImport } = charger(db, [
    ligne("Coiffure", "Nattes", "non", "Mèches | Perles | Enfants > Tresses | Extensions | meches"),
    ligne("Coiffure", "Extensions", "oui", "", "0"),
  ]);
  assert.deepEqual(apercu.refusees, []);
  assert.equal(refusImport, null);
  const extensions = idDe(db, "Coiffure", "Extensions");
  assert.deepEqual(liste(db, idDe(db, "Coiffure", "Nattes")), [
    { kind: "service", ref_id: 3 }, { kind: "product", ref_id: 7 }, { kind: "service", ref_id: 2 }, { kind: "service", ref_id: extensions },
  ]);
  db.close();
});

test("refus : nom ambigu ou introuvable, la prestation elle-même, cascade (base ou fichier), liste d'une prestation déjà supplément ; l'aperçu les montre et rien n'est écrit", () => {
  const db = base();
  const avant = compte(db, "SELECT COUNT(*) AS n FROM services");
  const { apercu, refusImport } = charger(db, [
    ligne("Coiffure", "Chignon", "", "Tresses"),
    ligne("Coiffure", "Brushing", "", "Paillettes"),
    ligne("Coiffure", "Coupe", "", "Coiffure > Coupe"),
    ligne("Coiffure", "Nattes", "", "Soin"),
    ligne("Visage", "Masque", "", "Perles"),
    ligne("Visage", "Gommage", "", "Mèches"),
    ligne("Visage", "Éclat", "", "Gommage"),
    ligne("Visage", "Peeling", "", "Enfants > Mèches"),
  ]);
  const attendus = [
    { ligne: 2, motif: "catalogue.supplement_ambigu", valeurs: { nom: "Tresses" } },
    { ligne: 3, motif: "catalogue.supplement_introuvable", valeurs: { nom: "Paillettes" } },
    { ligne: 4, motif: "catalogue.supplement_lui_meme" },
    { ligne: 5, motif: "catalogue.supplement_en_cascade", valeurs: { nom: "Soin" } },
    { ligne: 6, motif: "catalogue.supplement_deja" },
    { ligne: 8, motif: "catalogue.supplement_en_cascade", valeurs: { nom: "Gommage" } },
    { ligne: 9, motif: "catalogue.supplement_introuvable", valeurs: { nom: "Enfants > Mèches" } },
  ];
  assert.deepEqual(apercu.refusees, attendus);
  assert.deepEqual(refusImport, attendus, "l'import refuse exactement ce que l'aperçu montre");
  assert.equal(compte(db, "SELECT COUNT(*) AS n FROM services"), avant, "tout ou rien : aucune prestation écrite");
  assert.deepEqual(liste(db, 4), [{ kind: "service", ref_id: 5 }]);
  db.close();
});

test("la liste de Soin vidée par le fichier : Masque n'est plus le supplément de personne et reçoit la sienne", () => {
  const db = base();
  const { apercu, refusImport } = charger(db, [ligne("Visage", "Masque", "", "Perles"), ligne("Visage", "Soin", "", "")]);
  assert.deepEqual(apercu.refusees, []);
  assert.equal(refusImport, null);
  assert.deepEqual(liste(db, 4), []);
  assert.deepEqual(liste(db, 5), [{ kind: "product", ref_id: 7 }]);
  db.close();
});

test("écriture : colonne absente garde la case et la liste, liste vide la vide ; « supplément seulement » retirée de l'offre en ligne, réglage en ligne gardé sinon", () => {
  const db = base();
  const lecture = lireCatalogue([
    `${COLONNES.join(";")};supplements_possibles`,
    "Coiffure;;;;Tresses;;60;15000;;#4A5D73;;;Mèches | Perles",
    "Visage;;;;Soin;;60;20000;;#4A5D73;;;",
  ].join("\n"));
  importerCatalogue(db, lecture.lignes, { desactiverAbsentes: false, devise: "XAF" });
  assert.deepEqual(liste(db, 1), [{ kind: "service", ref_id: 3 }, { kind: "product", ref_id: 7 }]);
  assert.deepEqual(liste(db, 4), [], "colonne présente mais vide : liste vidée");
  db.prepare("INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (4, 'service', 5, 0)").run();
  const { refusImport } = charger(db, [ligne("Coiffure", "Mèches", "oui", "", "0")]);
  assert.equal(refusImport, null);
  const sansColonnes = lireCatalogue([COLONNES.join(";"), "Visage;;;;Soin;;60;20000;;#4A5D73;;", "Coiffure;;;;Tresses;;60;15000;;#4A5D73;;"].join("\n"));
  importerCatalogue(db, sansColonnes.lignes, { desactiverAbsentes: false, devise: "XAF" });
  assert.deepEqual(liste(db, 4), [{ kind: "service", ref_id: 5 }], "colonne absente : liste gardée");
  assert.deepEqual(liste(db, 1), [{ kind: "service", ref_id: 3 }, { kind: "product", ref_id: 7 }]);
  const lire = (id: number) => ({ ...(db.prepare("SELECT duration, supplement_seulement, en_ligne FROM services WHERE id = ?").get(id) as object) });
  assert.deepEqual(lire(3), { duration: 0, supplement_seulement: 1, en_ligne: 0 });
  assert.deepEqual(lire(1), { duration: 60, supplement_seulement: 0, en_ligne: 1 });
  charger(db, [ligne("Coiffure", "Mèches", "", "", "30")]);
  assert.deepEqual(lire(3), { duration: 30, supplement_seulement: 0, en_ligne: 0 }, "case vide vaut non");
  db.close();
});

test("durée 0 permise seulement pour une ligne « supplément seulement »", () => {
  const { erreurs } = lireCatalogue([ENTETE, ligne("Coiffure", "Perles dorées", "oui", "", "0"), ligne("Coiffure", "Mèches", "non", "", "0"), ligne("Coiffure", "Fils", "oui", "", "721")].join("\n"));
  assert.deepEqual(erreurs, [{ ligne: 3, motif: "catalogue.duree" }, { ligne: 4, motif: "catalogue.duree" }]);
});

test("désactiver les absentes : une prestation qui sera désactivée ne peut plus être citée en supplément", () => {
  const db = base();
  const { apercu } = charger(db, [ligne("Coiffure", "Nattes", "", "Mèches")], true);
  assert.deepEqual(apercu.refusees, [{ ligne: 2, motif: "catalogue.supplement_introuvable", valeurs: { nom: "Mèches" } }]);
  db.close();
});

test("deux produits du même nom : la ligne est refusée ; au-delà de 30 suppléments aussi", () => {
  const db = base();
  db.prepare("INSERT INTO products (id, name, price) VALUES (8, 'perles', 600)").run();
  const trop = Array.from({ length: 31 }, (_, i) => `Fil ${i}`);
  const { apercu } = charger(db, [ligne("Coiffure", "Nattes", "", "Perles"), ligne("Coiffure", "Chignon", "", trop.join("|")), ...trop.map((n) => ligne("Fils", n, "oui", "", "0"))]);
  assert.deepEqual(apercu.refusees, [
    { ligne: 2, motif: "catalogue.supplement_produit_ambigu", valeurs: { nom: "Perles" } },
    { ligne: 3, motif: "catalogue.supplements_trop" },
  ]);
  db.close();
});

test("fichier sans les deux colonnes : une prestation déjà « supplément seulement » garde ses 0 minutes et sa case ; une prestation ordinaire à 0 minute est refusée, à l'aperçu comme à l'import", () => {
  const db = base();
  db.prepare("INSERT INTO services (id, name, category, duration, price, supplement_seulement) VALUES (9, 'Perles', 'Coiffure', 0, 500, 1)").run();
  const sans = (lignes: string[]) => lireCatalogue([COLONNES.join(";"), ...lignes].join("\n"));
  const bon = sans(["Coiffure;;;;Perles;;0;600;;#4A5D73;;"]);
  assert.deepEqual(bon.erreurs, []);
  assert.deepEqual(analyserCatalogue(db, bon, { base: "XAF", desactiverAbsentes: false }).refusees, []);
  importerCatalogue(db, bon.lignes, { desactiverAbsentes: false, devise: "XAF" });
  assert.deepEqual({ ...(db.prepare("SELECT duration, price, supplement_seulement FROM services WHERE id = 9").get() as object) }, { duration: 0, price: 600, supplement_seulement: 1 });
  const mauvais = sans(["Coiffure;;;;Perles;;0;700;;#4A5D73;;", "Coiffure;;;;Mèches;;0;5000;;#4A5D73;;", "Coiffure;;;;Fils;;3;100;;#4A5D73;;"]);
  assert.deepEqual(mauvais.erreurs, []);
  const attendus = [{ ligne: 3, motif: "catalogue.duree" }, { ligne: 4, motif: "catalogue.duree" }];
  assert.deepEqual(analyserCatalogue(db, mauvais, { base: "XAF", desactiverAbsentes: false }).refusees, attendus);
  assert.throws(() => importerCatalogue(db, mauvais.lignes, { desactiverAbsentes: false, devise: "XAF" }), (e) => e instanceof CatalogueRefuse && JSON.stringify(e.refus) === JSON.stringify(attendus));
  assert.equal((db.prepare("SELECT price FROM services WHERE id = 9").get() as { price: number }).price, 600, "tout ou rien");
  assert.equal(compte(db, "SELECT COUNT(*) AS n FROM services WHERE name = 'Fils'"), 0);
  db.close();
});

test("« supplément seulement » et liste à l'import : liste du fichier sous une case cochée, ou case cochée sur une prestation qui garde sa liste ; refusées à l'aperçu comme à l'import", () => {
  const db = base();
  const ENTETE_CASE = [...COLONNES, "supplement_seulement"].join(";");
  const sansListe = lireCatalogue([ENTETE_CASE, "Visage;;;;Soin;;60;5000;;#4A5D73;;;oui"].join("\n"));
  assert.deepEqual(sansListe.erreurs, []);
  const attendu = [{ ligne: 2, motif: "catalogue.supplement_seulement_liste" }];
  assert.deepEqual(analyserCatalogue(db, sansListe, { base: "XAF", desactiverAbsentes: false }).refusees, attendu, "Soin garde sa liste : la case ne se coche pas");
  assert.throws(() => importerCatalogue(db, sansListe.lignes, { desactiverAbsentes: false, devise: "XAF" }), (e) => e instanceof CatalogueRefuse && JSON.stringify(e.refus) === JSON.stringify(attendu));
  const { apercu, refusImport } = charger(db, [ligne("Coiffure", "Nattes", "oui", "Perles"), ligne("Visage", "Soin", "oui", "")]);
  assert.deepEqual(apercu.refusees, attendu);
  assert.deepEqual(refusImport, attendu);
  assert.deepEqual(liste(db, 4), [{ kind: "service", ref_id: 5 }], "rien n'est écrit");
  assert.equal(compte(db, "SELECT COUNT(*) AS n FROM services WHERE supplement_seulement = 1"), 0);
  db.close();
});
