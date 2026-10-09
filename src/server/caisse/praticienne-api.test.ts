import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Caller } from "../test-support.ts";

/**
 * Encaissement par la praticienne (demande produit du 30/09/2026) :
 * réglage `caisse.encaissement_praticienne`, désactivé par défaut ; activé,
 * la praticienne encaisse ses propres rendez-vous seulement, sans remise, et
 * imprime le ticket émis ; ses autres écrans ne lui montrent toujours aucun
 * montant.
 */

const FR = { "Accept-Language": "fr" };

async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  const own = (ctx.db.prepare("SELECT staff_id FROM accounts WHERE login = 'practitioner'").get() as { staff_id: number }).staff_id;
  const other = (await g("POST", "/api/staff", { name: "Grace" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", duration: 60, price: 25000 })).body.service.id as number;
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 3 })).body.product.id as number;
  const book = async (staff: number, time: string) =>
    (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-28", start_time: time, service_ids: [service] })).body.appointment.id as number;
  const mine = await book(own, "10:00");
  // Correctif 1 : la praticienne n'encaisse qu'un rendez-vous en cours ou terminé (décision 16).
  await g("PUT", `/api/appointments/${mine}`, { status: "in_progress" });
  const theirs = await book(other, "10:00");
  const sale = (apt: number | null, request_id: string, extra: Record<string, unknown> = {}) => ({
    request_id, client_id: client, appointment_id: apt, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: own }], payments: [{ method: "cash", amount: 25000 }], ...extra,
  });
  return { ctx, g, p, own, client, service, product, mine, theirs, sale };
}

