import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { issueSale, parseSaleRequest, SaleError, type IssueContext, type SaleSettings } from "../caisse/vente.ts";
import type { StorageBinding } from "../storage.ts";
import { issueCreditNote, parseCreditRequest } from "../caisse/avoir.ts";
import { documentLoyalty, loyaltyBalance, loyaltyEntries, loyaltySummary, recordCorrection } from "./fidelite.ts";

/**
 * Registre de la fidélité (mini CRM § 2, décisions 12 à 19) : écritures
 * signées jamais modifiées, solde, synthèse de la fiche ; écritures d'une
 * vente et d'un avoir dans la transaction du document ; solde figé du ticket.
 */

const NOW = Date.parse("2026-10-04T09:00:00Z");
const TIERS = [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }];

/** Base de l'essai : une praticienne, deux clientes, un soin à 25 000 F, un vernis à 3 000 F, une crème à 35 000 F, un compte. */
function base(t: { after: (fn: () => void) => void }) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  t.after(() => db.close());
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida'), (2, 'Brenda Ewane');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Soin du visage éclat', 'Radiance facial', 60, 25000), (2, 'Pose de vernis', 'Nail polish', 20, 3000);
    INSERT INTO products (id, name, brand, price, stock) VALUES (1, 'Crème hydratante', 'Maison', 35000, 5);
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Ngozi', 'ngozi', 'reception', 'x', 0);
  `);
  return { db, storage: sqliteStorage(db) };
}

const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

test("migration 015 : écritures signées jamais modifiées ni supprimées, cascade d'une cliente sans facture, table des campagnes", (t) => {
  const { db } = base(t);
  recordCorrection(db, { clientId: 1, points: 50, note: "Carte papier", accountId: 1, now: NOW });
  assert.throws(() => db.exec("UPDATE loyalty_entries SET points = 500"), /ne se modifie pas/);
  assert.throws(() => db.exec("DELETE FROM loyalty_entries"), /ne se supprime pas/);
  assert.throws(() => db.exec("INSERT OR REPLACE INTO loyalty_entries (id, client_id, kind, points, created_at) VALUES (1, 1, 'correction', 5, 0)"), /ne se modifie pas/);
  assert.throws(() => db.exec("INSERT INTO loyalty_entries (client_id, kind, points, created_at) VALUES (1, 'correction', 0, 0)"), /CHECK/, "jamais zéro point");
  assert.throws(() => db.exec("INSERT INTO loyalty_entries (client_id, kind, points, created_at) VALUES (1, 'bonus', 5, 0)"), /CHECK/, "nature inconnue");
  assert.throws(() => db.exec("INSERT INTO loyalty_entries (client_id, kind, points, created_at) VALUES (1, 'gain', 5, 0)"), /CHECK/, "un gain cite sa facture");
  // Cliente sans facture supprimée : ses écritures partent avec elle (cascade), seule suppression permise.
  recordCorrection(db, { clientId: 2, points: 10, note: "Geste", accountId: 1, now: NOW });
  db.exec("DELETE FROM clients WHERE id = 2");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM loyalty_entries WHERE client_id = 2"), 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM loyalty_entries WHERE client_id = 1"), 1);
  db.exec("INSERT INTO campaigns (tag, text_fr, recipients, excluded, created_at) VALUES ('VIP', 'Bonjour {prenom}', 3, 1, 0)");
  assert.deepEqual({ ...db.prepare("SELECT tag, text_en, account_id FROM campaigns").get() }, { tag: "VIP", text_en: "", account_id: null });
});

test("solde = somme des écritures ; vingt dernières écritures, la plus récente d'abord ; prochain palier", (t) => {
  const { db } = base(t);
  assert.equal(loyaltyBalance(db, 1), 0);
  recordCorrection(db, { clientId: 1, points: 80, note: "Carte papier", accountId: 1, now: NOW });
  recordCorrection(db, { clientId: 1, points: -10, note: "Erreur de saisie", accountId: 1, now: NOW + 1000 });
  assert.equal(loyaltyBalance(db, 1), 70);
  assert.deepEqual(loyaltySummary(db, 1, TIERS), { balance: 70, next_tier: { points: 100, montant: 5000, missing: 30 } });
  recordCorrection(db, { clientId: 1, points: 200, note: "Rattrapage", accountId: 1, now: NOW + 2000 });
  assert.deepEqual(loyaltySummary(db, 1, TIERS), { balance: 270, next_tier: null });
  assert.deepEqual(
    loyaltyEntries(db, 1).map((e) => [e.kind, e.points, e.note, e.invoice_number, e.account_name, e.created_at]),
    [["correction", 200, "Rattrapage", null, "Ngozi", NOW + 2000], ["correction", -10, "Erreur de saisie", null, "Ngozi", NOW + 1000], ["correction", 80, "Carte papier", null, "Ngozi", NOW]],
  );
  for (let i = 0; i < 25; i++) recordCorrection(db, { clientId: 1, points: 1, note: `Essai ${i}`, accountId: 1, now: NOW });
  assert.equal(loyaltyEntries(db, 1).length, 20);
  assert.equal(loyaltyBalance(db, 2), 0, "chaque cliente son solde");
});

const ON: SaleSettings = {
  vat: { active: true, rate: 19.25 }, discounts: true, discountCap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"],
  loyalty: { active: true, rule: { tranche: 1000, points: 1 }, tiers: TIERS },
};
const OFF: SaleSettings = { ...ON, loyalty: { ...ON.loyalty!, active: false } };

/** Émet une vente dans une transaction, avec les réglages donnés. */
function seller(storage: StorageBinding, settings: SaleSettings = ON) {
  const ctx = (over: Partial<IssueContext> = {}): IssueContext => ({ now: NOW, lang: "fr", accountId: 1, fiscal: { tva_active: true, tva_taux: 19.25 }, settings, approved: false, requestLang: "fr", ...over });
  return (body: Record<string, unknown>, over: Partial<IssueContext> = {}) => storage.transaction!((d) => issueSale(d, parseSaleRequest(body), ctx(over)));
}

/** Soin du visage de la cliente 1, payé par carte. */
const facial = (request_id: string, extra: Record<string, unknown> = {}) => ({
  request_id, client_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], payments: [{ method: "card", amount: 25000 }], ...extra,
});

/** Écritures d'un document, dans l'ordre. */
const entriesOf = (db: DatabaseSync, invoiceId: number) =>
  db.prepare("SELECT kind, points FROM loyalty_entries WHERE invoice_id = ? ORDER BY id").all(invoiceId).map((r) => ({ ...r }));

/** Refus attendu : statut et clé du message. */
function refusal(fn: () => unknown): [number, string] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SaleError, String(error));
    return [error.status, error.key];
  }
  assert.fail("refus attendu");
}

test("gain : points de la règle sur le total TTC après remise, pourboire exclu ; rien sans cliente, rien fidélité inactive, rien au rejeu", (t) => {
  const { db, storage } = base(t);
  const sell = seller(storage);
  const tipped = { tip: { amount: 2000, staff_id: 1 }, payments: [{ method: "card", amount: 27000 }] };
  const first = sell(facial("fid-gain-0001", tipped));
  assert.deepEqual(entriesOf(db, first.id), [{ kind: "gain", points: 25 }]);
  // Remise saisie de 10 % : 22 500 F, 22 points (tranche inférieure).
  const second = sell(facial("fid-gain-0002", { discount: { kind: "percent", value: 10, reason: "geste" }, payments: [{ method: "card", amount: 22500 }] }));
  assert.deepEqual(entriesOf(db, second.id), [{ kind: "gain", points: 22 }]);
  const counter = sell({ request_id: "fid-gain-0003", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] });
  assert.deepEqual(entriesOf(db, counter.id), [], "vente sans cliente");
  const off = seller(storage, OFF)(facial("fid-gain-0004"));
  assert.deepEqual(entriesOf(db, off.id), [], "fidélité inactive");
  assert.equal(loyaltyBalance(db, 1), 47);
  assert.equal(sell(facial("fid-gain-0001", tipped)).replay, true);
  assert.equal(loyaltyBalance(db, 1), 47, "vente rejouée : aucune écriture de plus");
});

test("récompense : remise fixe du palier, motif fidélité, ni interrupteur ni plafond ; écritures récompense puis gain", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 120, note: "Carte papier", accountId: 1, now: NOW });
  // Remises désactivées, plafond de 10 % dépassé (5 000 F sur 25 000 F) : la récompense passe sans approbation.
  const sale = seller(storage, { ...ON, discounts: false })(facial("fid-rec-0001", { discount: { reward_points: 100 }, payments: [{ method: "card", amount: 20000 }] }));
  const row = db.prepare("SELECT subtotal, discount_amount, discount_kind, discount_value, discount_reason, total_ttc FROM invoices WHERE id = ?").get(sale.id);
  assert.deepEqual({ ...row }, { subtotal: 25000, discount_amount: 5000, discount_kind: "amount", discount_value: 5000, discount_reason: "fidelite", total_ttc: 20000 });
  assert.deepEqual(entriesOf(db, sale.id), [{ kind: "recompense", points: -100 }, { kind: "gain", points: 20 }]);
  assert.equal(loyaltyBalance(db, 1), 40);
});

test("récompense plus grande que le sous-total : remise ramenée au sous-total, points du palier tout de même dépensés", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 100, note: "Carte papier", accountId: 1, now: NOW });
  const sale = seller(storage)({ request_id: "fid-plaf-0001", client_id: 1, lines: [{ kind: "service", ref_id: 2, quantity: 1, staff_id: 1 }], discount: { reward_points: 100 }, payments: [] });
  assert.deepEqual({ ...db.prepare("SELECT subtotal, discount_amount, total_ttc FROM invoices WHERE id = ?").get(sale.id) }, { subtotal: 3000, discount_amount: 3000, total_ttc: 0 });
  assert.deepEqual(entriesOf(db, sale.id), [{ kind: "recompense", points: -100 }], "facture à 0 F : aucun gain");
  assert.equal(loyaltyBalance(db, 1), 0);
});

test("récompense refusée : fidélité inactive, sans cliente, palier inconnu, solde insuffisant, palier illisible ; rien n'est écrit", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 90, note: "Carte papier", accountId: 1, now: NOW });
  const reward = (id: string, points: number) => facial(id, { discount: { reward_points: points }, payments: [{ method: "card", amount: 20000 }] });
  assert.deepEqual(refusal(() => seller(storage, OFF)(reward("fid-ref-0001", 100))), [400, "fidelite.inactive"]);
  assert.deepEqual(refusal(() => seller(storage)({ request_id: "fid-ref-0002", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], discount: { reward_points: 100 }, payments: [{ method: "cash", amount: 30000 }] })), [400, "fidelite.cliente"]);
  assert.deepEqual(refusal(() => seller(storage)(reward("fid-ref-0003", 150))), [400, "fidelite.palier"]);
  assert.deepEqual(refusal(() => seller(storage)(reward("fid-ref-0004", 100))), [409, "fidelite.solde"]);
  assert.deepEqual(refusal(() => parseSaleRequest(reward("fid-ref-0005", 0))), [400, "vente.remise_invalide"]);
  assert.deepEqual(refusal(() => parseSaleRequest(reward("fid-ref-0006", 100001))), [400, "vente.remise_invalide"]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM invoices"), 0);
  assert.equal(loyaltyBalance(db, 1), 90);
  assert.equal(parseSaleRequest(reward("fid-ref-0007", 100)).reward_points, 100);
  assert.equal(parseSaleRequest(reward("fid-ref-0008", 100)).discount, null, "la remise est fixée par le serveur");
});

/** Émet un avoir dans une transaction. */
const credit = (storage: StorageBinding, body: Record<string, unknown>) =>
  storage.transaction!((d) => issueCreditNote(d, parseCreditRequest(body), { now: NOW + 60_000, accountId: 1, identity: {}, requestLang: "fr" }));

/** Identifiants des lignes d'une facture, dans l'ordre. */
const lineIds = (db: DatabaseSync, invoiceId: number) =>
  (db.prepare("SELECT id FROM invoice_lines WHERE invoice_id = ? ORDER BY id").all(invoiceId) as { id: number }[]).map((r) => r.id);

/** Soin et crème (60 000 F) de la cliente 1, récompense de 100 points : total 55 000 F, 55 points gagnés. */
function rewardedSale(storage: StorageBinding, id: string) {
  return seller(storage)({
    request_id: id, client_id: 1,
    lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }, { kind: "product", ref_id: 1, quantity: 1 }],
    discount: { reward_points: 100 }, payments: [{ method: "card", amount: 55000 }],
  });
}

test("avoir partiel : reprise au prorata, au point supérieur, récompense gardée ; avoir qui annule : le reste repris, récompense rendue", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 100, note: "Carte papier", accountId: 1, now: NOW });
  const sale = rewardedSale(storage, "fid-avoir-0001");
  assert.deepEqual(entriesOf(db, sale.id), [{ kind: "recompense", points: -100 }, { kind: "gain", points: 55 }]);
  assert.equal(loyaltyBalance(db, 1), 55);
  const [soin, creme] = lineIds(db, sale.id);
  // Crème reprise : 32 083 F sur 55 000 F ; 55 × 32 083 ÷ 55 000 = 32,08 : 33 points.
  const partial = credit(storage, { request_id: "fid-avoir-av01", invoice_id: sale.id, reason: "Produit défectueux", lines: [{ line_id: creme, quantity: 1 }], refunds: [{ method: "cash", amount: 32083 }] });
  assert.deepEqual(entriesOf(db, partial.id), [{ kind: "reprise", points: -33 }]);
  assert.equal(loyaltyBalance(db, 1), 22);
  // Soin repris : la facture est annulée, les 22 points restants sont repris et les 100 de la récompense rendus.
  const last = credit(storage, { request_id: "fid-avoir-av02", invoice_id: sale.id, reason: "Cliente mécontente", lines: [{ line_id: soin, quantity: 1 }], refunds: [{ method: "cash", amount: 22917 }] });
  assert.deepEqual(entriesOf(db, last.id), [{ kind: "reprise", points: -22 }, { kind: "restitution", points: 100 }]);
  assert.equal(loyaltyBalance(db, 1), 100);
  assert.equal(credit(storage, { request_id: "fid-avoir-av02", invoice_id: sale.id, reason: "Cliente mécontente", lines: [{ line_id: soin, quantity: 1 }], refunds: [{ method: "cash", amount: 22917 }] }).replay, true);
  assert.equal(loyaltyBalance(db, 1), 100, "avoir rejoué : aucune écriture de plus");
});

test("avoir : solde négatif quand les points sont déjà dépensés ; facture sans point, aucune écriture", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 75, note: "Carte papier", accountId: 1, now: NOW });
  const first = seller(storage)(facial("fid-neg-0001"));
  seller(storage)(facial("fid-neg-0002", { discount: { reward_points: 100 }, payments: [{ method: "card", amount: 20000 }] }));
  assert.equal(loyaltyBalance(db, 1), 20);
  const back = credit(storage, { request_id: "fid-neg-av01", invoice_id: first.id, reason: "Erreur de caisse", lines: [{ line_id: lineIds(db, first.id)[0], quantity: 1 }], refunds: [{ method: "card", amount: 25000 }] });
  assert.deepEqual(entriesOf(db, back.id), [{ kind: "reprise", points: -25 }]);
  assert.equal(loyaltyBalance(db, 1), -5);
  const off = seller(storage, OFF)(facial("fid-neg-0003"));
  const none = credit(storage, { request_id: "fid-neg-av02", invoice_id: off.id, reason: "Erreur de caisse", lines: [{ line_id: lineIds(db, off.id)[0], quantity: 1 }], refunds: [{ method: "card", amount: 25000 }] });
  assert.deepEqual(entriesOf(db, none.id), []);
  assert.equal(loyaltyBalance(db, 1), -5);
});

test("avoir : écritures sans lecture des réglages de fidélité (désactivation couverte par fidelite-api.test.ts), et seules les écritures recompense comptent, pas le motif de la remise", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 100, note: "Carte papier", accountId: 1, now: NOW });
  const rewarded = seller(storage)(facial("fid-off-0001", { discount: { reward_points: 100 }, payments: [{ method: "card", amount: 20000 }] }));
  // L'avoir ne lit aucun réglage : reprise et restitution s'écrivent d'après le registre seul (ajustement 3).
  const back = credit(storage, { request_id: "fid-off-av01", invoice_id: rewarded.id, reason: "Erreur de caisse", lines: [{ line_id: lineIds(db, rewarded.id)[0], quantity: 1 }], refunds: [{ method: "card", amount: 20000 }] });
  assert.deepEqual(entriesOf(db, back.id), [{ kind: "reprise", points: -20 }, { kind: "restitution", points: 100 }]);
  // Remise à la main portant le motif « fidélité » : aucune écriture recompense, rien à restituer.
  const manual = seller(storage)(facial("fid-off-0002", { discount: { kind: "percent", value: 10, reason: "fidelite" }, payments: [{ method: "card", amount: 22500 }] }));
  const none = credit(storage, { request_id: "fid-off-av02", invoice_id: manual.id, reason: "Erreur de caisse", lines: [{ line_id: lineIds(db, manual.id)[0], quantity: 1 }], refunds: [{ method: "card", amount: 22500 }] });
  assert.equal(entriesOf(db, none.id).some((e) => e.kind === "restitution"), false);
});

test("ticket : écritures du document et solde figé juste après elles, inchangé par les écritures suivantes", (t) => {
  const { db, storage } = base(t);
  recordCorrection(db, { clientId: 1, points: 100, note: "Carte papier", accountId: 1, now: NOW });
  const sale = rewardedSale(storage, "fid-doc-0001");
  const [soin, creme] = lineIds(db, sale.id);
  const partial = credit(storage, { request_id: "fid-doc-av01", invoice_id: sale.id, reason: "Produit défectueux", lines: [{ line_id: creme, quantity: 1 }], refunds: [{ method: "cash", amount: 32083 }] });
  const last = credit(storage, { request_id: "fid-doc-av02", invoice_id: sale.id, reason: "Cliente mécontente", lines: [{ line_id: soin, quantity: 1 }], refunds: [{ method: "cash", amount: 22917 }] });
  recordCorrection(db, { clientId: 1, points: 7, note: "Geste", accountId: 1, now: NOW });
  assert.deepEqual(documentLoyalty(db, sale.id), { earned: 55, reward: 100, taken: 0, restored: 0, balance: 55 });
  assert.deepEqual(documentLoyalty(db, partial.id), { earned: 0, reward: 0, taken: 33, restored: 0, balance: 22 });
  assert.deepEqual(documentLoyalty(db, last.id), { earned: 0, reward: 0, taken: 22, restored: 100, balance: 100 });
  const counter = seller(storage)({ request_id: "fid-doc-0002", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] });
  assert.equal(documentLoyalty(db, counter.id), null, "sans écriture, rien au ticket");
});