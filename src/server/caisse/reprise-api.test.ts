import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/**
 * Reprise d'une vente dont la réponse s'est perdue (sous-projet 5 § 7,
 * report de la vague 2) : `GET /api/sales/:request_id` rend la facture émise
 * pour cette vente, ou dit qu'aucune ne l'a été (l'écran peut alors dégeler
 * le ticket sans risque de doublon).
 */

const FR = { "Accept-Language": "fr" };

test("vente retrouvée par son request_id : la facture émise, pour la gérante et la réception", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 3 })).body.product.id;
  const sale = await r("POST", "/api/sales", { request_id: "v-reprise-0001", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  assert.equal(sale.status, 201);
  for (const caller of [g, r]) {
    const found = await caller("GET", "/api/sales/v-reprise-0001");
    assert.equal(found.status, 200);
    assert.equal(found.body.invoice.id, sale.body.invoice.id);
    assert.equal(found.body.invoice.number, "FAC-2026-000001");
    assert.equal(found.body.invoice.lines.length, 1);
  }
});

test("vente jamais émise : 404 avec le code « absente », message traduit ; identifiant mal formé : 400", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const missing = await g("GET", "/api/sales/v-jamais-emise", undefined, { "Accept-Language": "fr" });
  assert.deepEqual([missing.status, missing.body], [404, { error: "Aucune facture émise pour cette vente.", code: "absente" }]);
  const en = await g("GET", "/api/sales/v-jamais-emise");
  assert.equal(en.body.error, "No invoice was issued for this sale.");
  const bad = await g("GET", "/api/sales/court");
  assert.equal(bad.status, 400);
  assert.equal((await g("GET", "/api/sales/settings")).body.vat_rate, 19.25, "les réglages de la vente restent à leur adresse");
});

test("la praticienne ne retrouve pas la vente d'une autre personne : 403 (facture existante, droit refusé), jamais la fausse « absente »", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 3 })).body.product.id;
  await g("POST", "/api/sales", { request_id: "v-reprise-0001", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  const p = await ctx.as("practitioner");
  // Correctif final (point 4) : une facture existe pour ce request_id, mais la praticienne n'a pas le droit de la
  // lire (réglage désactivé) : 403 traduit, jamais 404 « absente » (qui ferait dire à l'écran que la vente n'a pas été émise).
  const refused = await p("GET", "/api/sales/v-reprise-0001", undefined, FR);
  assert.deepEqual([refused.status, refused.body.error, refused.body.code], [403, "Accès refusé.", undefined]);
});
