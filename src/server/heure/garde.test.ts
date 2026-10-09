import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Caller } from "../test-support.ts";
import { heureRecule, instantDouala, MARGE_RECUL_MS } from "./garde.ts";

/**
 * Caisse gardée contre une heure qui recule (distribution D-13) : vente, avoir
 * et acompte refusés (409, `code: "heure"`) quand l'heure du serveur est
 * antérieure de plus d'une minute au dernier document émis ; état lu par
 * `GET /api/heure` (administrateur et gérante).
 */

const FR = { "Accept-Language": "fr" };
const T = Date.parse("2026-10-05T13:00:00Z");

test("recul : au-delà d'une minute seulement ; aucune facture, jamais bloqué", () => {
  assert.equal(MARGE_RECUL_MS, 60_000);
  assert.equal(heureRecule(null, 0), false);
  assert.equal(heureRecule(T, T - 60_000), false, "une minute pile : toléré");
  assert.equal(heureRecule(T, T - 60_001), true);
  assert.equal(heureRecule(T, T + 3_600_000), false, "l'heure qui avance n'est pas bloquée");
  assert.equal(instantDouala(T), "05/10/2026 14:00");
});

/** Rendez-vous de demain avec un soin à 25 000, une crème en stock ; acomptes activés. */
async function caisse(g: Caller) {
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", duration: 60, price: 25000 })).body.service.id as number;
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 5 })).body.product.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-10-06", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;
  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: true })).status, 200);
  const cream = (requestId: string) => g("POST", "/api/sales", { request_id: requestId, lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] }, FR);
  return { apt, cream };
}

test("heure du serveur reculée de plus d'une minute : vente, avoir et acompte refusés en 409 ; une reprise rend le document déjà émis", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  ctx.clock.now = T;
  const g = await ctx.as("manager");
  const { apt, cream } = await caisse(g);
  const vente = await cream("heure-vente-0001");
  assert.equal(vente.status, 201, JSON.stringify(vente.body));
  const invoice = vente.body.invoice;

  ctx.clock.now = T - 2 * 60_000;
  const refus = await cream("heure-vente-0002");
  assert.equal(refus.status, 409);
  assert.equal(refus.body.code, "heure");
  assert.equal(refus.body.error, "L'heure du serveur est antérieure au dernier document émis (facture, avoir ou acompte) (05/10/2026 14:00)\u00a0: ventes, avoirs et acomptes sont bloqués. L'administrateur remet le serveur à l'heure dans «\u00a0Réglages\u00a0», «\u00a0Heure\u00a0».");
  const en = await g("POST", "/api/sales", { request_id: "heure-vente-0003", lines: [{ kind: "product", ref_id: invoice.lines[0].ref_id, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] }, { "Accept-Language": "en" });
  assert.match(en.body.error, /^The server time is earlier than the last issued document \(invoice, credit note or deposit\) \(05\/10\/2026 14:00\)/);
  const avoir = await g("POST", "/api/credit-notes", {
    request_id: "heure-avoir-0001", invoice_id: invoice.id, reason: "Erreur", lines: [{ line_id: invoice.lines[0].id, quantity: 1, restock: true }], refunds: [{ method: "cash", amount: 35000 }],
  }, FR);
  assert.deepEqual([avoir.status, avoir.body.code], [409, "heure"]);
  const acompte = await g("POST", "/api/deposits", { request_id: "heure-acompte-0001", appointment_id: apt, amount: 10000, payments: [{ method: "cash", amount: 10000 }] }, FR);
  assert.deepEqual([acompte.status, acompte.body.code], [409, "heure"]);
  assert.equal((await cream("heure-vente-0001")).status, 200, "reprise du même request_id : la facture déjà émise, sans refus");
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get()!.n, 1, "rien d'émis, aucun numéro pris");

  ctx.clock.now = T - 30_000;
  assert.equal((await cream("heure-vente-0004")).status, 201, "recul de 30 s : toléré");
});

test("un acompte daté après la dernière facture garde aussi la caisse", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  ctx.clock.now = T;
  const g = await ctx.as("manager");
  const { apt, cream } = await caisse(g);
  const acompte = await g("POST", "/api/deposits", { request_id: "heure-acompte-0002", appointment_id: apt, amount: 10000, payments: [{ method: "cash", amount: 10000 }] });
  assert.equal(acompte.status, 201, JSON.stringify(acompte.body));
  ctx.clock.now = T - 5 * 60_000;
  assert.equal((await cream("heure-vente-0005")).body.code, "heure");
});

test("GET /api/heure : heure du serveur, dernière facture, caisse bloquée ; administrateur et gérante seulement", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  ctx.clock.now = T;
  const g = await ctx.as("manager");
  const admin = await ctx.as("admin");
  assert.deepEqual((await admin("GET", "/api/heure")).body, { serveur: T, derniere_facture: null, caisse_bloquee: false });
  const { cream } = await caisse(g);
  await cream("heure-vente-0006");
  ctx.clock.now = T - 10 * 60_000;
  assert.deepEqual((await g("GET", "/api/heure")).body, { serveur: T - 10 * 60_000, derniere_facture: T, caisse_bloquee: true });
  for (const role of ["reception", "practitioner"] as const) assert.equal((await (await ctx.as(role))("GET", "/api/heure")).status, 403, role);
});