test("réglage désactivé par défaut : la praticienne n'encaisse rien ; la gérante l'active, au journal", async (t) => {
  const { ctx, g, p, mine, sale } = await setup(t);
  const settings = (await g("GET", "/api/settings")).body.settings as { key: string; value: unknown }[];
  assert.equal(settings.find((s) => s.key === "caisse.encaissement_praticienne")?.value, false);
  const refused = await p("POST", "/api/sales", sale(mine, "prat-off-0001"), FR);
  assert.deepEqual([refused.status, refused.body.error], [403, "L'encaissement par la praticienne n'est pas activé."]);
  const read = (await p("GET", "/api/sales/settings")).body;
  // Correctif final (point 6) : réglage désactivé, rien d'autre que l'indicateur (ni TVA, ni moyens, ni plafond).
  // Correctif 3 de la tâche 2, vague 3b : `deposits` explicite à `false`, la praticienne ne lit jamais les acomptes.
  assert.deepEqual(read, { practitioner_checkout: false, deposits: false }, "réglage désactivé : rien d'autre que l'indicateur et les acomptes");
  assert.equal((await p("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true })).status, 403);
  assert.equal((await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true })).status, 200);
  assert.equal((await p("GET", "/api/sales/settings")).body.practitioner_checkout, true);
  assert.equal((await g("GET", "/api/sales/settings")).body.discounts, true, "la gérante garde ses remises");
  assert.deepEqual(ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'reglage'").all().map((r) => (r as { target: string }).target), ["caisse.encaissement_praticienne"]);
});

test("activé : ses rendez-vous seulement, jamais le comptoir ni le rendez-vous d'une autre, jamais de remise", async (t) => {
  const { g, p, mine, theirs, sale } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const own = "Une praticienne n'encaisse que ses propres rendez-vous.";
  const counter = await p("POST", "/api/sales", sale(null, "prat-comptoir1"), FR);
  assert.deepEqual([counter.status, counter.body.error], [403, own]);
  const other = await p("POST", "/api/sales", sale(theirs, "prat-autre-001"), FR);
  assert.deepEqual([other.status, other.body.error], [403, own]);
  const discount = await p("POST", "/api/sales", sale(mine, "prat-remise-01", { discount: { kind: "percent", value: 5, reason: "fidelite" }, payments: [{ method: "cash", amount: 23750 }] }), FR);
  assert.deepEqual([discount.status, discount.body.error], [403, "Une praticienne n'applique pas de remise."]);
  const ok = await p("POST", "/api/sales", sale(mine, "prat-ok-00001"));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.invoice.account_name, "practitioner");
});

test("après l'émission : le ticket de sa facture, la vente retrouvée ; ni la fiche d'une facture, ni la facture d'une autre, ni aucun montant ailleurs", async (t) => {
  const { g, p, service, product, mine, sale } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const ok = await p("POST", "/api/sales", sale(mine, "prat-ticket-01", {
    lines: [{ kind: "service", ref_id: service, quantity: 1 }, { kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 60000 }],
  }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const counter = await g("POST", "/api/sales", { request_id: "gerante-comptoir1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  assert.equal((await p("GET", `/api/invoices/${ok.body.invoice.id}/pdf`)).status, 200);
  assert.equal((await p("GET", `/api/invoices/${counter.body.invoice.id}/pdf`)).status, 404, "la facture d'une autre vente : introuvable pour elle");
  assert.equal((await p("GET", "/api/sales/prat-ticket-01")).body.invoice.id, ok.body.invoice.id);
  // Correctif final (point 4) : une facture existe pour ce request_id (vente de comptoir de la gérante), mais ce
  // n'est pas la sienne : 403, jamais la fausse « absente ».
  assert.equal((await p("GET", "/api/sales/gerante-comptoir1")).status, 403);
  assert.equal((await p("GET", `/api/invoices/${ok.body.invoice.id}`)).status, 403);
  const seen = (await p("GET", `/api/appointments/${mine}`)).body.appointment;
  assert.equal(seen.paid, 1);
  assert.equal("invoice_number" in seen || "invoice_total" in seen || "total_price" in seen, false, "montants toujours cachés dans sa fiche");
});

/**
 * Correctif 1 (relecture de 5ea25db) : la praticienne ne lit rien de la
 * caisse quand le réglage est désactivé, même sa propre facture (décision
 * 16) ; ni avoir (décision 18) ; ni facture d'autrui par rejeu d'un
 * `request_id` ; ni rendez-vous à venir (booked/confirmed), seulement en
 * cours ou terminé.
 */

test("réglage désactivé après l'émission : plus rien pour la praticienne, même sa propre facture (PDF, reprise)", async (t) => {
  const { g, p, mine, sale } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const ok = await p("POST", "/api/sales", sale(mine, "prat-reglage-01"));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal((await p("GET", `/api/invoices/${ok.body.invoice.id}/pdf`)).status, 200);
  assert.equal((await p("GET", "/api/sales/prat-reglage-01")).status, 200);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: false });
  assert.equal((await p("GET", `/api/invoices/${ok.body.invoice.id}/pdf`)).status, 404, "réglage de nouveau désactivé : même sa propre facture devient introuvable");
  // Correctif final (point 4) : la facture existe toujours, mais le réglage désactivé lui en retire le droit : 403, jamais « absente ».
  assert.equal((await p("GET", "/api/sales/prat-reglage-01")).status, 403);
});

test("avoir lié à son rendez-vous : introuvable pour elle, jamais un avoir (décision 18)", async (t) => {
  const { g, p, mine, sale } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const ok = await p("POST", "/api/sales", sale(mine, "prat-avoir-001"));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const lineId = ok.body.invoice.lines[0].id as number;
  const credit = await g("POST", "/api/credit-notes", {
    request_id: "prat-avoir-credit1", invoice_id: ok.body.invoice.id, reason: "Cliente mécontente",
    lines: [{ line_id: lineId, quantity: 1 }], refunds: [{ method: "cash", amount: 25000 }],
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));
  assert.equal((await p("GET", `/api/invoices/${credit.body.credit_note.id}/pdf`)).status, 404);
});

test("rejeu de POST /api/sales avec le request_id d'une vente de la gérante : refus, aucune facture étrangère rendue", async (t) => {
  const { g, p, mine, product, sale } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const counter = await g("POST", "/api/sales", { request_id: "gerante-rejeu-001", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  assert.equal(counter.status, 201, JSON.stringify(counter.body));
  const replay = await p("POST", "/api/sales", sale(mine, "gerante-rejeu-001"), FR);
  assert.deepEqual([replay.status, replay.body.error], [409, "Identifiant de vente manquant ou invalide."]);
  assert.equal(replay.body.invoice, undefined, "jamais la facture de la gérante");
});

// Correctif final (point 5) : le ticket de la praticienne reste celui du rendez-vous (décision 16).
test("cliente du ticket différente de celle du rendez-vous : refus (décision 16, le ticket reste celui du rendez-vous)", async (t) => {
  const { g, p, client, mine, sale } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const other = (await g("POST", "/api/clients", { name: "Flore Ngo" })).body.client.id as number;
  const refused = await p("POST", "/api/sales", sale(mine, "prat-cliente-01", { client_id: other }), FR);
  assert.deepEqual([refused.status, refused.body.error], [403, "Une praticienne n'encaisse que la cliente de son rendez-vous."]);
  const ok = await p("POST", "/api/sales", sale(mine, "prat-cliente-02", { client_id: client }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

/**
 * Retouches vague 3a, commit 1 (retouches-brief.md § 2) : l'ancien refus ne regardait que
 * `req.client_id !== null`, donc un `client_id` absent ou nul passait sans encombre alors que le
 * rendez-vous a bien une cliente (un ticket d'un seul produit n'a pas besoin de cliente,
 * `vente.cliente_obligatoire` ne l'aurait pas arrêté avant). Même refus désormais, qu'elle soit une
 * autre cliente ou qu'elle manque.
 */
test("cliente du ticket absente ou nulle alors que le rendez-vous en a une : même refus", async (t) => {
  const { g, p, mine, product } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const produit = (extra: Record<string, unknown>) => ({
    request_id: "prat-cliente-produit", appointment_id: mine, lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }], ...extra,
  });
  const nulle = await p("POST", "/api/sales", produit({ request_id: "prat-cliente-03", client_id: null }), FR);
  assert.deepEqual([nulle.status, nulle.body.error], [403, "Une praticienne n'encaisse que la cliente de son rendez-vous."]);
  const absente = await p("POST", "/api/sales", produit({ request_id: "prat-cliente-04" }), FR);
  assert.deepEqual([absente.status, absente.body.error], [403, "Une praticienne n'encaisse que la cliente de son rendez-vous."]);
});

test("rendez-vous à venir (booked) : refus, le statut ne change pas", async (t) => {
  const { g, p, own, client, service } = await setup(t);
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: own, scheduled_date: "2026-10-05", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.status, "booked");
  const refused = await p("POST", "/api/sales", {
    request_id: "prat-avenir-0001", client_id: client, appointment_id: apt, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: own }], payments: [{ method: "cash", amount: 25000 }],
  }, FR);
  assert.deepEqual([refused.status, refused.body.error], [403, "Une praticienne n'encaisse qu'un rendez-vous en cours ou terminé."]);
  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.status, "booked");
});

test("gérante et réception : reprise, PDF et rejeu d'un request_id toujours inchangés", async (t) => {
  const { ctx, g, product } = await setup(t);
  const r = await ctx.as("reception");
  const sale1 = await g("POST", "/api/sales", { request_id: "gerante-inchangee-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  assert.equal(sale1.status, 201, JSON.stringify(sale1.body));
  assert.equal((await g("GET", "/api/sales/gerante-inchangee-1")).body.invoice.id, sale1.body.invoice.id);
  assert.equal((await r("GET", `/api/invoices/${sale1.body.invoice.id}/pdf`)).status, 200);
  const replay = await r("POST", "/api/sales", { request_id: "gerante-inchangee-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  assert.equal(replay.status, 200, "même request_id : la facture existante, sans refus (rôle non praticienne)");
  assert.equal(replay.body.invoice.id, sale1.body.invoice.id);
});

test("fidélité : la praticienne ne reçoit aucun point (vente, rejeu, relecture) ; la gérante les voit", async (t) => {
  const { g, p, mine, sale } = await setup(t);
  assert.equal((await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true })).status, 200);
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: true })).status, 200);
  const made = await p("POST", "/api/sales", sale(mine, "prat-fid-0001"));
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.ok(!made.body.invoice.loyalty, "réponse 201 sans fidélité");
  const replay = await p("POST", "/api/sales", sale(mine, "prat-fid-0001"));
  assert.equal(replay.status, 200);
  assert.ok(!replay.body.invoice.loyalty, "rejeu sans fidélité");
  const read = await p("GET", "/api/sales/prat-fid-0001");
  assert.equal(read.status, 200);
  assert.ok(!read.body.invoice.loyalty, "relecture sans fidélité");
  const manager = await g("GET", "/api/sales/prat-fid-0001");
  assert.equal(manager.body.invoice.loyalty.earned, 25, "la gérante voit les points");
});
