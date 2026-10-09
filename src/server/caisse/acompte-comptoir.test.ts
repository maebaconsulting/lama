import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { readDeposit } from "./acompte.ts";
import { depositTicket } from "./acompte-routes.ts";
import { ticketRows } from "./ticket.ts";

/**
 * V1-78 : un acompte en attente se déduit d'une vente au comptoir qui ne
 * contient que des produits, pour la même cliente, une fois son rendez-vous
 * annulé ou manqué ; le rendez-vous n'est pas touché.
 */

const FR = { "Accept-Language": "fr" };

async function scene(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const aicha = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const fatou = (await g("POST", "/api/clients", { name: "Fatou Diop" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Tresses", duration: 120, price: 20000 })).body.service.id as number;
  const huile = (await g("POST", "/api/products", { name: "Huile de coco", price: 6000, stock: 5 })).body.product.id as number;
  const savon = (await g("POST", "/api/products", { name: "Savon noir", price: 3000, stock: 5 })).body.product.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: aicha, scheduled_date: "2026-10-05", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const dep = (await r("POST", "/api/deposits", { request_id: "comptoir-acompte-01", appointment_id: apt, amount: 5000, payments: [{ method: "cash", amount: 5000 }] })).body.deposit;
  return { ctx, g, r, aicha, fatou, service, huile, savon, apt, dep };
}

test("acompte d'un rendez-vous annulé déduit d'une vente de produits seuls : même cliente, montant au plus le total, rendez-vous intact", async (t) => {
  const { ctx, g, r, aicha, fatou, service, huile, savon, apt, dep } = await scene(t);
  const sale = (over: Record<string, unknown>) => ({
    request_id: "comptoir-vente-01", client_id: aicha, appointment_id: null, deposit_id: dep.id,
    lines: [{ kind: "product", ref_id: huile, quantity: 1 }], payments: [{ method: "cash", amount: 1000 }], ...over,
  });

  // Rendez-vous encore à venir : l'acompte reste attaché, il n'est pas proposé.
  assert.deepEqual((await r("GET", `/api/deposits?client_id=${aicha}`)).body.deposits, []);
  const upcoming = await r("POST", "/api/sales", sale({}), FR);
  assert.deepEqual([upcoming.status, upcoming.body.error], [409, "L'acompte AC-2026-000001 reste attaché à son rendez-vous, ni annulé ni manqué\u00a0: il se déduit à l'encaissement de ce rendez-vous."]);

  await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" });
  assert.deepEqual((await r("GET", `/api/deposits?client_id=${aicha}`)).body.deposits.map((d: { number: string }) => d.number), ["AC-2026-000001"]);
  assert.equal((await r("GET", "/api/deposits?client_id=abc")).status, 400);

  // Vente avec un rendez-vous, ou avec une prestation : refusée en 400.
  const withApt = await r("POST", "/api/sales", sale({ appointment_id: apt }), FR);
  assert.deepEqual([withApt.status, withApt.body.error], [400, "Un acompte se déduit au comptoir seulement d'une vente sans rendez-vous qui ne contient que des produits."]);
  assert.equal((await r("POST", "/api/sales", sale({ lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: null }] }))).status, 400);
  assert.equal((await r("POST", "/api/sales", sale({ deposit_id: "abc" }))).status, 400);
  assert.equal((await r("POST", "/api/sales", sale({ deposit_id: 999 }))).status, 404);

  // Autre cliente, ou vente sans cliente : refusée.
  const other = await r("POST", "/api/sales", sale({ client_id: fatou }), FR);
  assert.deepEqual([other.status, other.body.code], [409, "acompte"]);
  assert.equal((await r("POST", "/api/sales", sale({ client_id: null }))).status, 409);

  // Acompte plus gros que le total : refus qui dit quoi faire au comptoir.
  const tooBig = await r("POST", "/api/sales", sale({ lines: [{ kind: "product", ref_id: savon, quantity: 1 }], payments: [] }), FR);
  assert.deepEqual([tooBig.status, tooBig.body.error], [409, "L'acompte AC-2026-000001 (5\u202f000\u00a0F) dépasse le total à payer (3\u202f000\u00a0F)\u00a0: ajoutez des produits ou ne le déduisez pas."]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0, "aucun refus ne prend un numéro");

  // Vente acceptée : 6 000 F, 5 000 déjà reçus, 1 000 en espèces.
  const done = await r("POST", "/api/sales", sale({}));
  assert.equal(done.status, 201, JSON.stringify(done.body));
  assert.deepEqual(done.body.invoice.deposits.map((d: { number: string; amount: number }) => [d.number, d.amount]), [["AC-2026-000001", 5000]]);
  const after = (await g("GET", `/api/deposits/${dep.id}`)).body.deposit;
  assert.deepEqual([after.status, after.applied_invoice_number], ["applied", done.body.invoice.number]);
  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.status, "cancelled", "le rendez-vous n'est pas touché");
  // V1-79 : le reçu d'un acompte déduit au comptoir porte le numéro de la facture, aussi par le PDF.
  const receipt = ctx.env.STORAGE.transaction!((db) => readDeposit(db, dep.id))!;
  const lines = ticketRows(depositTicket(receipt)).flatMap((row) => (row.type === "text" ? [row.text] : []));
  assert.ok(lines.some((l) => l.startsWith(`Déduit de la facture ${done.body.invoice.number} le `)), JSON.stringify(lines));
  assert.equal((await g("GET", `/api/deposits/${dep.id}/pdf`)).status, 200);
  assert.equal((ctx.db.prepare("SELECT stock FROM products WHERE id = ?").get(huile) as { stock: number }).stock, 4);

  // Rejeu : la même facture ; autre vente avec le même acompte : déjà déduit.
  const again = await r("POST", "/api/sales", sale({}));
  assert.deepEqual([again.status, again.body.invoice.id], [200, done.body.invoice.id]);
  const twice = await r("POST", "/api/sales", sale({ request_id: "comptoir-vente-02" }), FR);
  assert.deepEqual([twice.status, twice.body.error], [409, "Cet acompte a déjà été déduit, remboursé ou gardé."]);
  assert.deepEqual((await r("GET", `/api/deposits?client_id=${aicha}`)).body.deposits, []);
});

