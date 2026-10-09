import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase, sqliteStorage } from "./storage.ts";
import { MIGRATIONS, runMigrations } from "./migrations.ts";
import { EMPREINTE_SIGLE, empreinte, serieHistorique } from "./neutralite-empreintes.ts";
import { issueCreditNote, parseCreditRequest } from "./caisse/avoir.ts";
import { issueSale, parseSaleRequest } from "./caisse/vente.ts";

const tables = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

test("les migrations créent toutes les tables, une seule fois", () => {
  const db = openDatabase(":memory:");
  assert.deepEqual(runMigrations(db), MIGRATIONS.map((m) => m.id));
  for (const t of ["clients", "staff", "appointments", "accounts", "sessions", "devices", "audit_log", "settings", "outbox", "backups", "schema_migrations"]) {
    assert.ok(tables(db).includes(t), t);
  }
  assert.deepEqual(runMigrations(db), []);
  db.close();
});

test("beforeApply n'est appelé que s'il reste des migrations", () => {
  const db = openDatabase(":memory:");
  const seen: string[][] = [];
  runMigrations(db, MIGRATIONS, (ids) => seen.push(ids));
  runMigrations(db, MIGRATIONS, (ids) => seen.push(ids));
  assert.equal(seen.length, 1);
  db.close();
});

test("une migration en erreur est annulée et signalée", () => {
  const db = openDatabase(":memory:");
  const broken = [...MIGRATIONS, { id: "999_casse", sql: "CREATE TABLE ok (id INTEGER); CREATE TABLE ok (id INTEGER);" }];
  assert.throws(() => runMigrations(db, broken), /Migration 999_casse échouée/);
  assert.ok(!tables(db).includes("ok"));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = '999_casse'").get() as { n: number }).n, 0);
  db.close();
});

test("migration 009 (WhatsApp) : canal « whatsapp » par défaut, langue fr, en ou vide, heure de prise du rendez-vous, sort manuel d'un envoi", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.exec("INSERT INTO clients (id, name) VALUES (1, 'Aïcha')");
  assert.deepEqual({ ...db.prepare("SELECT channel, language FROM clients WHERE id = 1").get() }, { channel: "whatsapp", language: "" });
  assert.throws(() => db.exec("UPDATE clients SET language = 'de' WHERE id = 1"), /CHECK/);
  assert.throws(() => db.exec("UPDATE clients SET channel = 'fax' WHERE id = 1"), /CHECK/);
  db.exec("INSERT INTO appointments (id, identifier, client_id) VALUES (1, 'APT-1', 1)");
  assert.equal((db.prepare("SELECT booked_at FROM appointments WHERE id = 1").get() as { booked_at: number | null }).booked_at, null);
  db.exec("INSERT INTO outbox (kind, payload, dedupe_key, next_attempt_at, created_at) VALUES ('whatsapp', '{}', 'a', 0, 0)");
  assert.equal((db.prepare("SELECT manual FROM outbox").get() as { manual: string }).manual, "");
  assert.throws(() => db.exec("UPDATE outbox SET manual = 'perdu'"), /CHECK/);
  db.close();
});

test("migration 011 : case WhatsApp cochée → canal « whatsapp », décochée → « none »", () => {
  const db = openDatabase(":memory:");
  runMigrations(db, MIGRATIONS.filter((m) => m.id < "011"));
  db.exec("INSERT INTO clients (id, name, whatsapp_ok) VALUES (1, 'Aïcha', 1), (2, 'Brenda', 0)");
  runMigrations(db);
  assert.deepEqual(db.prepare("SELECT id, channel FROM clients ORDER BY id").all().map((r) => ({ ...r })), [{ id: 1, channel: "whatsapp" }, { id: 2, channel: "none" }]);
  assert.doesNotThrow(() => db.prepare("SELECT channel FROM outbox"), "colonne du canal utilisé présente dans la file");
});

test("migration 014 (mini CRM) : anniversaire vide ou MM-JJ, préférences vides, étiquettes supprimées avec la cliente", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.exec("INSERT INTO clients (id, name) VALUES (1, 'Aïcha')");
  assert.deepEqual({ ...db.prepare("SELECT birthday, preferences FROM clients WHERE id = 1").get() }, { birthday: "", preferences: "" });
  db.exec("UPDATE clients SET birthday = '10-14' WHERE id = 1");
  assert.throws(() => db.exec("UPDATE clients SET birthday = '14/10' WHERE id = 1"), /CHECK/);
  db.exec("INSERT INTO client_tags (client_id, tag, tag_key) VALUES (1, 'VIP', 'vip')");
  assert.throws(() => db.exec("INSERT INTO client_tags (client_id, tag, tag_key) VALUES (1, 'Vip', 'vip')"), /UNIQUE/);
  assert.throws(() => db.exec(`INSERT INTO client_tags (client_id, tag, tag_key) VALUES (1, '${"x".repeat(31)}', 'x')`), /CHECK/);
  db.exec("DELETE FROM clients WHERE id = 1");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM client_tags").get() as { n: number }).n, 0, "étiquettes supprimées avec la cliente");
  db.close();
});

test("migration 015 (fidélité) : registre des points avec ses déclencheurs, table des campagnes", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  for (const t of ["loyalty_entries", "campaigns"]) assert.ok(tables(db).includes(t), t);
  const triggers = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'loyalty_entries' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  assert.deepEqual(triggers, ["loyalty_entries_gardees", "loyalty_entries_immuables", "loyalty_entries_reecriture"]);
  db.close();
});

