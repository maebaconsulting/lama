import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { applyDeposit, issueDeposit, parseDepositRequest, parseSettleRequest, settleDeposit, type DepositContext } from "./acompte.ts";
import { SaleError } from "./vente.ts";

/**
 * Acomptes (sous-projet 5 § 3.2, § 3.3, § 6.2, § 8) : reçu AC pris dans la
 * même transaction que ses versements, sans trou ; même `request_id` servi
 * une seule fois ; versements égaux au montant ; remboursé ou gardé seulement
 * si le rendez-vous est annulé ou la cliente absente ; reçu immuable même en
 * SQL direct, sauf le seul passage de `held` à `applied`, `refunded` ou `kept`.
 */

const NOW = Date.parse("2026-10-01T09:00:00Z");
const CTX: DepositContext = { now: NOW, accountId: 1, lang: "fr", fiscal: { tva_active: true, tva_taux: 19.25, nom: "Institut Akwa" }, methods: ["cash", "card", "orange_money", "momo"] };

/** Base de test : rendez-vous 1 réservé (soin à 25 000), rendez-vous 2 réservé (massage à 15 000), rendez-vous 3 en cours. */
function base(t: { after: (fn: () => void) => void }) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  t.after(() => db.close());
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Soin du visage éclat', 'Radiance facial', 60, 25000), (2, 'Massage', 'Massage', 60, 15000);
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES
      (1, 'APT-1', 1, 1, 'booked', '2026-10-03'), (2, 'APT-2', 1, 1, 'confirmed', '2026-10-04'), (3, 'APT-3', 1, 1, 'in_progress', '2026-10-01');
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 25000, 60), (2, 2, 15000, 60), (3, 1, 25000, 60);
  `);
  const storage = sqliteStorage(db);
  const deposit = (body: Record<string, unknown>) => storage.transaction!((d) => issueDeposit(d, parseDepositRequest({ appointment_id: 1, amount: 10000, payments: [{ method: "cash", amount: 10000 }], ...body }), CTX));
  const settle = (id: number, body: Record<string, unknown>) => storage.transaction!((d) => settleDeposit(d, parseSettleRequest(id, body), { now: NOW + 3_600_000, accountId: 1 }));
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const row = (id: number) => ({ ...(db.prepare("SELECT * FROM deposits WHERE id = ?").get(id) as Record<string, unknown>) });
  return { db, deposit, settle, count, row };
}

const refused = (fn: () => unknown, key: string, status?: number) =>
  assert.throws(fn, (e: unknown) => e instanceof SaleError && e.key === key && (status === undefined || e.status === status), key);

test("acompte encaissé : reçu AC-AAAA-NNNNNN continu, versements écrits sur l'acompte, valeurs figées", (t) => {
  const { db, deposit, row } = base(t);
  const first = deposit({ request_id: "acompte-rdv1-01", payments: [{ method: "cash", amount: 4000 }, { method: "orange_money", amount: 6000, reference: "OM-77" }] });
  const d = row(first.id);
  assert.deepEqual([d.number, d.series, d.year, d.seq, d.appointment_id, d.client_id, d.amount, d.status, d.lang, d.applied_invoice_id, d.settled_at],
    ["AC-2026-000001", "AC", 2026, 1, 1, 1, 10000, "held", "fr", null, null]);
  assert.equal(JSON.parse(String(d.fiscal)).nom, "Institut Akwa");
  assert.deepEqual(db.prepare("SELECT invoice_id, deposit_id, method, amount, reference FROM payments ORDER BY id").all().map((r) => ({ ...r })), [
    { invoice_id: null, deposit_id: 1, method: "cash", amount: 4000, reference: "" },
    { invoice_id: null, deposit_id: 1, method: "orange_money", amount: 6000, reference: "OM-77" },
  ]);
  const second = deposit({ request_id: "acompte-rdv2-01", appointment_id: 2, amount: 15000, payments: [{ method: "card", amount: 15000 }] });
  assert.equal(row(second.id).number, "AC-2026-000002");
  assert.deepEqual(db.prepare("SELECT series, last FROM sequences").all().map((r) => ({ ...r })), [{ series: "AC", last: 2 }], "la suite des factures n'est pas entamée");
});

test("numérotation des acomptes sans trou : une panne au milieu n'use aucun numéro et n'écrit rien", (t) => {
  const { db, deposit, count, row } = base(t);
  db.exec("CREATE TEMP TRIGGER panne BEFORE INSERT ON payments WHEN NEW.deposit_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'panne simulée'); END");
  assert.throws(() => deposit({ request_id: "acompte-panne-1" }), /panne simulée/);
  assert.deepEqual([count("deposits"), count("payments"), count("sequences")], [0, 0, 0], "rien d'écrit, aucune suite entamée");
  db.exec("DROP TRIGGER panne");
  assert.equal(row(deposit({ request_id: "acompte-panne-1" }).id).number, "AC-2026-000001");
});

test("même request_id envoyé deux fois : un seul acompte, le même rendu ; sur un autre rendez-vous, refusé", (t) => {
  const { deposit, count } = base(t);
  const first = deposit({ request_id: "acompte-double-1" });
  const again = deposit({ request_id: "acompte-double-1" });
  assert.deepEqual([first.replay, again.replay, again.id], [false, true, first.id]);
  assert.deepEqual([count("deposits"), count("payments")], [1, 1]);
  refused(() => deposit({ request_id: "acompte-double-1", appointment_id: 2 }), "vente.requete", 409);
});

test("refus : rendez-vous en cours, déjà un acompte en attente, au-delà des prestations prévues, versements inexacts, référence manquante, forme", (t) => {
  const { db, deposit, count } = base(t);
  refused(() => deposit({ request_id: "refus-statut-1", appointment_id: 3 }), "acompte.rdv_statut", 409);
  refused(() => deposit({ request_id: "refus-inconnu-1", appointment_id: 99 }), "vente.rdv_inconnu", 404);
  refused(() => deposit({ request_id: "refus-plafond-1", amount: 25001, payments: [{ method: "cash", amount: 25001 }] }), "acompte.plafond", 409);
  refused(() => deposit({ request_id: "refus-somme-01", payments: [{ method: "cash", amount: 9000 }] }), "acompte.versements", 409);
  refused(() => deposit({ request_id: "refus-ref-0001", payments: [{ method: "momo", amount: 10000 }] }), "vente.reference_obligatoire");
  refused(() => storage(db, { methods: ["cash"] }), "vente.moyen_refuse");
  refused(() => parseDepositRequest({ request_id: "refus-forme-1", appointment_id: 1, amount: 0, payments: [{ method: "cash", amount: 1 }] }), "acompte.montant");
  refused(() => parseDepositRequest({ request_id: "refus-forme-2", appointment_id: 1, amount: 100, payments: [] }), "vente.versement_invalide");
  assert.equal(count("deposits"), 0, "aucun refus n'écrit rien");
  deposit({ request_id: "acompte-ok-0001" });
  refused(() => deposit({ request_id: "acompte-deux-01" }), "acompte.deja", 409);
});

/** Encaissement avec d'autres moyens proposés (réglage de la gérante). */
function storage(db: DatabaseSync, patch: Partial<DepositContext>) {
  return sqliteStorage(db).transaction!((d) => issueDeposit(d, parseDepositRequest({ request_id: "refus-moyen-01", appointment_id: 1, amount: 10000, payments: [{ method: "card", amount: 10000 }] }), { ...CTX, ...patch }));
}

test("rendez-vous annulé : « Rembourser » écrit des versements négatifs, « Garder » demande un motif ; une seule fois", (t) => {
  const { db, deposit, settle, row } = base(t);
  const a = deposit({ request_id: "acompte-annule-1" });
  refused(() => settle(a.id, { request_id: "rembourse-tot-1", action: "refund", refunds: [{ method: "cash", amount: 10000 }] }), "acompte.rdv_actif", 409);
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 1");
  refused(() => settle(a.id, { request_id: "rembourse-faux-1", action: "refund", refunds: [{ method: "cash", amount: 9000 }] }), "acompte.remboursement", 409);
  const done = settle(a.id, { request_id: "rembourse-ok-01", action: "refund", refunds: [{ method: "cash", amount: 6000 }, { method: "card", amount: 4000 }] });
  assert.equal(done.replay, false);
  const d = row(a.id);
  assert.deepEqual([d.status, d.settled_at, d.settled_by, d.settle_request_id], ["refunded", NOW + 3_600_000, 1, "rembourse-ok-01"]);
  assert.deepEqual(db.prepare("SELECT method, amount FROM payments WHERE deposit_id = ? AND amount < 0 ORDER BY id").all(a.id).map((r) => ({ ...r })),
    [{ method: "cash", amount: -6000 }, { method: "card", amount: -4000 }]);
  assert.equal(settle(a.id, { request_id: "rembourse-ok-01", action: "refund", refunds: [{ method: "cash", amount: 10000 }] }).replay, true, "même envoi : rejeu");
  refused(() => settle(a.id, { request_id: "garde-apres-01", action: "keep", reason: "Annulation tardive" }), "acompte.deja_solde", 409);

  const b = deposit({ request_id: "acompte-absente-1", appointment_id: 2, amount: 5000, payments: [{ method: "cash", amount: 5000 }] });
  db.exec("UPDATE appointments SET status = 'no_show' WHERE id = 2");
  refused(() => parseSettleRequest(b.id, { request_id: "garde-vide-01", action: "keep", reason: "  " }), "acompte.motif");
  refused(() => parseSettleRequest(b.id, { request_id: "garde-autre-01", action: "annuler" }), "acompte.action");
  settle(b.id, { request_id: "garde-ok-0001", action: "keep", reason: "Absente sans prévenir" });
  assert.deepEqual([row(b.id).status, row(b.id).settle_reason], ["kept", "Absente sans prévenir"]);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM payments WHERE deposit_id = ?").get(b.id) as { n: number }).n, 1, "garder n'écrit aucun versement");
  refused(() => settle(99, { request_id: "garde-inconnu-1", action: "keep", reason: "x" }), "acompte.introuvable", 404);
});

test("reçu d'acompte immuable même en SQL direct, sauf le seul passage de « en attente » à son sort", (t) => {
  const { db, deposit } = base(t);
  const a = deposit({ request_id: "acompte-sql-0001" });
  assert.throws(() => db.prepare("UPDATE deposits SET amount = 5000 WHERE id = ?").run(a.id), /Un reçu d'acompte ne se modifie pas/);
  assert.throws(() => db.prepare("UPDATE deposits SET status = 'kept', settled_at = 1, settled_by = 1, settle_reason = 'x', settle_request_id = 'x', number = 'AC-2026-000009' WHERE id = ?").run(a.id), /Un reçu d'acompte ne se modifie pas/);
  assert.throws(() => db.prepare("DELETE FROM deposits WHERE id = ?").run(a.id), /Un reçu d'acompte ne se supprime pas/);
  assert.throws(() => db.prepare("DELETE FROM payments WHERE deposit_id = ?").run(a.id), /Un versement ne se supprime pas/);
  assert.throws(() => db.prepare("INSERT INTO payments (deposit_id, method, amount) VALUES (?, 'cash', 1)").run(a.id), /Versement d'acompte incohérent/, "au-delà du montant");
  assert.throws(() => db.prepare("INSERT INTO payments (deposit_id, method, amount) VALUES (?, 'cash', -1000)").run(a.id), /Versement d'acompte incohérent/, "remboursement d'un acompte en attente");
  assert.throws(() => db.prepare("INSERT INTO payments (deposit_id, method, amount) VALUES (99, 'cash', 1000)").run(), /Versement d'acompte incohérent/, "acompte inconnu");
  assert.throws(() => db.prepare("UPDATE deposits SET status = 'applied', applied_invoice_id = NULL, settled_at = 1, settled_by = 1, settle_request_id = 'x' WHERE id = ?").run(a.id), /CHECK|déduit/, "déduit sans facture");
  db.prepare("UPDATE deposits SET status = 'kept', settled_at = 1, settled_by = 1, settle_reason = 'Gardé à la main', settle_request_id = 'garde-main-01' WHERE id = ?").run(a.id);
  assert.throws(() => db.prepare("UPDATE deposits SET status = 'refunded', settle_reason = '' WHERE id = ?").run(a.id), /Un reçu d'acompte ne se modifie pas/, "son sort ne change plus");
  // Un second acompte en attente sur le même rendez-vous, même écrit à la main : refusé par le
  // déclencheur (correctif 1, relecture) avant même de heurter l'index.
  deposit({ request_id: "acompte-sql-0002" });
  db.exec("UPDATE sequences SET last = last + 1 WHERE series = 'AC'");
  assert.throws(() => db.prepare(
    "INSERT INTO deposits (number, series, year, seq, appointment_id, amount, issued_at, account_id, fiscal, lang, request_id) VALUES ('AC-2026-000003', 'AC', 2026, 3, 1, 100, 0, 1, '{}', 'fr', 'acompte-main-03')",
  ).run(), /Un reçu d'acompte ne se modifie pas/);
});

/**
 * Correctif 1 (relecture) : REPLACE ne doit jamais pouvoir effacer un reçu
 * d'acompte, même indirectement par un conflit d'unicité (numéro, acompte en
 * attente du même rendez-vous, settle_request_id) ; un acompte « en attente »
 * ne porte jamais de sort ; le rejeu d'un règlement vérifie le statut, pas
 * seulement le settle_request_id ; `applyDeposit` échoue franchement si rien
 * n'a changé.
 */

/** Facture minimale, valide pour `deposits_deduit`, insérée à la main (base fraîche : toujours la première de l'année). */
function invoice(db: DatabaseSync, appointmentId: number, requestId: string): number {
  db.exec("INSERT INTO sequences (series, year, last) VALUES ('FAC', 2026, 1)");
  const info = db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, appointment_id, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, request_id)
     VALUES ('invoice', 'FAC-2026-000001', 'FAC', 2026, 1, ?, 'fr', 1, ?, 1, 10000, 0, 10000, 10000, 0, '{}', ?)`,
  ).run(NOW, appointmentId, requestId);
  return Number(info.lastInsertRowid);
}

