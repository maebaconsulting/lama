import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, runMigrations } from "./migrations.ts";
import { registerFunctions } from "./storage.ts";
import { convertirMontants } from "./devise.ts";

function base(t: { after: (fn: () => void) => void }) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  t.after(() => db.close());
  return db;
}

test("base neuve : aucune ligne de devise ; écriture libre tant que rien ne la fige", (t) => {
  const db = base(t);
  assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'institut.devise'").get(), undefined);
  db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.devise', '\"EUR\"', 0, 0)").run();
  db.prepare("UPDATE settings SET value = '\"USD\"' WHERE key = 'institut.devise'").run();
});

test("déclencheurs : devise figée par un acompte, même en SQL direct ; la même valeur se réécrit, y compris par upsert", (t) => {
  const db = base(t);
  db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.devise', '\"XAF\"', 0, 0)").run();
  db.prepare("INSERT INTO sequences (series, year, last) VALUES ('AC', 2026, 1)").run();
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'booked', '2026-10-20');
    INSERT INTO deposits (number, series, year, seq, appointment_id, client_id, amount, issued_at, account_id, fiscal, lang, request_id)
      VALUES ('AC-2026-000001', 'AC', 2026, 1, 1, 1, 10000, 0, 1, '{}', 'fr', 'acompte-1');
  `);
  db.prepare("UPDATE settings SET updated_at = 1 WHERE key = 'institut.devise'").run();
  // Même écriture que `setSetting` et `writeSettingNow` (settings.ts:175-194) : un upsert de la même valeur passe, comme pour le préfixe (018).
  const upsert = db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.devise', ?, 0, 2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
  upsert.run('"XAF"');
  assert.throws(() => upsert.run('"EUR"'), /Devise figée/);
  assert.throws(() => db.prepare("UPDATE settings SET value = '\"EUR\"' WHERE key = 'institut.devise'").run(), /Devise figée/);
  assert.throws(() => db.prepare("DELETE FROM settings WHERE key = 'institut.devise'").run(), /Devise figée/);
  assert.throws(() => db.prepare("UPDATE settings SET key = 'autre' WHERE key = 'institut.devise'").run(), /Devise figée/);
});

test("convertirMontants : ×100 vers l'euro, ÷100 arrondi vers le XAF", (t) => {
  const db = base(t);
  db.exec("INSERT INTO services (id, name, duration, price) VALUES (1, 'Tresses', 60, 15000)");
  convertirMontants(db, "XAF", "EUR");
  assert.equal((db.prepare("SELECT price FROM services").get() as { price: number }).price, 1500000);
  db.exec("UPDATE services SET price = 1550");
  convertirMontants(db, "EUR", "XAF");
  assert.equal((db.prepare("SELECT price FROM services").get() as { price: number }).price, 16);
});

test("déclencheurs : un réglage secret (valeur scellée, pas du JSON) se réécrit et s'efface toujours", (t) => {
  const db = base(t);
  const upsert = db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('waha.cle', ?, 1, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  upsert.run("scellé:aaa");
  upsert.run("scellé:bbb");
  db.prepare("DELETE FROM settings WHERE key = 'waha.cle'").run();
});

/** Base arrêtée à la migration 018, comme une base en service avant la mise à jour multi-devises. */
function baseAvant019(t: { after: (fn: () => void) => void }) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, MIGRATIONS.filter((m) => m.id < "019"));
  t.after(() => db.close());
  return db;
}

const devise = (db: DatabaseSync) => (db.prepare("SELECT value FROM settings WHERE key = 'institut.devise'").get() as { value: string } | undefined)?.value;
const upsertDevise = (db: DatabaseSync, value: string) => db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.devise', ?, 0, 1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(value);

test("migration 019 sur une base en service avec une facture : XAF écrit et aussitôt figé", (t) => {
  const db = baseAvant019(t);
  db.exec(`
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO products (id, name, brand, price, stock) VALUES (1, 'Crème hydratante', 'Maison', 10000, 5);
    INSERT INTO sequences (series, year, last) VALUES ('FAC', 2026, 1);
    INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, request_id)
      VALUES ('invoice', 'FAC-2026-000001', 'FAC', 2026, 1, 0, 'fr', 1, 10000, 0, 10000, 10000, 0, '{}', 'ancienne-0001');
    INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id) VALUES (1, 'product', 1, 'Crème hydratante', '', 1, 10000, 10000, NULL);
    INSERT INTO payments (invoice_id, method, amount, reference, cash_given, change_given) VALUES (1, 'cash', 10000, '', 10000, 0);
  `);
  assert.deepEqual(runMigrations(db), ["019_devise", "020_horaires", "021_en_ligne", "022_curseur_ref", "023_prenom_en_ligne", "024_supplements"]);
  assert.equal(devise(db), '"XAF"');
  upsertDevise(db, '"XAF"');
  assert.equal(devise(db), '"XAF"', "la même valeur se réécrit");
  assert.throws(() => upsertDevise(db, '"EUR"'), /Devise figée\./);
  assert.equal(devise(db), '"XAF"');
});

test("migration 019 sur une base en service avec un compte seulement : XAF écrit, encore modifiable", (t) => {
  const db = baseAvant019(t);
  db.exec("INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Admin', 'admin', 'admin', 'x', 0)");
  runMigrations(db);
  assert.equal(devise(db), '"XAF"');
  upsertDevise(db, '"EUR"');
  assert.equal(devise(db), '"EUR"');
});

/** Montants convertis par `convertirMontants`, lus tels qu'en base. */
function montants(db: DatabaseSync) {
  const val = (key: string) => (db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
  return {
    service: (db.prepare("SELECT price FROM services WHERE id = 1").get() as { price: number }).price,
    produit: { ...(db.prepare("SELECT price, cost FROM products WHERE id = 1").get() as { price: number; cost: number }) },
    rendezVous: (db.prepare("SELECT total_price FROM appointments WHERE id = 1").get() as { total_price: number }).total_price,
    prestationRdv: (db.prepare("SELECT price FROM appointment_services WHERE appointment_id = 1").get() as { price: number }).price,
    tranche: val("fidelite.tranche"),
    paliers: val("fidelite.paliers"),
  };
}

test("convertirMontants : aller-retour XAF → EUR → XAF du catalogue, des rendez-vous et de la fidélité enregistrée", (t) => {
  const db = base(t);
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO services (id, name, duration, price) VALUES (1, 'Tresses', 60, 15000);
    INSERT INTO products (id, name, brand, price, cost, stock) VALUES (1, 'Sérum', 'Maison', 5000, 2500, 3);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date, total_price) VALUES (1, 'APT-1', 1, 1, 'booked', '2026-10-20', 15000);
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 15000, 60);
    INSERT INTO settings (key, value, secret, updated_at) VALUES ('fidelite.tranche', '1500', 0, 0);
    INSERT INTO settings (key, value, secret, updated_at) VALUES ('fidelite.paliers', '[{"points":100,"montant":5000},{"points":300,"montant":20000}]', 0, 0);
  `);
  const depart = montants(db);
  convertirMontants(db, "XAF", "EUR");
  assert.deepEqual(montants(db), {
    service: 1500000, produit: { price: 500000, cost: 250000 }, rendezVous: 1500000, prestationRdv: 1500000,
    tranche: "150000", paliers: '[{"points":100,"montant":500000},{"points":300,"montant":2000000}]',
  });
  convertirMontants(db, "EUR", "XAF");
  assert.deepEqual(montants(db), depart);
});

