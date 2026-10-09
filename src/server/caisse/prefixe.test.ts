import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { DEFAULT_INVOICE_PREFIX, isInvoicePrefix, normalizeInvoicePrefix, SERIES } from "../../shared/caisse.ts";
import { issueCreditNote, parseCreditRequest } from "./avoir.ts";
import { issueDeposit, parseDepositRequest } from "./acompte.ts";
import { invoicePrefix, invoicePrefixForIssue } from "./prefixe.ts";
import { issueSale, parseSaleRequest, type SaleSettings } from "./vente.ts";

/**
 * Préfixe des factures réglable (distribution D-01) : lu dans la transaction
 * d'émission, avoirs (AV) et reçus d'acompte (AC) inchangés, une suite par
 * série dans `sequences`, et la base qui refuse, même en SQL direct, tout
 * changement du réglage dès la première facture.
 */

const SETTINGS: SaleSettings = { vat: { active: true, rate: 19.25 }, discounts: true, discountCap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"] };
const NOW = Date.parse("2026-10-01T09:00:00Z");

/** Base neuve : un soin réservé avec Solange pour Aïcha, une crème en stock ; préfixe écrit seulement si `prefix` est donné. */
function base(t: { after: (fn: () => void) => void }, prefix?: string) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  t.after(() => db.close());
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Soin du visage éclat', 'Radiance facial', 60, 25000);
    INSERT INTO products (id, name, brand, price, stock) VALUES (1, 'Crème hydratante', 'Maison', 35000, 3);
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'booked', '2026-10-01');
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 25000, 60);
  `);
  if (prefix) db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.prefixe', ?, 0, 0)").run(JSON.stringify(prefix));
  const storage = sqliteStorage(db);
  const sell = (body: Record<string, unknown>) => storage.transaction!((d) => issueSale(d, parseSaleRequest(body),
    { now: NOW + 3_600_000, lang: "fr", accountId: 1, fiscal: { tva_active: true, tva_taux: 19.25 }, settings: SETTINGS, approved: false, requestLang: "fr" }));
  const cream = (requestId: string) => sell({ request_id: requestId, lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] });
  const number = (id: number) => (db.prepare("SELECT number FROM invoices WHERE id = ?").get(id) as { number: string }).number;
  const sequences = () => db.prepare("SELECT series, year, last FROM sequences ORDER BY series").all().map((r) => ({ ...r }));
  return { db, storage, sell, cream, number, sequences };
}

/** Facture insérée à la main avec sa suite (SQL direct), pour éprouver les déclencheurs. */
function rawInvoice(db: DatabaseSync, series: string, requestId: string) {
  db.prepare("INSERT INTO sequences (series, year, last) VALUES (?, 2026, 1) ON CONFLICT(series, year) DO UPDATE SET last = last + 1").run(series);
  const seq = (db.prepare("SELECT last FROM sequences WHERE series = ? AND year = 2026").get(series) as { last: number }).last;
  db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, request_id)
     VALUES ('invoice', ?, ?, 2026, ?, 0, 'fr', 1, 10000, 0, 10000, 10000, 0, '{}', ?)`,
  ).run(`${series}-2026-${String(seq).padStart(6, "0")}`, series, seq, requestId);
}

test("préfixe saisi : majuscules, 2 à 6 lettres A à Z ou chiffres, jamais AV ni AC ; défaut d'une installation neuve FAC", () => {
  assert.equal(normalizeInvoicePrefix("  xyz "), "XYZ");
  for (const ok of ["FAC", "XY", "DEMO", "BA2026", "A1", "2A"]) assert.equal(isInvoicePrefix(ok), true, ok);
  for (const ko of ["", "X", "ABCDEFG", "xyz", "AB-C", "É1", "A B", "AV", "AC", "12", "2026", 12, null]) assert.equal(isInvoicePrefix(ko), false, String(ko));
  assert.equal(DEFAULT_INVOICE_PREFIX, "FAC");
  assert.equal(isInvoicePrefix(DEFAULT_INVOICE_PREFIX), true);
  assert.deepEqual({ ...SERIES }, { credit_note: "AV", deposit: "AC" });
});

test("installation neuve sans réglage : factures FAC-2026-000001, puis 000002", (t) => {
  const { db, cream, number, sequences } = base(t);
  assert.equal(invoicePrefix(db), "FAC");
  assert.equal(number(cream("vente-fac-1").id), "FAC-2026-000001");
  assert.equal(number(cream("vente-fac-2").id), "FAC-2026-000002");
  assert.deepEqual(sequences(), [{ series: "FAC", year: 2026, last: 2 }]);
});

