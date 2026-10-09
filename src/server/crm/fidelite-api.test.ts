import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { invoiceTicket } from "../caisse/routes.ts";
import { setupApp, type Caller, type TestApp } from "../test-support.ts";

/**
 * Fidélité par l'API (mini CRM § 2, § 4) : réglages de la gérante, paliers à
 * la caisse, récompense, correction des points, synthèse de la fiche, ticket.
 */

const FR = { "Accept-Language": "fr" };

test("réglages de la fidélité : défauts de la spec, gérante seule, valeurs contrôlées, journal", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const value = async (key: string) => ((await g("GET", "/api/settings")).body.settings as { key: string; value: unknown }[]).find((s) => s.key === key)?.value;
  assert.equal(await value("fidelite.active"), false);
  assert.equal(await value("fidelite.tranche"), 1000);
  assert.equal(await value("fidelite.points"), 1);
  assert.deepEqual(await value("fidelite.paliers"), [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }]);
  assert.equal((await r("PUT", "/api/settings/fidelite.active", { value: true })).status, 403);
  const bad = await g("PUT", "/api/settings/fidelite.paliers", { value: [{ points: 250, montant: 15000 }, { points: 100, montant: 5000 }] }, FR);
  assert.deepEqual([bad.status, bad.body.error], [400, "Chaque palier demande plus de points que le précédent."]);
  const tranche = await g("PUT", "/api/settings/fidelite.tranche", { value: 50 }, FR);
  assert.deepEqual([tranche.status, tranche.body.error], [400, "Tranche attendue\u00a0: nombre entier de francs, de 100 à 1\u00a0000\u00a0000."]);
  assert.equal((await g("PUT", "/api/settings/fidelite.points", { value: 101 })).status, 400);
  assert.equal((await g("PUT", "/api/settings/fidelite.paliers", { value: [] })).status, 400);
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: "oui" })).status, 400);
  assert.equal((await g("PUT", "/api/settings/fidelite.tranche", { value: 500 })).status, 200);
  assert.equal((await g("PUT", "/api/settings/fidelite.paliers", { value: [{ points: 50, montant: 2000 }] })).status, 200);
  assert.equal(await value("fidelite.tranche"), 500);
  assert.deepEqual(await value("fidelite.paliers"), [{ points: 50, montant: 2000 }]);
  const journal = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'reglage' ORDER BY id").all().map((row) => (row as { target: string }).target);
  assert.deepEqual(journal, ["fidelite.tranche", "fidelite.paliers"]);
});

/** Catalogue de l'essai : une praticienne, une cliente, un soin à 25 000 F. */
async function catalogue(g: Caller) {
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", name_en: "Radiance facial", duration: 60, price: 25000 })).body.service.id as number;
  return { staff, client, service };
}

/** Points déjà acquis (carte papier), écrits directement dans le registre de l'essai. */
function seedPoints(ctx: TestApp, client: number, points: number) {
  ctx.db.prepare("INSERT INTO loyalty_entries (client_id, kind, points, note, created_at) VALUES (?, 'correction', ?, 'Carte papier', 0)").run(client, points);
}

test("caisse : paliers à la gérante et à la réception, jamais à la praticienne ; récompense sans approbation ; solde insuffisant ; praticienne refusée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  const { staff, client, service } = await catalogue(g);
  assert.deepEqual((await r("GET", "/api/sales/settings")).body.loyalty, { active: false, tiers: [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }] });
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: true })).status, 200);
  assert.equal((await r("GET", "/api/sales/settings")).body.loyalty.active, true);
  assert.equal((await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true })).status, 200);
  assert.deepEqual((await p("GET", "/api/sales/settings")).body.loyalty, { active: false, tiers: [] });

  seedPoints(ctx, client, 120);
  const body = (id: string) => ({
    request_id: id, client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }],
    discount: { reward_points: 100 }, payments: [{ method: "card", amount: 20000 }],
  });
  const sale = await r("POST", "/api/sales", body("api-recompense-1"));
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.deepEqual([sale.body.invoice.discount_amount, sale.body.invoice.discount_reason, sale.body.invoice.total_ttc], [5000, "fidelite", 20000]);
  const rows = ctx.db.prepare("SELECT kind, points FROM loyalty_entries WHERE invoice_id = ? ORDER BY id").all(sale.body.invoice.id).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ kind: "recompense", points: -100 }, { kind: "gain", points: 20 }]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'facture.remise_plafond'").get() as { n: number }).n, 0, "aucune approbation");

  const poor = await r("POST", "/api/sales", body("api-recompense-2"), FR);
  assert.deepEqual([poor.status, poor.body.error], [409, "Points insuffisants\u00a0: 40 pour un palier de 100."]);

  // La praticienne n'applique jamais de récompense, comme toute remise (refus avant tout contrôle du rendez-vous).
  const refused = await p("POST", "/api/sales", { request_id: "prat-recompense-1", client_id: client, appointment_id: 1, lines: [{ kind: "service", ref_id: service, quantity: 1 }], discount: { reward_points: 100 }, payments: [] }, FR);
  assert.deepEqual([refused.status, refused.body.error], [403, "Une praticienne n'applique pas de remise."]);
});

