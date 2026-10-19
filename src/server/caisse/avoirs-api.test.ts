import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { resourceFor } from "../realtime.ts";
import { setupApp, type Caller } from "../test-support.ts";
import { ticketRows, type TicketDocument } from "./ticket.ts";

/**
 * API des avoirs (sous-projet 5 § 6.1, § 3.4) : émission depuis une facture,
 * droits (gérante ; réception si la gérante l'autorise), rendez-vous de
 * nouveau à encaisser après un avoir total, fiche du rendez-vous qui vise
 * la facture encore active, factures d'une cliente, ticket PDF de l'avoir.
 */

const FR = { "Accept-Language": "fr" };

/** Rendez-vous encaissé : soin 25 000 et crème 35 000 (stock 3 puis 2), payé en espèces. */
async function paidAppointment(g: Caller) {
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", name_en: "Radiance facial", duration: 60, price: 25000 })).body.service.id as number;
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 3 })).body.product.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-28", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;
  const sale = await g("POST", "/api/sales", {
    request_id: "rdv-avoir-0001", client_id: client, appointment_id: apt,
    lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }, { kind: "product", ref_id: product, quantity: 1 }],
    payments: [{ method: "cash", amount: 60000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const invoice = sale.body.invoice;
  return { staff, client, service, product, apt, invoice, lines: invoice.lines.map((l: { id: number }) => l.id) as number[] };
}

test("avoir total : rendez-vous de nouveau à encaisser, stock rendu, nouvel encaissement visé par la fiche", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { client, service, product, apt, invoice, lines, staff } = await paidAppointment(g);
  const before = (await g("GET", `/api/invoices/${invoice.id}`)).body.invoice;
  assert.deepEqual([before.credited_total, before.cancelled, before.credits, before.lines.map((l: { credited: number }) => l.credited)], [0, false, [], [0, 0]]);

  const body = {
    request_id: "avoir-total-0001", invoice_id: invoice.id, reason: "Cliente mécontente",
    lines: [{ line_id: lines[0], quantity: 1 }, { line_id: lines[1], quantity: 1, restock: true }],
    refunds: [{ method: "cash", amount: 60000 }],
  };
  const res = await g("POST", "/api/credit-notes", body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const note = res.body.credit_note;
  assert.deepEqual([note.kind, note.number, note.credited_number, note.credited_invoice_id, note.total_ttc, note.reason, note.account_name],
    ["credit_note", "AV-2026-000001", "FAC-2026-000001", invoice.id, 60000, "Cliente mécontente", "manager"]);
  assert.deepEqual(note.payments, [{ method: "cash", amount: -60000, reference: "", cash_given: null, change_given: 0 }]);
  assert.deepEqual(note.lines.map((l: { restock: number; credited_line_id: number }) => [l.credited_line_id, l.restock]), [[lines[0], 0], [lines[1], 1]]);
  assert.equal((await g("POST", "/api/credit-notes", body)).status, 200, "même request_id : l'avoir déjà émis");
  assert.equal((await g("GET", `/api/products/${product}`)).body.product.stock, 3);

  const after = (await g("GET", `/api/invoices/${invoice.id}`)).body.invoice;
  assert.deepEqual([after.credited_total, after.cancelled, after.credits.map((c: { number: string }) => c.number), after.lines.map((l: { credited: number }) => l.credited)],
    [60000, true, ["AV-2026-000001"], [1, 1]]);
  const unpaid = (await g("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.deepEqual([unpaid.paid, unpaid.invoice_id, unpaid.invoice_number], [0, null, null], "facture entièrement reprise : rendez-vous non payé");
  // Correctif final (point 1) : « Supprimer » reste masqué, une facture ayant existé pour ce rendez-vous (même reprise).
  assert.equal(unpaid.invoiced, 1, "facture entièrement reprise : toujours invoiced, « Supprimer » reste masqué");

  const again = await g("POST", "/api/sales", {
    request_id: "rdv-avoir-0002", client_id: client, appointment_id: apt,
    lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }], payments: [{ method: "card", amount: 25000 }],
  });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  const paid = (await g("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.deepEqual([paid.paid, paid.invoice_id, paid.invoice_number, paid.invoice_total], [1, again.body.invoice.id, "FAC-2026-000002", 25000], "la fiche vise la facture active, pas l'ancienne");
  const day = (await g("GET", "/api/calendar?start=2026-09-28&end=2026-09-28")).body.appointments[0];
  assert.deepEqual([day.paid, day.invoice_number], [1, "FAC-2026-000002"]);
  const third = await g("POST", "/api/sales", { request_id: "rdv-avoir-0003", client_id: client, appointment_id: apt, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "card", amount: 25000 }] }, FR);
  assert.deepEqual([third.status, third.body.error], [409, "Ce rendez-vous est déjà encaissé (facture FAC-2026-000002)."]);
  assert.equal((await g("DELETE", `/api/appointments/${apt}`)).status, 409, "un rendez-vous facturé ne se supprime toujours pas");

  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'avoir.emis'").all().map((r) => ({ ...r }));
  assert.deepEqual(journal, [{ action: "avoir.emis", target: "AV-2026-000001 (60\u202f000\u00a0FCFA, FAC-2026-000001)" }]);
  assert.equal(auditAction("avoir.emis", "fr"), "Avoir émis");
  assert.equal(auditAction("avoir.emis", "en"), "Credit note issued");
  assert.equal(resourceFor("/api/credit-notes"), "invoices");
});

test("avoir partiel : le rendez-vous reste payé ; refus traduits (quantité, remboursement), rien d'écrit", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { apt, invoice, lines } = await paidAppointment(g);
  const tooMany = await g("POST", "/api/credit-notes", { request_id: "avoir-trop-0001", invoice_id: invoice.id, reason: "Erreur", lines: [{ line_id: lines[1], quantity: 2 }], refunds: [{ method: "cash", amount: 70000 }] }, FR);
  assert.deepEqual([tooMany.status, tooMany.body.error], [409, "«\u00a0Crème hydratante\u00a0»\u00a0: 1 au plus à reprendre."]);
  const wrong = await g("POST", "/api/credit-notes", { request_id: "avoir-faux-0001", invoice_id: invoice.id, reason: "Erreur", lines: [{ line_id: lines[1], quantity: 1 }], refunds: [{ method: "cash", amount: 30000 }] });
  assert.deepEqual([wrong.status, wrong.body.code, wrong.body.due], [409, "total", 35000]);
  assert.equal((await g("POST", "/api/credit-notes", { request_id: "avoir-inconnu-1", invoice_id: 999, reason: "x", lines: [{ line_id: 1, quantity: 1 }], refunds: [] })).status, 404);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 1);
  const ok = await g("POST", "/api/credit-notes", { request_id: "avoir-creme-001", invoice_id: invoice.id, reason: "Produit défectueux", lines: [{ line_id: lines[1], quantity: 1 }], refunds: [{ method: "cash", amount: 35000 }] });
  assert.equal(ok.status, 201);
  const seen = (await g("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.deepEqual([seen.paid, seen.invoice_number], [1, "FAC-2026-000001"], "avoir partiel : toujours payé");
});

// Correctif final (point 3) : rejeu de POST /api/sales avec l'identifiant d'un avoir.
test("POST /api/sales rejoué avec le request_id d'un avoir : 409, jamais confondu avec une vente", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { invoice, lines } = await paidAppointment(g);
  const creditRequestId = "avoir-rejeu-0001";
  const credit = await g("POST", "/api/credit-notes", {
    request_id: creditRequestId, invoice_id: invoice.id, reason: "Produit défectueux",
    lines: [{ line_id: lines[1], quantity: 1 }], refunds: [{ method: "cash", amount: 35000 }],
  });
  assert.equal(credit.status, 201, JSON.stringify(credit.body));
  const replay = await g("POST", "/api/sales", { request_id: creditRequestId, lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 1000 }] }, FR);
  assert.deepEqual([replay.status, replay.body.error], [409, "Identifiant de vente manquant ou invalide."]);
  assert.equal(replay.body.invoice, undefined, "jamais l'avoir rendu comme une facture");
});

