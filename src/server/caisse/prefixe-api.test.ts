import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Caller } from "../test-support.ts";

/**
 * Préfixe des factures par l'API (distribution D-01) : l'administrateur le
 * règle (mot de passe confirmé) tant qu'aucune facture n'existe ; refus
 * lisible d'un préfixe mal formé ; 409 en français et en anglais dès la
 * première facture ; la gérante le lit, figé ou non, sans pouvoir l'écrire ;
 * un changement concurrent d'une première vente reste cohérent.
 */

const FR = { "Accept-Language": "fr" };
const PASSWORD = "mot-de-passe-test";

/** Administrateur confirmé, gérante, et une vente de comptoir prête à émettre. */
async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t, { demo: false });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: PASSWORD });
  const gerante = await ctx.as("manager");
  const product = (await gerante("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 5 })).body.product.id as number;
  const sell = (requestId: string) => gerante("POST", "/api/sales", {
    request_id: requestId, lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }],
  });
  return { ctx, admin, gerante, sell };
}

/** Le réglage tel que l'écran le reçoit. */
async function seen(call: Caller) {
  return (await call("GET", "/api/settings")).body.settings.find((s: { key: string }) => s.key === "caisse.prefixe");
}

test("installation neuve : FAC par défaut ; l'administrateur règle « xyz » (mis en majuscules) avant la première vente, qui prend XYZ", async (t) => {
  const { admin, gerante, sell } = await setup(t);
  assert.deepEqual(await seen(admin), { key: "caisse.prefixe", secret: false, value: "FAC", set: true, editable: true, frozen: null });
  const put = await admin("PUT", "/api/settings/caisse.prefixe", { value: " xyz " });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await seen(admin)).value, "XYZ");
  const sale = await sell("prefixe-0001");
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  assert.equal(sale.body.invoice.number, "XYZ-2026-000001");
  assert.deepEqual(await seen(gerante), { key: "caisse.prefixe", secret: false, value: "XYZ", set: true, editable: false, frozen: { numero: "XYZ-2026-000001" } });
});

test("préfixe mal formé : refus lisible en français et en anglais, rien d'écrit", async (t) => {
  const { ctx, admin } = await setup(t);
  for (const value of ["X", "ABCDEFG", "AB-C", "AV", "ac", "", 12, "2026", "12"]) {
    const res = await admin("PUT", "/api/settings/caisse.prefixe", { value }, FR);
    assert.equal(res.status, 400, String(value));
    assert.equal(res.body.error, "Préfixe des factures attendu\u00a0: 2 à 6 lettres ou chiffres, dont au moins une lettre, ni AV ni AC.");
  }
  assert.equal((await admin("PUT", "/api/settings/caisse.prefixe", { value: "A-B" })).body.error, "Invoice prefix expected: 2 to 6 letters or digits, at least one letter, neither AV nor AC.");
  assert.equal(ctx.db.prepare("SELECT 1 FROM settings WHERE key = 'caisse.prefixe'").get(), undefined);
});

test("droits : la gérante lit sans écrire, la réception et la praticienne ne le voient pas ; l'administrateur confirme son mot de passe", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", "/api/settings/caisse.prefixe", { value: "XYZ" })).status, 403);
  assert.equal((await seen(gerante)).editable, false);
  for (const role of ["reception", "practitioner"] as const) {
    const res = await (await ctx.as(role))("GET", "/api/settings");
    const keys = res.status === 200 ? res.body.settings.map((s: { key: string }) => s.key) : [];
    assert.ok(!keys.includes("caisse.prefixe"), `${role} : ${res.status}`);
  }
  const admin = await ctx.as("admin");
  assert.equal((await admin("PUT", "/api/settings/caisse.prefixe", { value: "XYZ" })).body.code, "confirmation");
});

test("après la première facture : 409 au message clair en français et en anglais, même pour la même valeur ; journal sans écriture", async (t) => {
  const { ctx, admin, sell } = await setup(t);
  assert.equal((await sell("prefixe-0002")).body.invoice.number, "FAC-2026-000001");
  const fr = await admin("PUT", "/api/settings/caisse.prefixe", { value: "XYZ" }, FR);
  assert.deepEqual([fr.status, fr.body.error], [409, "Le préfixe des factures ne change plus\u00a0: la facture FAC-2026-000001 a déjà été émise avec lui."]);
  const en = await admin("PUT", "/api/settings/caisse.prefixe", { value: "FAC" });
  assert.deepEqual([en.status, en.body.error], [409, "The invoice prefix can no longer change: invoice FAC-2026-000001 has already been issued with it."]);
  assert.deepEqual(await seen(admin), { key: "caisse.prefixe", secret: false, value: "FAC", set: true, editable: false, frozen: { numero: "FAC-2026-000001" } });
  assert.equal(ctx.db.prepare("SELECT 1 FROM audit_log WHERE action = 'reglage' AND target = 'caisse.prefixe'").get(), undefined);
  assert.equal((await sell("prefixe-0003")).body.invoice.number, "FAC-2026-000002", "la suite continue");
});

test("changement du préfixe et première vente lancés ensemble : jamais une facture d'un préfixe et un réglage d'un autre", async (t) => {
  for (let round = 0; round < 5; round++) {
    const { ctx, admin, sell } = await setup(t);
    const [put, sale] = await Promise.all([admin("PUT", "/api/settings/caisse.prefixe", { value: "XYZ" }), sell(`course-${round}`)]);
    assert.equal(sale.status, 201, JSON.stringify(sale.body));
    const prefix = (await seen(admin)).value as string;
    assert.ok(sale.body.invoice.number.startsWith(`${prefix}-`), `${put.status} ${sale.body.invoice.number} ${prefix}`);
    assert.ok(put.status === 200 ? prefix === "XYZ" : put.status === 409 && prefix === "FAC", `${put.status} ${prefix}`);
    const series = ctx.db.prepare("SELECT DISTINCT series FROM invoices WHERE kind = 'invoice'").all().map((r) => (r as { series: string }).series);
    assert.deepEqual(series, [prefix]);
  }
});