test("avoir total après la fidélité désactivée : reprise des points gagnés et restitution de la récompense écrites (ajustement 3)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { staff, client, service } = await catalogue(g);
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: true })).status, 200);
  seedPoints(ctx, client, 120);
  const sale = await r("POST", "/api/sales", {
    request_id: "api-ajust3-vente", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }],
    discount: { reward_points: 100 }, payments: [{ method: "card", amount: 20000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const invoice = sale.body.invoice;
  const entries = (invoiceId: number) => ctx.db.prepare("SELECT kind, points FROM loyalty_entries WHERE invoice_id = ? ORDER BY id").all(invoiceId).map((row) => ({ ...row }));
  assert.deepEqual(entries(invoice.id), [{ kind: "recompense", points: -100 }, { kind: "gain", points: 20 }]);

  // La gérante coupe la fidélité, puis la facture est annulée en entier par un avoir.
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: false })).status, 200);
  const back = await g("POST", "/api/credit-notes", {
    request_id: "api-ajust3-avoir", invoice_id: invoice.id, reason: "Erreur de caisse",
    lines: [{ line_id: invoice.lines[0].id, quantity: 1 }], refunds: [{ method: "card", amount: 20000 }],
  });
  assert.equal(back.status, 201, JSON.stringify(back.body));
  assert.deepEqual(entries(back.body.credit_note.id), [{ kind: "reprise", points: -20 }, { kind: "restitution", points: 100 }]);
  const balance = (ctx.db.prepare("SELECT SUM(points) AS n FROM loyalty_entries WHERE client_id = ?").get(client) as { n: number }).n;
  assert.equal(balance, 120, "aucun point d'une facture annulée, la récompense rendue");
});

test("fiche : solde et écritures à la réception et à la gérante, correction par la gérante seule, au journal ; synthèse de la fiche", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  const { client } = await catalogue(g);
  const path = `/api/clients/${client}/loyalty`;
  assert.equal((await g("GET", `/api/clients/${client}`)).body.summary.loyalty, null, "fidélité inactive");
  const inactive = await g("POST", path, { points: 50, note: "Carte papier" }, FR);
  assert.deepEqual([inactive.status, inactive.body.error], [400, "La fidélité n'est pas activée dans les réglages."]);
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: true })).status, 200);

  assert.equal((await r("POST", path, { points: 50, note: "Carte papier" })).status, 403, "réception : pas de correction");
  assert.equal((await p("GET", path)).status, 403, "praticienne : ni solde ni écritures");
  const noReason = await g("POST", path, { points: 50, note: "  " }, FR);
  assert.deepEqual([noReason.status, noReason.body.error], [400, "Le motif de la correction est obligatoire (200 caractères au plus)."]);
  assert.equal((await g("POST", path, { points: 0, note: "Rien" })).status, 400);
  assert.equal((await g("POST", path, { points: 100001, note: "Trop" })).status, 400);
  assert.equal((await g("POST", path, { points: 2.5, note: "Virgule" })).status, 400);
  assert.equal((await g("POST", "/api/clients/9999/loyalty", { points: 5, note: "Inconnue" })).status, 404);
  assert.equal((await r("GET", "/api/clients/9999/loyalty")).status, 404);

  const added = await g("POST", path, { points: 80, note: "Carte papier" });
  assert.deepEqual([added.status, added.body.balance], [201, 80]);
  assert.equal((await g("POST", path, { points: -10, note: "Erreur de saisie" })).status, 201);
  const read = (await r("GET", path)).body;
  assert.equal(read.balance, 70);
  assert.deepEqual(
    read.entries.map((e: { kind: string; points: number; note: string; account_name: string }) => [e.kind, e.points, e.note, e.account_name]),
    [["correction", -10, "Erreur de saisie", "manager"], ["correction", 80, "Carte papier", "manager"]],
  );
  const journal = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'fidelite.correction' ORDER BY id").all().map((row) => (row as { target: string }).target);
  assert.deepEqual(journal, ["Aïcha Mbida (+80)", "Aïcha Mbida (-10)"]);
  assert.equal(auditAction("fidelite.correction", "fr"), "Points de fidélité corrigés");
  assert.equal(auditAction("fidelite.correction", "en"), "Loyalty points corrected");

  assert.deepEqual((await r("GET", `/api/clients/${client}`)).body.summary.loyalty, { balance: 70, next_tier: { points: 100, montant: 5000, missing: 30 } });
  assert.equal((await p("GET", `/api/clients/${client}`)).body.summary.loyalty, null, "praticienne : jamais la fidélité");
});

test("ticket d'une facture : fidélité lue dans le registre, solde figé pour un duplicata ; PDF fabriqué", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { staff, client, service } = await catalogue(g);
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: true })).status, 200);
  seedPoints(ctx, client, 120);
  const sale = await g("POST", "/api/sales", {
    request_id: "api-ticket-fid-1", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }],
    discount: { reward_points: 100 }, payments: [{ method: "card", amount: 20000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const expected = { earned: 20, reward: 100, taken: 0, restored: 0, balance: 40 };
  assert.deepEqual(sale.body.invoice.loyalty, expected);
  seedPoints(ctx, client, 5);
  const again = (await g("GET", `/api/invoices/${sale.body.invoice.id}`)).body.invoice;
  assert.deepEqual(invoiceTicket(again).loyalty, expected, "duplicata identique malgré une écriture plus récente");
  const pdf = await g("GET", `/api/invoices/${sale.body.invoice.id}/pdf`);
  assert.deepEqual([pdf.status, pdf.headers.get("content-type")], [200, "application/pdf"]);
});