test("droits : gérante ; réception seulement si la gérante l'autorise ; praticienne jamais", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  const { invoice, lines } = await paidAppointment(g);
  const body = { request_id: "avoir-reception1", invoice_id: invoice.id, reason: "Erreur de saisie", lines: [{ line_id: lines[1], quantity: 1 }], refunds: [{ method: "cash", amount: 35000 }] };
  const refused = await r("POST", "/api/credit-notes", body, FR);
  assert.deepEqual([refused.status, refused.body.error], [403, "Les avoirs sont réservés à la gérante."]);
  assert.equal((await r("GET", "/api/sales/settings")).body.avoirs_reception, false);
  assert.equal((await g("PUT", "/api/settings/caisse.avoirs_reception", { value: true })).status, 200);
  assert.equal((await r("GET", "/api/sales/settings")).body.avoirs_reception, true);
  assert.equal((await r("POST", "/api/credit-notes", body)).status, 201);
  assert.equal((await p("POST", "/api/credit-notes", { ...body, request_id: "avoir-pratic-001" })).status, 403);
});

test("factures d'une cliente, du plus récent au plus ancien, avec ce que les avoirs ont repris ; factures du jour aussi", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { client, invoice, lines } = await paidAppointment(g);
  ctx.clock.now += 60_000;
  await g("POST", "/api/credit-notes", { request_id: "avoir-liste-001", invoice_id: invoice.id, reason: "Produit défectueux", lines: [{ line_id: lines[1], quantity: 1 }], refunds: [{ method: "card", amount: 35000 }] });
  const list = (await g("GET", `/api/invoices?client_id=${client}`)).body.invoices;
  assert.deepEqual(list.map((i: Record<string, unknown>) => [i.kind, i.number, i.total_ttc, i.credited_number, i.credited_total, i.cancelled]), [
    ["credit_note", "AV-2026-000001", 35000, "FAC-2026-000001", 0, 0],
    ["invoice", "FAC-2026-000001", 60000, null, 35000, 0],
  ]);
  assert.equal((await g("GET", "/api/invoices?client_id=abc")).status, 400);
  const today = (await g("GET", "/api/invoices?date=2026-09-28")).body.invoices;
  assert.deepEqual(today.map((i: Record<string, unknown>) => [i.number, i.credited_total, i.account_name]), [["FAC-2026-000001", 35000, "manager"], ["AV-2026-000001", 0, "manager"]]);
});

