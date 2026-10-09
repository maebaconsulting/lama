import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { resourceFor } from "../realtime.ts";
import { setupApp } from "../test-support.ts";

/**
 * API de la clôture de caisse (sous-projet 5 § 6.3) : caisse du jour
 * (gérante et réception), clôture enregistrée avec la personne et l'heure,
 * idempotente, au journal, imprimable en ticket de 80 mm.
 */

const FR = { "Accept-Language": "fr" };

test("caisse du jour puis clôture : écart, journal, ticket PDF ; réception oui, praticienne non", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 3 })).body.product.id;
  const sale = await r("POST", "/api/sales", { request_id: "cloture-api-01", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "cash", amount: 35000, cash_given: 40000 }] });
  assert.equal(sale.status, 201);

  const day = (await r("GET", "/api/cash/day")).body;
  assert.equal(day.day, "2026-09-28", "aujourd'hui à Douala par défaut");
  assert.deepEqual([day.closings, day.open.count, day.open.summary.cash_expected, day.documents.map((d: { number: string }) => d.number)], [[], 1, 35000, ["FAC-2026-000001"]]);

  ctx.clock.now += 3_600_000;
  const body = { request_id: "cloture-api-001", day: "2026-09-28", cash_counted: 34000, note: "Billet abîmé" };
  const closed = await r("POST", "/api/cash/closings", body);
  assert.equal(closed.status, 201, JSON.stringify(closed.body));
  assert.deepEqual([closed.body.closing.seq, closed.body.closing.cash_expected, closed.body.closing.difference, closed.body.closing.account_name], [1, 35000, -1000, "reception"]);
  assert.equal((await r("POST", "/api/cash/closings", body)).status, 200, "même request_id : la clôture déjà faite");
  const empty = await g("POST", "/api/cash/closings", { ...body, request_id: "cloture-api-002" }, FR);
  assert.deepEqual([empty.status, empty.body.error], [409, "Rien n'a été encaissé depuis la dernière clôture de ce jour."]);

  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'caisse.cloture'").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [{ action: "caisse.cloture", target: "2026-09-28 n°\u00a01 (\u22121\u202f000\u00a0F)" }]);
  assert.equal(auditAction("caisse.cloture", "fr"), "Caisse clôturée");
  assert.equal(auditAction("caisse.cloture", "en"), "Till closed");
  assert.equal(resourceFor("/api/cash/closings"), "invoices");

  const pdf = await g("GET", `/api/cash/closings/${closed.body.closing.id}/pdf?telecharger=1`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="cloture-2026-09-28-1.pdf"');
  assert.equal(String(pdf.body).slice(0, 5), "%PDF-");
  assert.equal((await g("GET", "/api/cash/closings/999/pdf")).status, 404);

  const p = await ctx.as("practitioner");
  assert.equal((await p("GET", "/api/cash/day")).status, 403);
  assert.equal((await p("POST", "/api/cash/closings", { ...body, request_id: "cloture-api-003" })).status, 403);
  assert.equal((await g("GET", "/api/cash/day?date=2026-13-01")).status, 400);
});