test("préfixe XYZ : factures XYZ-2026-000001 et suivantes ; acompte AC et avoir AV inchangés, une suite continue par série", (t) => {
  const { db, storage, sell, cream, number, sequences } = base(t, "XYZ");
  storage.transaction!((d) => issueDeposit(d, parseDepositRequest({ request_id: "acompte-xyz-01", appointment_id: 1, amount: 10000, payments: [{ method: "cash", amount: 10000 }] }),
    { now: NOW, accountId: 1, lang: "fr", fiscal: {}, methods: SETTINGS.methods }));
  db.exec("UPDATE appointments SET status = 'in_progress' WHERE id = 1");
  const soin = sell({ request_id: "vente-xyz-1", client_id: 1, appointment_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], payments: [{ method: "card", amount: 15000 }] });
  const creme = cream("vente-xyz-2");
  assert.deepEqual([number(soin.id), number(creme.id)], ["XYZ-2026-000001", "XYZ-2026-000002"]);
  assert.equal((db.prepare("SELECT number FROM deposits WHERE id = 1").get() as { number: string }).number, "AC-2026-000001");
  const line = (db.prepare("SELECT id FROM invoice_lines WHERE invoice_id = ?").get(creme.id) as { id: number }).id;
  const avoir = storage.transaction!((d) => issueCreditNote(d, parseCreditRequest({
    request_id: "avoir-xyz-1", invoice_id: creme.id, reason: "Produit défectueux", lines: [{ line_id: line, quantity: 1, restock: true }], refunds: [{ method: "cash", amount: 35000 }],
  }), { now: NOW + 7_200_000, accountId: 1, identity: {}, requestLang: "fr" }));
  const note = db.prepare("SELECT a.number, a.series, f.number AS credited FROM invoices a JOIN invoices f ON f.id = a.credited_invoice_id WHERE a.id = ?").get(avoir.id) as Record<string, string>;
  assert.deepEqual({ ...note }, { number: "AV-2026-000001", series: "AV", credited: "XYZ-2026-000002" }, "l'avoir garde sa série et cite la facture XYZ");
  assert.deepEqual(sequences(), [{ series: "AC", year: 2026, last: 1 }, { series: "AV", year: 2026, last: 1 }, { series: "XYZ", year: 2026, last: 2 }]);
});

test("en SQL direct : préfixe figé dès la première facture (changé, effacé, renommé), même valeur acceptée", (t) => {
  const { db, cream } = base(t, "XYZ");
  db.exec("UPDATE settings SET value = '\"ABC\"' WHERE key = 'caisse.prefixe'");
  db.exec("UPDATE settings SET value = '\"XYZ\"' WHERE key = 'caisse.prefixe'");
  cream("vente-fige-1");
  assert.throws(() => db.exec("UPDATE settings SET value = '\"ABC\"' WHERE key = 'caisse.prefixe'"), /Préfixe des factures figé/);
  assert.throws(() => db.exec("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.prefixe', '\"ABC\"', 0, 0) ON CONFLICT(key) DO UPDATE SET value = excluded.value"), /Préfixe des factures figé/);
  assert.throws(() => db.exec("DELETE FROM settings WHERE key = 'caisse.prefixe'"), /Préfixe des factures figé/);
  assert.throws(() => db.exec("UPDATE settings SET key = 'caisse.ancien_prefixe' WHERE key = 'caisse.prefixe'"), /Préfixe des factures figé/);
  db.exec("UPDATE settings SET value = '\"XYZ\"', updated_at = 1 WHERE key = 'caisse.prefixe'");
  assert.equal(invoicePrefix(db), "XYZ");
});

test("en SQL direct : une facture FAC émise sans réglage écrit (insérée à la main) fige aussi le préfixe", (t) => {
  const { db } = base(t);
  rawInvoice(db, "FAC", "brut-defaut-1");
  assert.throws(() => db.exec("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.prefixe', '\"ABC\"', 0, 0)"), /Préfixe des factures figé/);
  db.exec("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.prefixe', '\"FAC\"', 0, 0)");
  assert.equal(invoicePrefix(db), "FAC");
});

test("en SQL direct : une facture hors de la série réglée, hors format, en AV ou AC, ou d'une autre série que les factures déjà émises est refusée", (t) => {
  const { db } = base(t, "XYZ");
  for (const series of ["FAC", "AV", "AC", "xyz", "X", "ABCDEFG", "AB-C"]) {
    assert.throws(() => rawInvoice(db, series, `brut-${series}`), /Nature du document incohérente/, series);
  }
  rawInvoice(db, "XYZ", "brut-xyz-1");
  const other = base(t);
  rawInvoice(other.db, "FAC", "brut-fac-1");
  assert.throws(() => rawInvoice(other.db, "ABC", "brut-abc-1"), /Nature du document incohérente/, "deux séries de factures dans une même base");
});

test("première vente d'une base neuve : la ligne caisse.prefixe est écrite avec FAC, puis figée ; la ligne lue prime sur la constante", (t) => {
  const { db, cream, number } = base(t);
  const ligne = () => db.prepare("SELECT value FROM settings WHERE key = 'caisse.prefixe'").all().map((r) => JSON.parse((r as { value: string }).value));
  assert.deepEqual(ligne(), []);
  assert.equal(number(cream("vente-ligne-1").id), "FAC-2026-000001");
  assert.deepEqual(ligne(), ["FAC"]);
  assert.throws(() => db.prepare("UPDATE settings SET value = '\"ZZZ\"' WHERE key = 'caisse.prefixe'").run(), /figé/);
  assert.equal(number(cream("vente-ligne-2").id), "FAC-2026-000002");
  assert.deepEqual(ligne(), ["FAC"]);
  // La ligne est lue d'abord : un préfixe déjà écrit est rendu tel quel, sans écriture, quel que soit le défaut du code.
  const autre = base(t, "XYZ");
  assert.equal(invoicePrefixForIssue(autre.db, NOW), "XYZ");
  assert.equal(autre.db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'caisse.prefixe'").get()?.n, 1);
});

test("série à chiffres seuls refusée par la base (une lettre au moins), même sans réglage ni facture ; A1 passe", (t) => {
  const { db } = base(t);
  assert.throws(() => rawInvoice(db, "2026", "chiffres-1"), /Nature du document incohérente/);
  rawInvoice(db, "A1", "lettre-1");
  assert.equal((db.prepare("SELECT series FROM invoices").get() as { series: string }).series, "A1");
});