test("deux acomptes en attente : liste du plus ancien au plus récent ; acompte remboursé entre-temps : vente refusée sans rien écrire", async (t) => {
  const { ctx, g, r, aicha, service, huile, apt, dep } = await scene(t);
  const apt2 = (await g("POST", "/api/appointments", { client_id: aicha, scheduled_date: "2026-10-06", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const dep2 = (await r("POST", "/api/deposits", { request_id: "comptoir-acompte-02", appointment_id: apt2, amount: 2000, payments: [{ method: "cash", amount: 2000 }] })).body.deposit;
  await g("PUT", `/api/appointments/${apt2}`, { status: "no_show" });
  await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" });
  assert.deepEqual((await r("GET", `/api/deposits?client_id=${aicha}`)).body.deposits.map((d: { id: number }) => d.id), [dep.id, dep2.id]);

  // La gérante rembourse l'acompte pendant que la réception prépare la vente.
  assert.equal((await g("POST", `/api/deposits/${dep.id}/settle`, { request_id: "comptoir-rembourse-01", action: "refund", refunds: [{ method: "cash", amount: 5000 }] })).status, 201);
  const late = await r("POST", "/api/sales", {
    request_id: "comptoir-vente-03", client_id: aicha, deposit_id: dep.id, lines: [{ kind: "product", ref_id: huile, quantity: 1 }], payments: [{ method: "cash", amount: 1000 }],
  });
  assert.equal(late.status, 409);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
  assert.equal((ctx.db.prepare("SELECT stock FROM products WHERE id = ?").get(huile) as { stock: number }).stock, 5, "le stock n'a pas bougé");
  assert.deepEqual((await r("GET", `/api/deposits?client_id=${aicha}`)).body.deposits.map((d: { id: number }) => d.id), [dep2.id]);
});