test("ticket de l'avoir : « AVOIR », facture corrigée, motif, « Établi par », remboursement", async (t) => {
  const seen: TicketDocument[] = [];
  const RENDER_TICKET = async (doc: TicketDocument) => { seen.push(doc); return Buffer.from("%PDF-1.3 essai"); };
  const ctx = await setupApp(t, { demo: false, bindings: { RENDER_TICKET } });
  const g = await ctx.as("manager");
  const { invoice, lines } = await paidAppointment(g);
  const note = (await g("POST", "/api/credit-notes", { request_id: "avoir-ticket-01", invoice_id: invoice.id, reason: "Produit défectueux", lines: [{ line_id: lines[1], quantity: 1, restock: true }], refunds: [{ method: "cash", amount: 35000 }] })).body.credit_note;
  const pdf = await g("GET", `/api/invoices/${note.id}/pdf?telecharger=1`);
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="AV-2026-000001.pdf"');
  const text = ticketRows(seen[0]).map((r) => (r.type === "pair" ? `${r.left} | ${r.right}` : r.type === "text" ? r.text : r.type));
  for (const expected of ["AVOIR", "AV-2026-000001", "Facture corrigée\u00a0: FAC-2026-000001", "Motif\u00a0: Produit défectueux", "Établi par manager", "Remboursement", "Espèces | 35\u00a0000\u00a0FCFA"]) {
    assert.ok(text.includes(expected), expected);
  }
});
