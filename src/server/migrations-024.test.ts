import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATIONS, runMigrations } from "./migrations.ts";

const avant024 = MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === "024_supplements"));

function base(list = MIGRATIONS): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, list);
  return db;
}

/** Base en service : une vente (prestation et produit), puis un avoir qui reprend le produit et le remet en stock. */
function remplir(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO staff (id, name) VALUES (1, 'Awa');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha');
    INSERT INTO services (id, name, duration, price) VALUES (1, 'Tresses', 60, 15000);
    INSERT INTO products (id, name, brand, price, stock) VALUES (1, 'Crème', 'Maison', 10000, 5);
    INSERT INTO sequences (series, year, last) VALUES ('FAC', 2026, 1);
    INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, request_id)
      VALUES ('invoice', 'FAC-2026-000001', 'FAC', 2026, 1, 0, 'fr', 1, 1, 25000, 0, 25000, 25000, 0, '{}', 'vente-0001');
    INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total, staff_id) VALUES (1, 'service', 1, 'Tresses', 1, 15000, 15000, 1);
    INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total, staff_id) VALUES (1, 'product', 1, 'Crème', 1, 10000, 10000, NULL);
    INSERT INTO sequences (series, year, last) VALUES ('AV', 2026, 1);
    INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, credited_invoice_id, reason, request_id)
      VALUES ('credit_note', 'AV-2026-000001', 'AV', 2026, 1, 0, 'fr', 1, 1, 10000, 0, 10000, 10000, 0, '{}', 1, 'Retour', 'avoir-0001');
    INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total, staff_id, credited_line_id, restock) VALUES (2, 'product', 1, 'Crème', 1, 10000, 10000, NULL, 2, 1);
  `);
}

const lignes = (db: DatabaseSync) => db.prepare(
  "SELECT id, invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id, restock, credited_line_id FROM invoice_lines ORDER BY id",
).all().map((r) => ({ ...r }));
const sqlDe = (db: DatabaseSync, name: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(name) as { sql: string }).sql;
const noms = (db: DatabaseSync, type: string) => db.prepare(
  "SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = 'invoice_lines' AND name NOT LIKE 'sqlite_%' ORDER BY name",
).all(type).map((r) => (r as { name: string }).name);

test("024 : base en service, lignes de facture reprises à l'identique ; vue, déclencheurs, index et numérotation gardés", () => {
  const db = base(avant024);
  remplir(db);
  const avant = {
    lignes: lignes(db),
    solde: db.prepare("SELECT * FROM invoice_balance ORDER BY invoice_id").all().map((r) => ({ ...r })),
    acompte: sqlDe(db, "deposits_deduit"),
    vue: sqlDe(db, "invoice_balance"),
  };
  assert.deepEqual(runMigrations(db), ["024_supplements", "025_mise_a_jour"]);
  assert.deepEqual(lignes(db), avant.lignes);
  assert.deepEqual(db.prepare("SELECT * FROM invoice_balance ORDER BY invoice_id").all().map((r) => ({ ...r })), avant.solde);
  assert.equal(sqlDe(db, "deposits_deduit"), avant.acompte, "déclencheur des acomptes recréé à l'identique");
  assert.equal(sqlDe(db, "invoice_balance"), avant.vue, "vue recréée à l'identique");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(noms(db, "trigger"), [
    "avoir_lignes_plafond", "invoice_lines_gardees", "invoice_lines_immuables", "invoice_lines_nature", "invoice_lines_reecriture", "invoice_lines_supplement",
  ]);
  assert.deepEqual(noms(db, "index"), ["invoice_lines_credited", "invoice_lines_invoice", "invoice_lines_parent"]);
  assert.throws(() => db.exec("UPDATE invoice_lines SET quantity = 2 WHERE id = 1"), /ne se modifie pas/);
  assert.throws(() => db.exec("DELETE FROM invoice_lines WHERE id = 1"), /ne se supprime pas/);
  assert.throws(
    () => db.exec("INSERT OR REPLACE INTO invoice_lines (id, invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total) VALUES (1, 1, 'service', 1, 'X', 1, 1, 1)"),
    /ne se modifie pas/,
  );
  const id = Number(db.prepare(
    "INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total, staff_id, parent_line_id) VALUES (1, 'libre', NULL, 'Perles dorées', 1, 3000, 3000, 1, 1)",
  ).run().lastInsertRowid);
  assert.equal(id, 4, "les identifiants des lignes continuent après la reconstruction");
});

test("024 : un supplément suit une prestation seule du même document ; le supplément libre n'a pas d'article", () => {
  const db = base();
  remplir(db);
  const ligne = (valeurs: string) => () => db.exec(
    `INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total, staff_id, parent_line_id) VALUES ${valeurs}`,
  );
  assert.throws(ligne("(1, 'libre', NULL, 'Perles', 1, 3000, 3000, 1, NULL)"), /Supplément sans sa prestation/, "libre sans prestation");
  assert.throws(ligne("(1, 'libre', 1, 'Perles', 1, 3000, 3000, 1, 1)"), /CHECK/, "libre avec un article");
  assert.throws(ligne("(1, 'service', NULL, 'Tresses', 1, 3000, 3000, 1, NULL)"), /CHECK/, "prestation sans article");
  assert.throws(ligne("(1, 'product', 1, 'Crème', 1, 10000, 10000, 1, 2)"), /Supplément sans sa prestation/, "rattaché à un produit");
  ligne("(1, 'product', 1, 'Crème', 1, 10000, 10000, 1, 1)")();
  assert.throws(ligne("(1, 'product', 1, 'Crème', 1, 10000, 10000, 1, 4)"), /Supplément sans sa prestation/, "supplément d'un supplément");
});

test("024 : suppléments possibles d'une prestation, jamais elle-même, nettoyés quand l'article est supprimé", () => {
  const db = base();
  db.exec("INSERT INTO services (id, name) VALUES (1, 'Tresses'), (2, 'Mèches'); INSERT INTO products (id, name) VALUES (5, 'Perles');");
  assert.equal((db.prepare("SELECT supplement_seulement FROM services WHERE id = 1").get() as { supplement_seulement: number }).supplement_seulement, 0);
  assert.throws(() => db.exec("UPDATE services SET supplement_seulement = 2 WHERE id = 1"), /CHECK/);
  db.exec("INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (1, 'service', 2, 0), (1, 'product', 5, 1)");
  assert.throws(() => db.exec("INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (1, 'service', 1, 2)"), /CHECK/, "jamais son propre supplément");
  assert.throws(() => db.exec("INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (1, 'service', 2, 3)"), /UNIQUE|PRIMARY/);
  const compte = () => (db.prepare("SELECT COUNT(*) AS n FROM service_supplements").get() as { n: number }).n;
  db.exec("DELETE FROM products WHERE id = 5");
  assert.equal(compte(), 1, "produit supprimé : retiré des listes");
  db.exec("DELETE FROM services WHERE id = 2");
  assert.equal(compte(), 0, "prestation supprimée : retirée des listes");
  db.exec("INSERT INTO services (id, name) VALUES (3, 'Perruque'); INSERT INTO service_supplements (service_id, kind, ref_id, position) VALUES (1, 'service', 3, 0)");
  db.exec("DELETE FROM services WHERE id = 1");
  assert.equal(compte(), 0, "prestation supprimée : sa liste part avec elle");
});

test("024 : suppléments d'un rendez-vous, bornes du supplément libre, effacés avec la prestation du rendez-vous", () => {
  const db = base();
  db.exec(`
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha');
    INSERT INTO services (id, name) VALUES (1, 'Tresses');
    INSERT INTO appointments (id, identifier, client_id) VALUES (1, 'APT-1', 1);
    INSERT INTO appointment_services (id, appointment_id, service_id, price, duration) VALUES (1, 1, 1, 15000, 60);
  `);
  const ajout = (valeurs: string) => () => db.exec(
    `INSERT INTO appointment_supplements (appointment_service_id, kind, ref_id, label_fr, quantity, price, minutes, position) VALUES ${valeurs}`,
  );
  ajout("(1, 'libre', NULL, 'Perles dorées', 1, 3000, 15, 0)")();
  ajout("(1, 'product', 5, 'Perles', 3, 500, 0, 1)")();
  assert.throws(ajout("(1, 'libre', NULL, '   ', 1, 0, 0, 2)"), /CHECK/, "libellé vide");
  assert.throws(ajout(`(1, 'libre', NULL, '${"x".repeat(81)}', 1, 0, 0, 2)`), /CHECK/, "81 caractères");
  assert.throws(ajout("(1, 'libre', NULL, 'Long', 1, 0, 241, 2)"), /CHECK/, "241 minutes");
  assert.throws(ajout("(1, 'libre', 3, 'Perles', 1, 0, 0, 2)"), /CHECK/, "libre avec un article");
  assert.throws(ajout("(1, 'service', 2, 'Mèches', 2, 0, 30, 2)"), /CHECK/, "une prestation en supplément compte une fois");
  assert.throws(ajout("(1, 'product', 5, 'Perles', 1, 500, 10, 2)"), /CHECK/, "un produit n'ajoute pas de minutes");
  assert.throws(ajout("(1, 'product', 5, 'Perles', 1, -1, 0, 2)"), /CHECK/, "prix négatif");
  db.exec("DELETE FROM appointments WHERE id = 1");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM appointment_supplements").get() as { n: number }).n, 0);
});