test("convertirMontants : un défaut de fidélité jamais écrit reste non écrit, donc non converti", (t) => {
  const db = base(t);
  db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('fidelite.paliers', ?, 0, 0)").run('[{"points":100,"montant":5000}]');
  convertirMontants(db, "XAF", "EUR");
  assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'fidelite.tranche'").get(), undefined, "tranche par défaut : lue dans la nouvelle devise");
  assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'fidelite.paliers'").get() as { value: string }).value, '[{"points":100,"montant":500000}]');
});

test("convertirMontants : le prix d'un supplément de rendez-vous suit la devise, aller et retour", (t) => {
  const db = base(t);
  db.exec(`
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO services (id, name, duration, price) VALUES (1, 'Tresses', 60, 15000);
    INSERT INTO appointments (id, identifier, client_id, status, scheduled_date, total_price) VALUES (1, 'APT-1', 1, 'booked', '2026-10-20', 18000);
    INSERT INTO appointment_services (id, appointment_id, service_id, price, duration) VALUES (1, 1, 1, 15000, 60);
    INSERT INTO appointment_supplements (appointment_service_id, kind, ref_id, label_fr, quantity, price, minutes, position) VALUES (1, 'libre', NULL, 'Perles dorées', 1, 3000, 15, 0);
  `);
  const prix = () => (db.prepare("SELECT price FROM appointment_supplements").get() as { price: number }).price;
  convertirMontants(db, "XAF", "EUR");
  assert.equal(prix(), 300000);
  convertirMontants(db, "EUR", "XAF");
  assert.equal(prix(), 3000);
});
