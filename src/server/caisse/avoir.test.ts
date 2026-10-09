import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { creditTotals } from "../../shared/caisse.ts";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { creditState, issueCreditNote, parseCreditRequest, type CreditContext } from "./avoir.ts";
import { issueSale, parseSaleRequest, SaleError, type SaleSettings } from "./vente.ts";

/**
 * Avoirs (sous-projet 5 § 3.2, § 3.3, § 6.1, § 8) : numéro AV pris dans la
 * même transaction que tout le reste, même `request_id` servi une seule
 * fois, total des avoirs plafonné au total de la facture, stock rendu pour
 * les produits cochés, avoir immuable même en SQL direct.
 */

const SETTINGS: SaleSettings = { vat: { active: true, rate: 19.25 }, discounts: true, discountCap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"] };
const NOW = Date.parse("2026-09-30T15:00:00Z");
const IDENTITY = { nom: "Institut Akwa", adresse: "Bonapriso, Douala", telephone: "", niu: "M0123", rccm: "", mentions_fr: "", mentions_en: "" };

/**
 * Base de test : la facture de la maquette (soin 25 000 et crème 35 000,
 * remise fidélité de 5 %, pourboire de 2 000), total 57 000, ligne 1 le
 * soin, ligne 2 la crème ; crème en stock : 3, puis 2 après la vente.
 */
function base(t: { after: (fn: () => void) => void }) {
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
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'in_progress', '2026-09-30');
  `);
  const storage = sqliteStorage(db);
  storage.transaction!((d) => issueSale(d, parseSaleRequest({
    request_id: "vente-maquette-1", client_id: 1, appointment_id: 1,
    lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }, { kind: "product", ref_id: 1, quantity: 1 }],
    discount: { kind: "percent", value: 5, reason: "fidelite" }, tip: { amount: 2000, staff_id: 1 },
    payments: [{ method: "cash", amount: 20000, cash_given: 20000 }, { method: "orange_money", amount: 39000, reference: "OM-4471" }],
  }), { now: NOW, lang: "fr", accountId: 1, fiscal: { tva_active: true, tva_taux: 19.25, nom: "Ancien nom" }, settings: SETTINGS, approved: false, requestLang: "fr" }));
  const ctx: CreditContext = { now: NOW + 60_000, accountId: 1, identity: IDENTITY, requestLang: "fr" };
  const credit = (body: Record<string, unknown>) => storage.transaction!((d) => issueCreditNote(d, parseCreditRequest({ invoice_id: 1, reason: "Produit défectueux", ...body }), ctx));
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const stock = () => (db.prepare("SELECT stock FROM products WHERE id = 1").get() as { stock: number }).stock;
  const row = (id: number) => ({ ...(db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as Record<string, unknown>) });
  return { db, credit, count, stock, row };
}

const cream = { line_id: 2, quantity: 1, restock: true };
const facial = { line_id: 1, quantity: 1, restock: false };

test("montants d'un avoir : prix de la facture, remise au prorata arrondie une fois, dernier avoir au reste, jamais au-delà", () => {
  const invoice = { subtotal: 60000, total_ttc: 57000 };
  const vat = { active: true, rate: 19.25 };
  // Correctif final (point 7) : `credited_subtotal` est désormais obligatoire (plus de branche sans lui).
  assert.deepEqual(creditTotals({ invoice, credited: 0, credited_subtotal: 0, lines: [{ unit_price: 35000, quantity: 1 }], completes: false, vat }),
    { subtotal: 35000, discount_amount: 1750, total_ttc: 33250, total_ht: 27883, total_tva: 5367 });
  assert.deepEqual(creditTotals({ invoice, credited: 33250, credited_subtotal: 35000, lines: [{ unit_price: 25000, quantity: 1 }], completes: true, vat }),
    { subtotal: 25000, discount_amount: 1250, total_ttc: 23750, total_ht: 19916, total_tva: 3834 }, "le dernier avoir prend exactement le reste");
  assert.equal(creditTotals({ invoice: { subtotal: 1000, total_ttc: 1000 }, credited: 0, credited_subtotal: 0, lines: [{ unit_price: 1000, quantity: 1 }], completes: true, vat: { active: false, rate: 0 } }).total_tva, 0);
  assert.equal(creditTotals({ invoice: { subtotal: 3, total_ttc: 2 }, credited: 2, credited_subtotal: 3, lines: [{ unit_price: 1, quantity: 1 }], completes: false, vat }).total_ttc, 0, "jamais plus que le reste à créditer");
  assert.equal(creditTotals({ invoice: { subtotal: 0, total_ttc: 0 }, credited: 0, credited_subtotal: 0, lines: [{ unit_price: 0, quantity: 1 }], completes: true, vat }).total_ttc, 0, "facture à 0 F : avoir à 0 F");
});

test("avoir partiel puis avoir qui termine : numéros AV continus, remboursements négatifs, stock rendu, facture entièrement reprise", (t) => {
  const { db, credit, stock, row } = base(t);
  assert.equal(stock(), 2, "crème vendue");
  const first = credit({ request_id: "avoir-creme-1", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] });
  const av1 = row(first.id);
  assert.deepEqual([av1.kind, av1.number, av1.series, av1.credited_invoice_id, av1.reason, av1.subtotal, av1.discount_amount, av1.total_ttc, av1.total_ht, av1.total_tva],
    ["credit_note", "AV-2026-000001", "AV", 1, "Produit défectueux", 35000, 1750, 33250, 27883, 5367]);
  assert.deepEqual([av1.discount_kind, av1.discount_value, av1.discount_reason, av1.client_id, av1.appointment_id, av1.lang], ["percent", 5, "fidelite", 1, 1, "fr"]);
  const fiscal = JSON.parse(String(av1.fiscal));
  assert.deepEqual([fiscal.tva_active, fiscal.tva_taux, fiscal.nom, fiscal.niu], [true, 19.25, "Institut Akwa", "M0123"], "TVA de la facture corrigée, identité du jour");
  assert.deepEqual(db.prepare("SELECT kind, ref_id, quantity, unit_price, line_total, credited_line_id, restock FROM invoice_lines WHERE invoice_id = ?").all(first.id).map((r) => ({ ...r })),
    [{ kind: "product", ref_id: 1, quantity: 1, unit_price: 35000, line_total: 35000, credited_line_id: 2, restock: 1 }]);
  assert.deepEqual(db.prepare("SELECT method, amount, cash_given, change_given FROM payments WHERE invoice_id = ?").all(first.id).map((r) => ({ ...r })),
    [{ method: "cash", amount: -33250, cash_given: null, change_given: 0 }]);
  assert.equal(stock(), 3, "crème remise en stock");
  assert.deepEqual({ ...(db.prepare("SELECT credited_total, cancelled FROM invoice_balance WHERE invoice_id = 1").get() as object) }, { credited_total: 33250, cancelled: 0 });

  const second = credit({ request_id: "avoir-soin-1", lines: [facial], refunds: [{ method: "orange_money", amount: 23750, reference: "OM-R-1" }] });
  assert.deepEqual([row(second.id).number, row(second.id).total_ttc], ["AV-2026-000002", 23750]);
  assert.deepEqual({ ...(db.prepare("SELECT credited_total, cancelled FROM invoice_balance WHERE invoice_id = 1").get() as object) }, { credited_total: 57000, cancelled: 1 }, "somme des avoirs = total de la facture");
  assert.equal(stock(), 3, "le soin ne touche pas au stock");
  assert.throws(() => credit({ request_id: "avoir-trop-1", lines: [cream], refunds: [] }),
    (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "avoir.deja_annulee");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tips").get() as { n: number }).n, 1, "le pourboire n'est jamais repris");
});

test("numérotation des avoirs sans trou : une panne au milieu n'use aucun numéro, ne rend aucun stock, n'écrit rien", (t) => {
  const { db, credit, count, stock } = base(t);
  db.exec("CREATE TEMP TRIGGER panne BEFORE INSERT ON payments WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'panne simulée'); END");
  assert.throws(() => credit({ request_id: "avoir-panne-1", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] }), /panne simulée/);
  assert.deepEqual(db.prepare("SELECT series, last FROM sequences ORDER BY series").all().map((r) => ({ ...r })), [{ series: "FAC", last: 1 }], "aucune suite AV entamée");
  assert.deepEqual([count("invoices"), count("invoice_lines"), count("payments")], [1, 2, 2], "rien d'écrit");
  assert.equal(stock(), 2, "stock non rendu");
  db.exec("DROP TRIGGER panne");
  assert.equal((db.prepare("SELECT number FROM invoices WHERE id = ?").get(credit({ request_id: "avoir-panne-1", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] }).id) as { number: string }).number, "AV-2026-000001");
});

test("même request_id envoyé deux fois : un seul avoir, le même rendu, stock rendu une fois", (t) => {
  const { credit, count, stock } = base(t);
  const body = { request_id: "avoir-double-1", lines: [cream], refunds: [{ method: "card", amount: 33250 }] };
  const first = credit(body);
  const again = credit(body);
  assert.deepEqual([first.replay, again.replay, again.id], [false, true, first.id]);
  assert.equal(count("invoices"), 2);
  assert.equal(stock(), 3);
  assert.throws(() => credit({ ...body, request_id: "vente-maquette-1" }), (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "vente.requete", "identifiant déjà pris par une vente");
});

test("refus : quantité au-delà du reste, prestation remise en stock, remboursement inexact, référence manquante, avoir d'un avoir, motif vide", (t) => {
  const { credit, count, stock } = base(t);
  const refused = (body: Record<string, unknown>, key: string) =>
    assert.throws(() => credit(body), (e: unknown) => e instanceof SaleError && e.key === key, key);
  refused({ request_id: "refus-qte-01", lines: [{ ...cream, quantity: 2 }], refunds: [{ method: "cash", amount: 66500 }] }, "avoir.quantite");
  refused({ request_id: "refus-stock-1", lines: [{ ...facial, restock: true }], refunds: [{ method: "cash", amount: 23750 }] }, "avoir.restock_prestation");
  refused({ request_id: "refus-somme-1", lines: [cream], refunds: [{ method: "cash", amount: 35000 }] }, "avoir.remboursement");
  refused({ request_id: "refus-ref-01", lines: [cream], refunds: [{ method: "momo", amount: 33250 }] }, "vente.reference_obligatoire");
  refused({ request_id: "refus-ligne-1", lines: [{ line_id: 99, quantity: 1, restock: false }], refunds: [] }, "avoir.ligne_invalide");
  assert.throws(() => parseCreditRequest({ request_id: "refus-motif-1", invoice_id: 1, reason: "  ", lines: [cream], refunds: [] }), (e: unknown) => e instanceof SaleError && e.key === "avoir.motif");
  assert.throws(() => parseCreditRequest({ request_id: "refus-vide-01", invoice_id: 1, reason: "x", lines: [], refunds: [] }), (e: unknown) => e instanceof SaleError && e.key === "avoir.lignes");
  assert.throws(() => parseCreditRequest({ request_id: "refus-dbl-001", invoice_id: 1, reason: "x", lines: [cream, cream], refunds: [] }), (e: unknown) => e instanceof SaleError && e.key === "avoir.ligne_invalide");
  assert.deepEqual([count("invoices"), stock()], [1, 2], "aucun refus n'écrit rien");
  const ok = credit({ request_id: "avoir-ok-0001", lines: [cream], refunds: [{ method: "cash", amount: 20000 }, { method: "card", amount: 13250 }] });
  assert.throws(() => credit({ request_id: "avoir-avoir-1", invoice_id: ok.id, lines: [{ line_id: 3, quantity: 1, restock: false }], refunds: [] }),
    (e: unknown) => e instanceof SaleError && e.key === "avoir.sur_avoir");
});

test("état d'une facture pour l'avoir : quantités déjà reprises et reste", (t) => {
  const { db, credit } = base(t);
  credit({ request_id: "avoir-etat-01", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] });
  const state = creditState(db, 1)!;
  assert.deepEqual(state.lines.map((l) => [l.id, l.kind, l.quantity, l.credited]), [[1, "service", 1, 0], [2, "product", 1, 1]]);
  assert.equal(state.credited_total, 33250);
  assert.equal(creditState(db, 99), null);
});

test("avoir immuable même en SQL direct ; plafonds et signes tenus par la base, même sans l'application", (t) => {
  const { db, credit } = base(t);
  const av = credit({ request_id: "avoir-sql-001", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] });
  assert.throws(() => db.prepare("UPDATE invoices SET reason = 'autre' WHERE id = ?").run(av.id), /Une facture ne se modifie pas/);
  assert.throws(() => db.prepare("DELETE FROM invoices WHERE id = ?").run(av.id), /Une facture ne se supprime pas/);
  assert.throws(() => db.exec("UPDATE invoice_lines SET restock = 0 WHERE credited_line_id IS NOT NULL"), /Une ligne de facture ne se modifie pas/);
  assert.throws(() => db.exec("DELETE FROM payments WHERE amount < 0"), /Un versement ne se supprime pas/);
  assert.throws(() => db.prepare("INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total, credited_line_id) VALUES (?, 'product', 1, 'Crème', 1, 35000, 35000, 2)").run(av.id),
    /Quantité reprise au-delà de la ligne de la facture/);
  assert.throws(() => db.prepare("INSERT INTO payments (invoice_id, method, amount) VALUES (?, 'cash', 1000)").run(av.id), /Signe du versement incohérent/);
  assert.throws(() => db.prepare("INSERT INTO payments (invoice_id, method, amount) VALUES (1, 'cash', -1000)").run(), /Signe du versement incohérent/);
  assert.throws(() => db.prepare("INSERT INTO tips (invoice_id, staff_id, amount) VALUES (?, 1, 500)").run(av.id), /Un avoir n'a pas de pourboire/);
  // Avoir écrit à la main au-delà du reste (23 750) : refusé par la base.
  db.exec("UPDATE sequences SET last = last + 1 WHERE series = 'AV'");
  assert.throws(() => db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, credited_invoice_id, reason, request_id)
     VALUES ('credit_note', 'AV-2026-000002', 'AV', 2026, 2, 0, 'fr', 1, 30000, 30000, 30000, 0, '{}', 1, 'à la main', 'avoir-main-001')`,
  ).run(), /Avoirs au-delà du total de la facture/);
  assert.throws(() => db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, credited_invoice_id, reason, request_id)
     VALUES ('credit_note', 'AV-2026-000002', 'AV', 2026, 2, 0, 'fr', 1, 1000, 1000, 1000, 0, '{}', 1, '', 'avoir-main-002')`,
  ).run(), /Nature du document incohérente/, "un avoir sans motif");
  // Correctif 1 : un avoir à montant négatif, ou à remise négative, est refusé même écrit à la main
  // (la suite 'AV' est toujours à 2 : les deux tentatives précédentes ont échoué, aucune n'a avancé).
  assert.throws(() => db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, credited_invoice_id, reason, request_id)
     VALUES ('credit_note', 'AV-2026-000002', 'AV', 2026, 2, 0, 'fr', 1, 1000, 1100, -100, -100, 0, '{}', 1, 'négatif', 'avoir-neg-001')`,
  ).run(), /Nature du document incohérente/, "total_ttc négatif");
  assert.throws(() => db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, credited_invoice_id, reason, request_id)
     VALUES ('credit_note', 'AV-2026-000002', 'AV', 2026, 2, 0, 'fr', 1, 900, -100, 1000, 1000, 0, '{}', 1, 'remise négative', 'avoir-neg-002')`,
  ).run(), /Nature du document incohérente/, "discount_amount négatif");
});

test("rejeu d'un request_id d'avoir sur une autre facture : refusé, jamais rendu comme si c'était un rejeu", (t) => {
  const { db, credit } = base(t);
  db.exec("UPDATE sequences SET last = last + 1 WHERE series = 'FAC'");
  db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, appointment_id, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, request_id)
     VALUES ('invoice', 'FAC-2026-000002', 'FAC', 2026, 2, ?, 'fr', 1, NULL, 1, 1000, 1000, 1000, 0, '{}', 'vente-autre-1')`,
  ).run(NOW);
  credit({ request_id: "avoir-partage-1", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] });
  assert.throws(() => credit({ request_id: "avoir-partage-1", invoice_id: 2, lines: [{ line_id: 3, quantity: 1, restock: false }], refunds: [] }),
    (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "vente.requete", "même request_id, facture différente : jamais un rejeu");
});

test("produit supprimé après la vente : remise en stock refusée, rien n'est écrit", (t) => {
  const { db, credit, count } = base(t);
  db.exec("DELETE FROM products WHERE id = 1");
  assert.throws(() => credit({ request_id: "avoir-suppr-01", lines: [cream], refunds: [{ method: "cash", amount: 33250 }] }),
    (e: unknown) => e instanceof SaleError && e.key === "avoir.produit_supprime");
  assert.equal(count("invoices"), 1, "rien d'écrit malgré le produit supprimé");
});