test("INSERT OR REPLACE sur l'acompte en attente du même rendez-vous : refusé, le reçu d'origine reste", (t) => {
  const { db, deposit, row, count } = base(t);
  const a = deposit({ request_id: "repl-held-01" });
  db.exec("UPDATE sequences SET last = last + 1 WHERE series = 'AC'");
  assert.throws(() => db.prepare(
    `INSERT OR REPLACE INTO deposits (number, series, year, seq, appointment_id, amount, issued_at, account_id, status, fiscal, lang, request_id)
     VALUES ('AC-2026-000002', 'AC', 2026, 2, 1, 5000, ?, 1, 'held', '{}', 'fr', 'repl-held-02')`,
  ).run(NOW), /Un reçu d'acompte ne se modifie pas/);
  assert.equal(row(a.id).status, "held", "le reçu d'origine reste en attente");
  assert.equal(count("deposits"), 1, "aucune ligne ajoutée ni effacée");
});

test("un acompte « en attente » ne peut pas porter un sort rempli, même pour prendre le settle_request_id d'un acompte réglé (REPLACE)", (t) => {
  const { db, deposit, settle, row, count } = base(t);
  const kept = deposit({ request_id: "garde-repl-1", appointment_id: 2, amount: 5000, payments: [{ method: "cash", amount: 5000 }] });
  db.exec("UPDATE appointments SET status = 'no_show' WHERE id = 2");
  settle(kept.id, { request_id: "garde-repl-set", action: "keep", reason: "Absente" });
  assert.equal(row(kept.id).status, "kept");
  db.exec("UPDATE sequences SET last = last + 1 WHERE series = 'AC'");

  assert.throws(() => db.prepare(
    `INSERT INTO deposits (number, series, year, seq, appointment_id, amount, issued_at, account_id, status, settle_request_id, fiscal, lang, request_id)
     VALUES ('AC-2026-000002', 'AC', 2026, 2, 1, 5000, ?, 1, 'held', 'garde-repl-set', '{}', 'fr', 'held-sort-01')`,
  ).run(NOW), /Numéro de reçu d'acompte hors de sa suite/, "sort rempli à l'insertion");
  assert.equal(count("deposits"), 1, "aucune ligne ajoutée");

  assert.throws(() => db.prepare(
    `INSERT OR REPLACE INTO deposits (number, series, year, seq, appointment_id, amount, issued_at, account_id, status, settle_request_id, fiscal, lang, request_id)
     VALUES ('AC-2026-000002', 'AC', 2026, 2, 1, 5000, ?, 1, 'held', 'garde-repl-set', '{}', 'fr', 'held-sort-02')`,
  ).run(NOW), /Numéro de reçu d'acompte hors de sa suite/, "REPLACE avec le settle_request_id d'un acompte réglé");
  assert.equal(count("deposits"), 1, "toujours aucune ligne ajoutée");
  assert.equal(row(kept.id).status, "kept", "le reçu gardé reste intact");
});

test("UPDATE OR REPLACE qui prend le settle_request_id d'un autre acompte : refusé, l'acompte visé reste intact", (t) => {
  const { db, deposit, settle, row } = base(t);
  const a = deposit({ request_id: "repl-upd-a-1" });
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 1");
  settle(a.id, { request_id: "repl-upd-req-1", action: "refund", refunds: [{ method: "cash", amount: 10000 }] });
  assert.equal(row(a.id).settle_request_id, "repl-upd-req-1");

  const c = deposit({ request_id: "repl-upd-c-1", appointment_id: 2, amount: 5000, payments: [{ method: "cash", amount: 5000 }] });

  assert.throws(() => db.prepare(
    "UPDATE OR REPLACE deposits SET status = 'kept', settled_at = ?, settled_by = 1, settle_reason = 'Vol du settle_request_id', settle_request_id = ? WHERE id = ?",
  ).run(NOW + 3_600_000, "repl-upd-req-1", c.id), /Un reçu d'acompte ne se modifie pas/);
  assert.equal(row(c.id).status, "held", "l'acompte visé n'a pas changé");
  assert.equal(row(a.id).status, "refunded", "l'acompte dont le settle_request_id est repris reste intact");
  assert.equal(row(a.id).settle_request_id, "repl-upd-req-1");
});

test("settleDeposit : un settle_request_id déjà pris par un autre acompte est refusé en 409 vente.requete, jamais l'erreur SQL brute", (t) => {
  const { db, deposit, settle } = base(t);
  const a = deposit({ request_id: "dup-req-a-1" });
  const b = deposit({ request_id: "dup-req-b-1", appointment_id: 2, amount: 5000, payments: [{ method: "cash", amount: 5000 }] });
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE id IN (1, 2)");
  settle(a.id, { request_id: "pris-dup-01", action: "refund", refunds: [{ method: "cash", amount: 10000 }] });
  refused(() => settle(b.id, { request_id: "pris-dup-01", action: "keep", reason: "Reprise d'un autre identifiant" }), "vente.requete", 409);
});

test("settleDeposit : le rejeu n'est reconnu que si le statut correspond à l'action, pas seulement le settle_request_id (acompte déduit)", (t) => {
  const { db, deposit, settle, row } = base(t);
  const a = deposit({ request_id: "deduit-rdv-1" });
  const invoiceId = invoice(db, 1, "facture-deduit-1");
  applyDeposit(db, a.id, invoiceId, { now: NOW, accountId: 1, requestId: String(invoiceId) });
  assert.equal(row(a.id).status, "applied");
  refused(() => settle(a.id, { request_id: `facture-${invoiceId}`, action: "refund", refunds: [{ method: "cash", amount: 10000 }] }), "acompte.deja_solde", 409);
});

test("applyDeposit : erreur si aucun acompte n'a été changé (identifiant inconnu)", (t) => {
  const { db } = base(t);
  const invoiceId = invoice(db, 1, "facture-inconnu-1");
  assert.throws(() => applyDeposit(db, 999, invoiceId, { now: NOW, accountId: 1, requestId: "x" }),
    (e: unknown) => e instanceof SaleError && e.key === "acompte.introuvable" && e.status === 404);
});

/**
 * V1-78 (migration 017) : `deposits_deduit` accepte aussi une facture sans
 * rendez-vous, de la même cliente, sans prestation, quand le rendez-vous de
 * l'acompte est annulé ou manqué. Tout le reste reste refusé en SQL direct.
 */

/** Facture au comptoir (sans rendez-vous) insérée à la main, avec une ligne de la sorte donnée ; numéro suivant de la suite FAC. */
function counterInvoice(db: DatabaseSync, clientId: number, requestId: string, kind: "product" | "service" = "product"): number {
  const known = db.prepare("SELECT 1 FROM sequences WHERE series = 'FAC' AND year = 2026").get();
  db.exec(known ? "UPDATE sequences SET last = last + 1 WHERE series = 'FAC' AND year = 2026" : "INSERT INTO sequences (series, year, last) VALUES ('FAC', 2026, 1)");
  const seq = (db.prepare("SELECT last FROM sequences WHERE series = 'FAC' AND year = 2026").get() as { last: number }).last;
  const info = db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, appointment_id, account_id, subtotal, discount_amount, total_ttc, total_ht, total_tva, fiscal, request_id)
     VALUES ('invoice', ?, 'FAC', 2026, ?, ?, 'fr', ?, NULL, 1, 10000, 0, 10000, 10000, 0, '{}', ?)`,
  ).run(`FAC-2026-${String(seq).padStart(6, "0")}`, seq, NOW, clientId, requestId);
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total) VALUES (?, ?, 1, 'Ligne', 1, 10000, 10000)").run(id, kind);
  return id;
}

test("acompte déduit au comptoir en SQL direct : seulement même cliente, produits seuls, rendez-vous annulé ou manqué", (t) => {
  const { db, deposit, row } = base(t);
  db.exec("INSERT INTO clients (id, name) VALUES (2, 'Fatou Diop')");
  const a = deposit({ request_id: "comptoir-sql-01" });
  const apply = (invoiceId: number, req: string) => applyDeposit(db, a.id, invoiceId, { now: NOW, accountId: 1, requestId: req });
  const refusedSql = /Acompte déduit d'une facture d'un autre rendez-vous/;

  // Rendez-vous encore actif : l'acompte reste attaché à son rendez-vous.
  assert.throws(() => apply(counterInvoice(db, 1, "comptoir-sql-f1"), "f1"), refusedSql, "rendez-vous actif");
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 1");
  assert.throws(() => apply(counterInvoice(db, 2, "comptoir-sql-f2"), "f2"), refusedSql, "facture d'une autre cliente");
  assert.throws(() => apply(counterInvoice(db, 1, "comptoir-sql-f3", "service"), "f3"), refusedSql, "facture avec une prestation");
  assert.equal(row(a.id).status, "held", "aucun refus ne déduit l'acompte");

  const ok = counterInvoice(db, 1, "comptoir-sql-f4");
  apply(ok, "f4");
  assert.deepEqual([row(a.id).status, row(a.id).applied_invoice_id], ["applied", ok]);
});

test("acompte déduit au comptoir en SQL direct : cliente absente acceptée, facture d'un autre rendez-vous toujours refusée", (t) => {
  const { db, deposit, row } = base(t);
  const a = deposit({ request_id: "comptoir-sql-02", appointment_id: 2, amount: 5000, payments: [{ method: "cash", amount: 5000 }] });
  db.exec("UPDATE appointments SET status = 'no_show' WHERE id = 2");
  assert.throws(() => applyDeposit(db, a.id, invoice(db, 1, "autre-rdv-01"), { now: NOW, accountId: 1, requestId: "x" }), /Acompte déduit d'une facture d'un autre rendez-vous/);
  const ok = counterInvoice(db, 1, "comptoir-sql-f5");
  applyDeposit(db, a.id, ok, { now: NOW, accountId: 1, requestId: "f5" });
  assert.equal(row(a.id).status, "applied");
});
