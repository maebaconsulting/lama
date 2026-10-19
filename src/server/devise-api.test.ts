import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

const PASSWORD = "mot-de-passe-test";

async function setup(t: { after: (fn: () => void) => void }) {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  await gerante("POST", "/api/auth/confirm", { password: PASSWORD });
  return { ctx, gerante };
}

test("état public : devise XAF par défaut, position de la devise, symbole affiché", async (t) => {
  const { ctx } = await setup(t);
  const anon = ctx.anonymous();
  const state = await anon("GET", "/api/auth/state");
  assert.deepEqual(state.body.devise, { code: "XAF", position: null, symboleEcran: true });
});

test("position et affichage du symbole : enregistrés par la gérante, appliqués tout de suite", async (t) => {
  const { ctx, gerante } = await setup(t);
  assert.equal((await gerante("PUT", "/api/settings/affichage.symbole_position", { value: "avant" })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/affichage.symbole_ecran", { value: false })).status, 200);
  // L'application de test est un paquet esbuild à part (test-support.ts) : sa devise active se lit par l'état public, pas par un import.
  assert.deepEqual((await ctx.anonymous()("GET", "/api/auth/state")).body.devise, { code: "XAF", position: "avant", symboleEcran: false });
  assert.equal((await gerante("PUT", "/api/settings/affichage.symbole_position", { value: "milieu" })).status, 400);
});

test("institut.devise ne s'écrit pas par la route générique", async (t) => {
  const { gerante } = await setup(t);
  const put = await gerante("PUT", "/api/settings/institut.devise", { value: "EUR" });
  assert.equal(put.status, 409);
  assert.match(put.body.error, /devise|currency/i);
});

test("avant la première vente : conversion qui garde le nombre saisi, aller et retour", async (t) => {
  const { gerante } = await setup(t);
  const created = await gerante("POST", "/api/services", { name: "Tresses", duration: 60, price: 15000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const prix = async () => ((await gerante("GET", "/api/services")).body.services as { name: string; price: number }[]).find((s) => s.name === "Tresses")!.price;
  await gerante("PUT", "/api/settings/fidelite.tranche", { value: 1000 });
  const put = await gerante("PUT", "/api/devise", { code: "EUR" });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(await prix(), 1500000);                            // 15 000,00 €
  assert.equal((await gerante("GET", "/api/auth/state")).body.devise.code, "EUR");
  const tranche = async () => ((await gerante("GET", "/api/settings")).body.settings as { key: string; value: unknown }[]).find((s) => s.key === "fidelite.tranche")!.value;
  assert.equal(await tranche(), 100000);                          // 1 000,00 €
  assert.equal((await gerante("PUT", "/api/devise", { code: "XAF" })).status, 200);
  assert.equal(await prix(), 15000);
  assert.equal(await tranche(), 1000);
});

test("retour vers une devise sans centimes : tranche ramenée à sa borne", async (t) => {
  const { gerante } = await setup(t);
  assert.equal((await gerante("PUT", "/api/devise", { code: "EUR" })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/fidelite.tranche", { value: 1000 })).status, 200); // 10,00 €
  assert.equal((await gerante("PUT", "/api/devise", { code: "XAF" })).status, 200);
  const settings = (await gerante("GET", "/api/settings")).body.settings as { key: string; value: unknown }[];
  assert.equal(settings.find((s) => s.key === "fidelite.tranche")!.value, 100);   // 10 F ramené à 100 F
});

test("après la première vente : 409, catalogue intact", async (t) => {
  const { gerante } = await setup(t);
  const product = (await gerante("POST", "/api/products", { name: "Crème", price: 35000, stock: 5 })).body.product.id as number;
  const sale = await gerante("POST", "/api/sales", { request_id: "devise-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] });
  assert.equal(sale.status, 201);
  const put = await gerante("PUT", "/api/devise", { code: "EUR" }, { "accept-language": "fr" }); // sans en-tête, le message est en anglais
  assert.equal(put.status, 409);
  assert.match(put.body.error, /ne peut plus être changée/);
  const products = (await gerante("GET", "/api/products")).body.products as { id: number; price: number }[];
  assert.equal(products.find((p) => p.id === product)!.price, 35000);
  assert.equal((await gerante("GET", "/api/auth/state")).body.devise.code, "XAF");
});

test("refus : code inconnu (400), réception (403), gérante sans mot de passe confirmé", async (t) => {
  const { ctx, gerante } = await setup(t);
  assert.equal((await gerante("PUT", "/api/devise", { code: "ZZZ" })).status, 400);
  const reception = await ctx.as("reception");
  assert.equal((await reception("PUT", "/api/devise", { code: "EUR" })).status, 403);
  const autre = await ctx.as("manager");               // nouveau pot à cookies, nouvelle connexion : session jamais confirmée
  const refus = await autre("PUT", "/api/devise", { code: "EUR" });
  assert.deepEqual([refus.status, refus.body.code], [403, "confirmation"]);
  assert.equal((await gerante("GET", "/api/auth/state")).body.devise.code, "XAF");
});