test("migration 016 (numéro de carte) : vide par défaut, unique, lettres majuscules et chiffres de 4 à 32", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.exec("INSERT INTO clients (id, name) VALUES (1, 'Aïcha'), (2, 'Brenda'), (3, 'Ngozi')");
  assert.equal((db.prepare("SELECT card FROM clients WHERE id = 1").get() as { card: string | null }).card, null);
  db.exec("UPDATE clients SET card = 'AB12CD' WHERE id = 1");
  assert.throws(() => db.exec("UPDATE clients SET card = 'AB12CD' WHERE id = 2"), /UNIQUE/);
  assert.throws(() => db.exec("UPDATE clients SET card = 'ab12' WHERE id = 2"), /CHECK/);
  assert.throws(() => db.exec("UPDATE clients SET card = 'A1' WHERE id = 2"), /CHECK/);
  db.exec("UPDATE clients SET card = NULL WHERE id = 1");
  db.exec("UPDATE clients SET card = NULL WHERE id = 3");
  db.close();
});

/** Série historique de la première installation, lue telle que la migration 018 l'écrit : jamais en clair ici (démo publique DP-12). */
const SERIE = serieHistorique();

/** Réglage `caisse.prefixe` tel qu'écrit en base, `undefined` sans ligne. */
const prefixe = (db: ReturnType<typeof openDatabase>) => (db.prepare("SELECT value FROM settings WHERE key = 'caisse.prefixe'").get() as { value: string } | undefined)?.value;

test("migration 018 (préfixe des factures) : une base en service garde sa série historique, une installation neuve n'écrit rien", () => {
  const neuve = openDatabase(":memory:");
  runMigrations(neuve);
  assert.equal(prefixe(neuve), undefined, "installation neuve : le défaut du code, jusqu'au choix de l'administrateur");
  neuve.close();
  const enService = openDatabase(":memory:");
  runMigrations(enService, MIGRATIONS.filter((m) => m.id < "018"));
  enService.exec("INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Admin', 'admin', 'admin', 'x', 0)");
  runMigrations(enService);
  // Série historique quand même : trois capitales dont l'empreinte est celle du sigle de la première installation.
  const ecrite = JSON.parse(prefixe(enService) ?? "null") as string;
  assert.match(ecrite, /^[A-Z]{3}$/, "base en service sans facture : série historique quand même");
  assert.equal(empreinte(ecrite), EMPREINTE_SIGLE);
  enService.close();
});

test("migration 018 : les factures de la série historique continuent leur suite, un avoir AV en cite une, le préfixe est figé", () => {
  const db = openDatabase(":memory:");
  runMigrations(db, MIGRATIONS.filter((m) => m.id < "018"));
  // Facture émise avant la migration, telle que l'ancien code l'écrivait (série historique figée dans le code).
  db.exec(`
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO products (id, name, brand, price, stock) VALUES (1, 'Crème hydratante', 'Maison', 10000, 5);
    INSERT INTO sequences (series, year, last) VALUES ('${SERIE}', 2026, 1);
    INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, request_id)
      VALUES ('invoice', '${SERIE}-2026-000001', '${SERIE}', 2026, 1, 0, 'fr', 1, 10000, 0, 10000, 10000, 0, '{}', 'ancienne-0001');
    INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id) VALUES (1, 'product', 1, 'Crème hydratante', '', 1, 10000, 10000, NULL);
    INSERT INTO payments (invoice_id, method, amount, reference, cash_given, change_given) VALUES (1, 'cash', 10000, '', 10000, 0);
  `);
  runMigrations(db);
  assert.equal(prefixe(db), `"${SERIE}"`);
  const storage = sqliteStorage(db);
  const now = Date.parse("2026-10-06T09:00:00Z");
  const sale = storage.transaction!((d) => issueSale(d, parseSaleRequest({ request_id: "apres-migration-1", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 10000 }] }), {
    now, lang: "fr", accountId: 1, fiscal: {}, settings: { vat: { active: false, rate: 0 }, discounts: true, discountCap: 10, tips: true, methods: ["cash"] }, approved: false, requestLang: "fr",
  }));
  assert.equal((db.prepare("SELECT number FROM invoices WHERE id = ?").get(sale.id) as { number: string }).number, `${SERIE}-2026-000002`, "même suite, aucun trou");
  const avoir = storage.transaction!((d) => issueCreditNote(d, parseCreditRequest({
    request_id: "avoir-ancienne-1", invoice_id: 1, reason: "Produit défectueux", lines: [{ line_id: 1, quantity: 1, restock: false }], refunds: [{ method: "cash", amount: 10000 }],
  }), { now: now + 60_000, accountId: 1, identity: {}, requestLang: "fr" }));
  const note = db.prepare("SELECT a.number, f.number AS credited FROM invoices a JOIN invoices f ON f.id = a.credited_invoice_id WHERE a.id = ?").get(avoir.id) as Record<string, string>;
  assert.deepEqual({ ...note }, { number: "AV-2026-000001", credited: `${SERIE}-2026-000001` });
  assert.throws(() => db.exec("UPDATE settings SET value = '\"FAC\"' WHERE key = 'caisse.prefixe'"), /Préfixe des factures figé/);
  db.close();
});
