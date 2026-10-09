import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { setupApp } from "../test-support.ts";
import { issueDeposit, parseDepositRequest, parseSettleRequest, settleDeposit } from "./acompte.ts";
import { ticketRows } from "./ticket.ts";
import { invoiceTicket } from "./routes.ts";
import { issueSale, parseSaleRequest, SaleError, type SaleSettings } from "./vente.ts";

/**
 * Acompte déduit à l'encaissement du rendez-vous (sous-projet 5 § 6.2) :
 * versement déjà reçu, il réduit le reste à payer ; il passe à `applied`
 * dans la même transaction que la facture, et le ticket le cite.
 */

const SETTINGS: SaleSettings = { vat: { active: true, rate: 19.25 }, discounts: true, discountCap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"] };
const NOW = Date.parse("2026-10-01T09:00:00Z");

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
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'booked', '2026-10-01');
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 25000, 60);
  `);
  const storage = sqliteStorage(db);
  storage.transaction!((d) => issueDeposit(d, parseDepositRequest({ request_id: "acompte-vente-01", appointment_id: 1, amount: 10000, payments: [{ method: "cash", amount: 10000 }] }),
    { now: NOW, accountId: 1, lang: "fr", fiscal: {}, methods: SETTINGS.methods }));
  db.exec("UPDATE appointments SET status = 'in_progress' WHERE id = 1");
  const sell = (body: Record<string, unknown>) => storage.transaction!((d) => issueSale(d, parseSaleRequest({
    client_id: 1, appointment_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], ...body,
  }), { now: NOW + 3_600_000, lang: "fr", accountId: 1, fiscal: { tva_active: true, tva_taux: 19.25 }, settings: SETTINGS, approved: false, requestLang: "fr" }));
  const deposit = () => ({ ...(db.prepare("SELECT status, applied_invoice_id, settled_at, settled_by FROM deposits WHERE id = 1").get() as object) });
  return { db, sell, deposit };
}

test("encaissement d'un rendez-vous avec acompte : reste à payer réduit, acompte déduit dans la même transaction", (t) => {
  const { db, sell, deposit } = base(t);
  assert.throws(() => sell({ request_id: "vente-acompte-1", payments: [{ method: "card", amount: 25000 }] }),
    (e: unknown) => e instanceof SaleError && e.key === "vente.versements_total" && e.extra.due === 15000, "le dû annoncé tient compte de l'acompte");
  assert.deepEqual(deposit(), { status: "held", applied_invoice_id: null, settled_at: null, settled_by: null }, "un refus ne touche pas à l'acompte");
  const done = sell({ request_id: "vente-acompte-1", payments: [{ method: "card", amount: 15000 }] });
  const inv = db.prepare("SELECT number, total_ttc FROM invoices WHERE id = ?").get(done.id) as { number: string; total_ttc: number };
  assert.deepEqual([inv.number, inv.total_ttc], ["FAC-2026-000001", 25000], "la facture garde son total : l'acompte est un versement");
  assert.deepEqual(deposit(), { status: "applied", applied_invoice_id: done.id, settled_at: NOW + 3_600_000, settled_by: 1 });
  assert.deepEqual(db.prepare("SELECT method, amount FROM payments WHERE invoice_id = ?").all(done.id).map((r) => ({ ...r })), [{ method: "card", amount: 15000 }]);
  assert.equal(sell({ request_id: "vente-acompte-1", payments: [{ method: "card", amount: 15000 }] }).replay, true, "rejeu : rien de plus");
});

test("panne au milieu de la vente : ni facture ni numéro, l'acompte reste en attente", (t) => {
  const { db, sell, deposit } = base(t);
  db.exec("CREATE TEMP TRIGGER panne BEFORE UPDATE ON deposits BEGIN SELECT RAISE(ABORT, 'panne simulée'); END");
  assert.throws(() => sell({ request_id: "vente-panne-01", payments: [{ method: "cash", amount: 15000 }] }), /panne simulée/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
  assert.equal((db.prepare("SELECT last FROM sequences WHERE series = 'FAC'").get() as { last: number } | undefined), undefined, "aucun numéro de facture pris");
  assert.equal((deposit() as { status: string }).status, "held");
});

test("acompte plus gros que le total à payer : vente refusée avec un message qui le dit", (t) => {
  const { db, sell, deposit } = base(t);
  // Prix du soin baissé entre la prise de l'acompte et l'encaissement (le prix de l'émission fait foi, § 7).
  db.exec("UPDATE services SET price = 8000 WHERE id = 1");
  assert.throws(() => sell({ request_id: "vente-baisse-01", payments: [] }),
    (e: unknown) => e instanceof SaleError && e.key === "acompte.depasse" && e.extra.code === "acompte");
  // Mineur (relecture, correctif 1) : un refus ne touche pas à l'acompte, et ne prend aucun numéro de facture.
  assert.equal((deposit() as { status: string }).status, "held");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
});

/**
 * Correctif 1 (relecture d'opus sur eec69c3), important 1 : décision 5
 * contournable par le pourboire. L'acompte était comparé à `priced.totals.due`
 * (TTC + pourboire) : un acompte plus gros que le total TTC seul pouvait ainsi
 * payer une part du pourboire. Il se compare désormais au total TTC seul.
 */
test("acompte plus gros que le total TTC (hors pourboire) : vente refusée même si le pourboire comble l'écart", (t) => {
  const { db, sell, deposit } = base(t);
  // Prix du soin baissé à 8 000 ; acompte de 10 000 déjà pris sur 25 000 (base()).
  db.exec("UPDATE services SET price = 8000 WHERE id = 1");
  assert.throws(() => sell({ request_id: "vente-pourboire-01", tip: { amount: 3000, staff_id: 1 }, payments: [{ method: "cash", amount: 1000 }] }),
    (e: unknown) => e instanceof SaleError && e.key === "acompte.depasse" && e.extra.code === "acompte", "le pourboire ne comble pas l'écart : l'acompte ne paie jamais le pourboire");
  assert.equal((deposit() as { status: string }).status, "held");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
});

/**
 * Correctif 1 (relecture d'opus sur eec69c3), important 2 : un acompte ne se
 * déduit que de la facture de sa propre cliente, jamais de celle d'une autre
 * (y compris une vente sans cliente choisie).
 */
test("acompte déduit seulement pour la cliente de l'acompte : vente d'une autre cliente (ou sans cliente) refusée", (t) => {
  const { db, sell, deposit } = base(t);
  db.exec(`
    INSERT INTO clients (id, name) VALUES (2, 'Flore Essomba');
    INSERT INTO products (id, name, price, stock) VALUES (1, 'Shampoing réparateur', 15000, 10);
  `);
  assert.throws(() => sell({ request_id: "vente-autre-cliente-01", client_id: 2, payments: [{ method: "card", amount: 15000 }] }),
    (e: unknown) => e instanceof SaleError && e.key === "acompte.autre_cliente" && e.extra.code === "acompte", "une autre cliente ne profite pas de l'acompte");
  assert.equal((deposit() as { status: string }).status, "held");
  // Vente sans cliente choisie : une ligne produit (pas de service) pour ne pas buter d'abord sur « vente.cliente_obligatoire ».
  assert.throws(() => sell({
    request_id: "vente-sans-cliente-01", client_id: null, lines: [{ kind: "product", ref_id: 1, quantity: 1, staff_id: null }], payments: [{ method: "card", amount: 15000 }],
  }), (e: unknown) => e instanceof SaleError && e.key === "acompte.autre_cliente", "sans cliente choisie non plus");
  assert.equal((deposit() as { status: string }).status, "held", "aucune des deux ventes refusées n'a touché à l'acompte");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0, "aucun numéro de facture pris");
});

test("facture avec acompte : la fiche et le ticket citent l'acompte comme versement déjà reçu", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", duration: 60, price: 25000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-09-29", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;
  await g("POST", "/api/deposits", { request_id: "acompte-fiche-01", appointment_id: apt, amount: 10000, payments: [{ method: "cash", amount: 10000 }] });
  await g("PUT", `/api/appointments/${apt}`, { status: "completed" });
  const sale = await g("POST", "/api/sales", { request_id: "vente-fiche-001", client_id: client, appointment_id: apt, lines: [{ kind: "service", ref_id: service, quantity: 1 }], tip: { amount: 1000, staff_id: (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id }, payments: [{ method: "card", amount: 16000 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.deepEqual(sale.body.invoice.deposits, [{ id: 1, number: "AC-2026-000001", amount: 10000 }]);
  assert.equal((await g("GET", `/api/deposits/1`)).body.deposit.applied_invoice_number, "FAC-2026-000001");
  const rows = ticketRows(invoiceTicket(sale.body.invoice)).flatMap((row) => (row.type === "pair" ? [`${row.left} | ${row.right}`] : []));
  assert.ok(rows.includes("Acompte AC-2026-000001 | 10\u00a0000\u00a0FCFA"), JSON.stringify(rows));
  assert.ok(rows.includes("Carte | 16\u00a0000\u00a0FCFA"));
  assert.ok(rows.includes("Total réglé | 26\u00a0000\u00a0FCFA"), "total réglé : acompte, versements et pourboire");
  const en = ticketRows({ ...invoiceTicket(sale.body.invoice), lang: "en" }).flatMap((row) => (row.type === "pair" ? [row.left] : []));
  assert.ok(en.includes("Deposit AC-2026-000001"));
});

test("praticienne : contrôles faits dans la transaction d'émission ; un rendez-vous qui a un acompte reste à la gérante et à la réception", (t) => {
  const { db } = base(t);
  db.exec("INSERT INTO staff (id, name) VALUES (2, 'Grace')");
  const storage = sqliteStorage(db);
  const sellAs = (staffId: number, body: Record<string, unknown> = {}) => storage.transaction!((d) => issueSale(d, parseSaleRequest({
    request_id: `praticienne-${staffId}-01`, client_id: 1, appointment_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], payments: [{ method: "cash", amount: 15000 }], ...body,
  }), { now: NOW, lang: "fr", accountId: 1, fiscal: {}, settings: SETTINGS, approved: false, requestLang: "fr", practitionerStaffId: staffId }));
  const refused = (fn: () => unknown, key: string) => assert.throws(fn, (e: unknown) => e instanceof SaleError && e.status === 403 && e.key === key, key);
  refused(() => sellAs(2), "vente.praticienne_rdv");
  refused(() => sellAs(1, { client_id: null, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }] }), "vente.praticienne_cliente");
  refused(() => sellAs(1), "vente.praticienne_acompte");
  db.exec("UPDATE appointments SET status = 'booked' WHERE id = 1");
  refused(() => sellAs(1), "vente.praticienne_statut");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
});

/**
 * Avenant (relecture du correctif de la tâche 1) : `applyDeposit` pose un
 * `settle_request_id` de la forme `facture-<id ou requestId>` ; une gérante
 * ne doit pas pouvoir envoyer un sort avec un `request_id` qui commence par
 * ce préfixe, sous peine d'occuper d'avance l'identifiant que la vente pose
 * et de heurter le déclencheur d'immuabilité en erreur SQL brute.
 */
test("sort d'un acompte : request_id commençant par « facture- » refusé (réservé à la vente)", (t) => {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  t.after(() => db.close());
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Soin du visage éclat', 'Radiance facial', 60, 25000);
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'booked', '2026-10-01');
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 25000, 60);
  `);
  const storage = sqliteStorage(db);
  const dep = storage.transaction!((d) => issueDeposit(d, parseDepositRequest({ request_id: "acompte-avenant-01", appointment_id: 1, amount: 5000, payments: [{ method: "cash", amount: 5000 }] }),
    { now: NOW, accountId: 1, lang: "fr", fiscal: {}, methods: SETTINGS.methods }));
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 1");
  assert.throws(() => storage.transaction!((d) => settleDeposit(d, parseSettleRequest(dep.id, { request_id: "facture-vente-01", action: "keep", reason: "cliente absente" }), { now: NOW, accountId: 1 })),
    (e: unknown) => e instanceof SaleError && e.key === "vente.requete", "refusé par settleDeposit, pas seulement au parsing");
});
