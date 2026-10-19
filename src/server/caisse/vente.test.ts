import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { checkPayments, issueSale, parseSaleRequest, priceSale, SaleError, type IssueContext, type SaleSettings } from "./vente.ts";

/**
 * Émission d'une facture (sous-projet 5 § 3.2, § 3.3, § 4.4, § 8) : numéro
 * pris dans la même transaction que tout le reste, aucune modification
 * possible, même `request_id` servi une seule fois, stock jamais négatif.
 */

const SETTINGS: SaleSettings = { vat: { active: true, rate: 19.25 }, discounts: true, discountCap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"] };
const NOW = Date.parse("2026-09-30T15:00:00Z");

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
    INSERT INTO products (id, name, brand, price, stock) VALUES (1, 'Crème hydratante', 'Maison', 35000, 2);
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Ngozi', 'ngozi', 'reception', 'x', 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'in_progress', '2026-09-30');
  `);
  const storage = sqliteStorage(db);
  const ctx = (over: Partial<IssueContext> = {}): IssueContext => ({ now: NOW, lang: "fr", accountId: 1, fiscal: { tva_active: true, tva_taux: 19.25 }, settings: SETTINGS, approved: false, requestLang: "fr", ...over });
  const issue = (body: Record<string, unknown>, over: Partial<IssueContext> = {}) => storage.transaction!((d) => issueSale(d, parseSaleRequest(body), ctx(over)));
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { db, issue, count };
}

/** Vente de comptoir d'une crème, payée en espèces. */
const cream = (request_id: string, extra: Record<string, unknown> = {}) => ({
  request_id, lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 35000, cash_given: 40000 }], ...extra,
});

test("numérotation continue ; une panne au milieu d'une émission n'use aucun numéro et n'écrit rien", (t) => {
  const { db, issue, count } = base(t);
  issue(cream("vente-0001"));
  assert.equal((db.prepare("SELECT number FROM invoices").get() as { number: string }).number, "FAC-2026-000001");

  // Panne simulée après le numéro, la facture, les lignes, le stock et les versements : au pourboire.
  db.exec("CREATE TEMP TRIGGER panne BEFORE INSERT ON tips BEGIN SELECT RAISE(ABORT, 'panne simulée'); END");
  assert.throws(() => issue(cream("vente-0002", { tip: { amount: 1000, staff_id: 1 }, payments: [{ method: "cash", amount: 36000 }] })), /panne simulée/);
  assert.deepEqual(db.prepare("SELECT series, year, last FROM sequences").all().map((r) => ({ ...r })), [{ series: "FAC", year: 2026, last: 1 }], "numéro rendu");
  assert.deepEqual([count("invoices"), count("invoice_lines"), count("payments"), count("tips")], [1, 1, 1, 0], "rien d'écrit");
  assert.equal((db.prepare("SELECT stock FROM products WHERE id = 1").get() as { stock: number }).stock, 1, "stock rendu");

  db.exec("DROP TRIGGER panne");
  issue(cream("vente-0002", { tip: { amount: 1000, staff_id: 1 }, payments: [{ method: "cash", amount: 36000 }] }));
  assert.deepEqual(db.prepare("SELECT number FROM invoices ORDER BY id").all().map((r) => (r as { number: string }).number), ["FAC-2026-000001", "FAC-2026-000002"], "aucun trou");
});

test("même request_id envoyé deux fois : une seule facture, la même rendue", (t) => {
  const { issue, count } = base(t);
  const first = issue(cream("double-appui-1"));
  const again = issue(cream("double-appui-1"));
  assert.deepEqual([first.replay, again.replay, again.id], [false, true, first.id]);
  assert.equal(count("invoices"), 1);
  assert.equal(count("payments"), 1);
});

test("correctif 1 : un request_id déjà émis n'est rejoué pour la praticienne que si c'est sa propre facture", (t) => {
  const { issue, count } = base(t);
  const counter = issue(cream("req-comptoir-1"));
  assert.equal(counter.replay, false);
  assert.throws(
    () => issue(cream("req-comptoir-1"), { practitionerStaffId: 1 }),
    (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "vente.requete",
    "vente de comptoir : jamais sienne, même rejouée avec le même request_id",
  );
  const rdv = { request_id: "req-rdv-1", client_id: 1, appointment_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], payments: [{ method: "cash", amount: 25000 }] };
  const own = issue(rdv);
  assert.equal(own.replay, false);
  const replay = issue(rdv, { practitionerStaffId: 1 });
  assert.deepEqual([replay.replay, replay.id], [true, own.id]);
  assert.equal(count("invoices"), 2);
});

test("stock déduit à la vente et jamais négatif : vente refusée avec le nom du produit, rien n'est écrit", (t) => {
  const { db, issue, count } = base(t);
  const tooMany = { request_id: "stock-trois", lines: [{ kind: "product", ref_id: 1, quantity: 3 }], payments: [{ method: "card", amount: 105000 }] };
  assert.throws(() => issue(tooMany), (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "vente.stock" && e.values.produit === "Crème hydratante");
  assert.deepEqual([count("invoices"), count("sequences")], [0, 0]);
  issue({ ...tooMany, request_id: "stock-deux", lines: [{ kind: "product", ref_id: 1, quantity: 2 }], payments: [{ method: "card", amount: 70000 }] });
  assert.equal((db.prepare("SELECT stock FROM products WHERE id = 1").get() as { stock: number }).stock, 0);
});

/**
 * Mineur 4 de la relecture finale (final-review.md) : le refus de stock
 * nommait toujours le produit en français, même pour une demande en anglais.
 * Corrigé en choisissant la désignation anglaise pour une demande en anglais,
 * quand le produit en a une ; le français reste le repli, sans désignation
 * anglaise.
 */
test("mineur 4 : refus de stock, produit nommé dans la langue de la demande (anglais s'il en a un, français sinon)", (t) => {
  const { db, issue } = base(t);
  db.exec("INSERT INTO products (id, name, name_en, brand, price, stock) VALUES (2, 'Sérum réparateur', 'Repair serum', 'Maison', 12000, 1)");
  const enBody = { request_id: "stock-en", lines: [{ kind: "product", ref_id: 2, quantity: 2 }], payments: [{ method: "card", amount: 24000 }] };
  assert.throws(() => issue(enBody, { requestLang: "en" }), (e: unknown) => e instanceof SaleError && e.values.produit === "Repair serum", "anglais, désignation anglaise disponible");
  assert.throws(() => issue({ ...enBody, request_id: "stock-fr" }, { requestLang: "fr" }), (e: unknown) => e instanceof SaleError && e.values.produit === "Sérum réparateur", "français demandé");
  const noEnglish = { request_id: "stock-en-sans", lines: [{ kind: "product", ref_id: 1, quantity: 3 }], payments: [{ method: "card", amount: 105000 }] };
  assert.throws(() => issue(noEnglish, { requestLang: "en" }), (e: unknown) => e instanceof SaleError && e.values.produit === "Crème hydratante", "anglais, mais sans désignation anglaise : français en repli");
  db.exec("DELETE FROM products WHERE id = 2");
});

test("facture, lignes, versements et pourboires impossibles à modifier ou supprimer, même en SQL direct", (t) => {
  const { db, issue } = base(t);
  issue({ request_id: "immuable-1", client_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], tip: { amount: 2000, staff_id: 1 }, payments: [{ method: "cash", amount: 27000 }] });
  for (const sql of [
    "UPDATE invoices SET total_ttc = 1", "DELETE FROM invoices",
    "INSERT OR REPLACE INTO invoices (id, kind, number, series, year, seq, issued_at, lang, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, request_id) VALUES (1, 'invoice', 'FAC-2026-000001', 'FAC', 2026, 1, 0, 'fr', 1, 0, 0, 0, 0, '{}', 'immuable-1')",
    "UPDATE invoice_lines SET unit_price = 1", "DELETE FROM invoice_lines",
    "INSERT OR REPLACE INTO invoice_lines (id, invoice_id, kind, ref_id, label_fr, quantity, unit_price, line_total) VALUES (1, 1, 'service', 1, 'x', 1, 1, 1)",
    "UPDATE payments SET amount = 1", "DELETE FROM payments",
    "INSERT OR REPLACE INTO payments (id, invoice_id, method, amount) VALUES (1, 1, 'cash', 1)",
    "UPDATE tips SET amount = 1", "DELETE FROM tips",
    "UPDATE sequences SET last = 7", "UPDATE sequences SET last = 0", "DELETE FROM sequences",
    "INSERT OR REPLACE INTO sequences (series, year, last) VALUES ('FAC', 2026, 1)",
  ]) {
    assert.throws(() => db.exec(sql), /ne se (modifie|supprime) pas|n'avance que d'un pas/, sql);
  }
  assert.throws(() => db.exec(`INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, request_id)
    VALUES ('invoice', 'FAC-2026-000009', 'FAC', 2026, 9, 0, 'fr', 1, 0, 0, 0, 0, '{}', 'hors-suite')`), /hors de sa suite/, "numéro qui ne suit pas sa suite");
  assert.throws(() => db.exec("DELETE FROM clients WHERE id = 1"), /FOREIGN KEY/, "cliente facturée gardée");
  assert.throws(() => db.exec("UPDATE staff SET id = 9 WHERE id = 1"), /FOREIGN KEY/, "praticienne facturée gardée");
});

test("suite avancée à la main sans facture : l'émission suivante est refusée plutôt que de créer un trou", (t) => {
  const { db, issue } = base(t);
  issue(cream("suite-001"));
  db.exec("UPDATE sequences SET last = last + 1 WHERE series = 'FAC' AND year = 2026");
  assert.throws(() => issue(cream("suite-002")), /hors de sa suite/);
  assert.deepEqual(db.prepare("SELECT series, year, last FROM sequences").all().map((r) => ({ ...r })), [{ series: "FAC", year: 2026, last: 2 }], "l'avance à la main n'est pas défaite, mais aucune facture ne prend le numéro suivant");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 1, "aucune deuxième facture");
});

test("changement d'année à Douala : la suite de l'année nouvelle commence à 1", (t) => {
  const { db, issue } = base(t);
  issue(cream("annee-2026", { payments: [{ method: "card", amount: 35000 }] }), { now: Date.parse("2026-12-31T22:30:00Z") });
  issue(cream("annee-2027", { payments: [{ method: "card", amount: 35000 }] }), { now: Date.parse("2026-12-31T23:30:00Z") });
  assert.deepEqual(db.prepare("SELECT number FROM invoices ORDER BY id").all().map((r) => (r as { number: string }).number), ["FAC-2026-000001", "FAC-2027-000001"]);
});

test("versements : somme exacte, monnaie recalculée, référence obligatoire pour Orange Money et MoMo, moyen retiré refusé", () => {
  const cash = checkPayments([{ method: "cash", amount: 59000, reference: "", cash_given: 70000 }], 59000, SETTINGS);
  assert.deepEqual(cash, [{ method: "cash", amount: 59000, reference: "", cash_given: 70000, change_given: 11000 }]);
  assert.throws(() => checkPayments([{ method: "card", amount: 58000, reference: "", cash_given: null }], 59000, SETTINGS),
    (e: unknown) => e instanceof SaleError && e.status === 409 && e.extra.code === "total" && e.extra.due === 59000
      && e.values.recu === "¤58000" && e.values.du === "¤59000", "montants passés par montant(), formatés dans la langue du message, extra.due resté un nombre pour l'écran");
  assert.throws(() => checkPayments([{ method: "momo", amount: 59000, reference: "", cash_given: null }], 59000, SETTINGS), (e: unknown) => e instanceof SaleError && e.key === "vente.reference_obligatoire");
  assert.throws(() => checkPayments([{ method: "card", amount: 59000, reference: "", cash_given: null }], 59000, { ...SETTINGS, methods: ["cash"] }), (e: unknown) => e instanceof SaleError && e.key === "vente.moyen_refuse");
});

test("prix du catalogue au moment de l'émission, cliente obligatoire avec une prestation, rendez-vous terminé puis refusé une seconde fois", (t) => {
  const { db, issue } = base(t);
  const soin = { client_id: 1, appointment_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], payments: [{ method: "card", amount: 25000 }] };
  assert.throws(() => issue({ ...soin, request_id: "sans-cliente", client_id: null }), (e: unknown) => e instanceof SaleError && e.key === "vente.cliente_obligatoire");
  db.exec("UPDATE services SET price = 26000.4 WHERE id = 1");
  assert.throws(() => issue({ ...soin, request_id: "ancien-prix" }), (e: unknown) => e instanceof SaleError && e.extra.due === 26000, "le prix changé est dit");
  issue({ ...soin, request_id: "nouveau-prix", payments: [{ method: "card", amount: 26000 }] });
  const line = db.prepare("SELECT label_fr, label_en, unit_price, staff_id FROM invoice_lines").get();
  assert.deepEqual({ ...line }, { label_fr: "Soin du visage éclat", label_en: "Radiance facial", unit_price: 26000, staff_id: 1 }, "désignations copiées");
  assert.equal((db.prepare("SELECT status FROM appointments WHERE id = 1").get() as { status: string }).status, "completed");
  assert.throws(() => issue({ ...soin, request_id: "deuxieme", payments: [{ method: "card", amount: 26000 }] }), (e: unknown) => e instanceof SaleError && e.key === "vente.rdv_deja_paye" && e.values.numero === "FAC-2026-000001");
  assert.throws(() => db.exec("DELETE FROM appointments WHERE id = 1"), /FOREIGN KEY/, "rendez-vous facturé gardé");
});

test("remise au-delà du plafond : refusée sans approbation ; TVA calculée sur le total remisé", (t) => {
  const { db, issue } = base(t);
  const big = { request_id: "remise-20", client_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1 }], discount: { kind: "percent", value: 20, reason: "geste" }, payments: [{ method: "cash", amount: 20000 }] };
  assert.throws(() => issue(big), (e: unknown) => e instanceof SaleError && e.status === 403 && e.extra.code === "approbation");
  issue(big, { approved: true });
  const inv = db.prepare("SELECT subtotal, discount_amount, discount_kind, discount_value, discount_reason, total_ttc, total_ht, total_tva FROM invoices").get();
  assert.deepEqual({ ...inv }, { subtotal: 25000, discount_amount: 5000, discount_kind: "percent", discount_value: 20, discount_reason: "geste", total_ttc: 20000, total_ht: 16771, total_tva: 3229 });
  const priced = priceSale(db, parseSaleRequest({ ...big, request_id: "remise-autre", discount: { kind: "amount", value: 500, reason: "autre", note: " Anniversaire " } }), SETTINGS);
  assert.equal(priced.discountReason, "autre:Anniversaire");
});

/**
 * Retouche C (décision produit du 30/09/2026, M1 de la relecture
 * finale) : une vente dont le dû (total plus pourboire) vaut 0 s'émet sans
 * aucun versement, facture à 0 F (HT, TVA et TTC à 0), pour garder la trace
 * d'un soin offert. Un versement non nul sur une vente à 0 F reste refusé
 * (versements différents du dû), exactement comme un total positif non
 * couvert ; la remise de 100 % au-delà du plafond demande toujours
 * l'approbation d'une gérante, même si le dû final tombe à 0.
 */
test("retouche C : vente à 0 F émise sans versement (prestation offerte, remise de 100 %) ; versement non nul toujours refusé", (t) => {
  const { db, issue, count } = base(t);
  db.exec("INSERT INTO services (id, name, name_en, duration, price) VALUES (2, 'Retouche offerte', 'Free touch-up', 15, 0)");

  // Prestation offerte à 0 F au catalogue : dû nul dès le prix, sans remise.
  issue({ request_id: "offerte-0001", client_id: 1, lines: [{ kind: "service", ref_id: 2, quantity: 1, staff_id: 1 }], payments: [] });
  const inv = db.prepare("SELECT subtotal, discount_amount, total_ttc, total_ht, total_tva FROM invoices WHERE request_id = 'offerte-0001'").get();
  assert.deepEqual({ ...inv }, { subtotal: 0, discount_amount: 0, total_ttc: 0, total_ht: 0, total_tva: 0 });
  assert.equal(count("payments"), 0, "aucun versement écrit");
  assert.equal((db.prepare("SELECT number FROM invoices WHERE request_id = 'offerte-0001'").get() as { number: string }).number, "FAC-2026-000001", "la suite de numérotation avance normalement");

  // Un versement non nul sur une vente à 0 F reste refusé (versements ≠ dû), comme aujourd'hui.
  assert.throws(
    () => issue({ request_id: "offerte-payee", client_id: 1, lines: [{ kind: "service", ref_id: 2, quantity: 1, staff_id: 1 }], payments: [{ method: "cash", amount: 100, cash_given: 100 }] }),
    (e: unknown) => e instanceof SaleError && e.status === 409 && e.extra.code === "total" && e.extra.due === 0,
  );

  // Remise de 100 % au-delà du plafond : approbation demandée comme toute remise au-delà du plafond, même à un dû final nul.
  const gift = { request_id: "remise-100", client_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1 }], discount: { kind: "percent", value: 100, reason: "geste" }, payments: [] };
  assert.throws(() => issue(gift), (e: unknown) => e instanceof SaleError && e.status === 403 && e.extra.code === "approbation");
  issue(gift, { approved: true });
  const inv2 = db.prepare("SELECT subtotal, discount_amount, total_ttc, total_ht, total_tva FROM invoices WHERE request_id = 'remise-100'").get();
  assert.deepEqual({ ...inv2 }, { subtotal: 25000, discount_amount: 25000, total_ttc: 0, total_ht: 0, total_tva: 0 });
  assert.equal(count("invoices"), 2, "offerte-0001 et remise-100 ; le versement non nul a été refusé");
});

/**
 * Relecture de la retouche C, mineur 3 (`retouches-C-review.md`) : un total
 * à 0 F (prestation offerte) accompagné d'un pourboire non nul n'est pas une
 * vente à dû nul, puisque `due = total_ttc + tip` (`saleTotals`). Un tableau
 * de versements vide reste donc refusé, avec le dû égal au pourboire ; verser
 * le pourboire émet la facture (facture toujours à 0 F, pourboire à part).
 */
test("relecture, mineur 3 : total à 0 F avec un pourboire non nul, ce n'est pas un dû nul, versements vides refusés", (t) => {
  const { db, issue, count } = base(t);
  db.exec("INSERT INTO services (id, name, name_en, duration, price) VALUES (2, 'Retouche offerte', 'Free touch-up', 15, 0)");
  const gift = { request_id: "offerte-pourboire", client_id: 1, lines: [{ kind: "service", ref_id: 2, quantity: 1, staff_id: 1 }], tip: { amount: 2000, staff_id: 1 }, payments: [] };

  // Dû égal au pourboire (2 000), pas 0 : un tableau de versements vide reste refusé.
  assert.throws(() => issue(gift), (e: unknown) => e instanceof SaleError && e.status === 409 && e.extra.code === "total" && e.extra.due === 2000);
  assert.equal(count("invoices"), 0, "rien n'est écrit tant que le pourboire n'est pas versé");

  // Le pourboire versé émet la facture : total toujours à 0 F, pourboire à part (hors facture, sans TVA).
  issue({ ...gift, payments: [{ method: "cash", amount: 2000, cash_given: 2000 }] });
  const inv = db.prepare("SELECT subtotal, total_ttc, total_ht, total_tva FROM invoices WHERE request_id = 'offerte-pourboire'").get();
  assert.deepEqual({ ...inv }, { subtotal: 0, total_ttc: 0, total_ht: 0, total_tva: 0 });
  const tip = db.prepare("SELECT amount, staff_id FROM tips WHERE invoice_id = (SELECT id FROM invoices WHERE request_id = 'offerte-pourboire')").get();
  assert.deepEqual({ ...tip }, { amount: 2000, staff_id: 1 });
  assert.equal(count("payments"), 1, "le versement du pourboire est écrit");
});

test("demande illisible : refus 400 avant tout calcul", () => {
  for (const [body, key] of [
    [{}, "vente.requete"],
    [{ request_id: "court" }, "vente.requete"],
    [{ request_id: "vente-0001", lines: [] }, "vente.lignes"],
    [{ request_id: "vente-0001", lines: [{ kind: "cadeau", ref_id: 1, quantity: 1 }] }, "vente.ligne_invalide"],
    // Retouche C (décision du 30/09/2026) : un tableau de versements vide est désormais une forme valable (vente à 0
    // F), voir le test dédié plus bas ; ici, seule la borne haute (20 versements au plus) reste un refus de forme.
    [{ request_id: "vente-0001", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: Array.from({ length: 21 }, () => ({ method: "card", amount: 1 })) }, "vente.versement_invalide"],
    [{ request_id: "vente-0001", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], discount: { kind: "percent", value: 120, reason: "geste" }, payments: [] }, "vente.remise_invalide"],
    [{ request_id: "vente-0001", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], discount: { kind: "amount", value: 100, reason: "autre" }, payments: [] }, "vente.remise_motif"],
    [{ request_id: "vente-0001", lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "card", amount: 100, cash_given: 200 }] }, "vente.versement_invalide"],
  ] as const) {
    assert.throws(() => parseSaleRequest(body), (e: unknown) => e instanceof SaleError && e.status === 400 && e.key === key, JSON.stringify(body));
  }
});
