import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import { resourceFor } from "../realtime.ts";
import { setupApp } from "../test-support.ts";
import { JPEG_1PX, PNG_1PX } from "../institut/images-essai.ts";

/** Adresses de la photo d'un produit (spec du 04/10/2026, § 1). */

const BIN = { "content-type": "application/octet-stream" };
const FR = { "Accept-Language": "fr" };

async function withProduct(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const id = (await gerante("POST", "/api/products", { name: "Sérum Karité", price: 12000 })).body.product.id as number;
  return { ctx, gerante, id };
}

const photoCount = (ctx: Awaited<ReturnType<typeof setupApp>>) => (ctx.db.prepare("SELECT COUNT(*) AS n FROM product_images").get() as { n: number }).n;

test("dépôt par la gérante : version ; lecture par tout compte connecté avec le type, nosniff et un cache privé long ; journal au nom du produit", async (t) => {
  const { ctx, gerante, id } = await withProduct(t);
  const put = await gerante("PUT", `/api/products/${id}/image`, PNG_1PX, BIN);
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { ok: true, version: 1 });
  for (const role of ["manager", "reception", "practitioner", "admin"] as const) {
    const read = await (await ctx.as(role))("GET", `/api/products/${id}/image?v=1`);
    assert.equal(read.status, 200, role);
    assert.equal(read.headers.get("content-type"), "image/png");
    assert.equal(read.headers.get("x-content-type-options"), "nosniff");
    assert.equal(read.headers.get("cache-control"), "private, max-age=31536000, immutable");
    assert.deepEqual(read.bytes, PNG_1PX);
  }
  const rows = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'produit.%' ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ action: "produit.photo_depot", target: "Sérum Karité" }]);
});

test("jamais sans session ; dépôt et retrait réservés à la gérante", async (t) => {
  const { ctx, gerante, id } = await withProduct(t);
  await gerante("PUT", `/api/products/${id}/image`, PNG_1PX, BIN);
  const anon = ctx.anonymous();
  assert.equal((await anon("GET", `/api/products/${id}/image?v=1`)).status, 401);
  assert.equal((await anon("PUT", `/api/products/${id}/image`, PNG_1PX, BIN)).status, 401);
  for (const role of ["reception", "practitioner", "admin"] as const) {
    const call = await ctx.as(role);
    assert.equal((await call("PUT", `/api/products/${id}/image`, PNG_1PX, BIN)).status, 403, role);
    assert.equal((await call("DELETE", `/api/products/${id}/image`)).status, 403, role);
  }
  assert.equal(photoCount(ctx), 1);
});

test("produit inexistant : 404 au dépôt, au retrait et à la lecture ; produit sans photo : 404", async (t) => {
  const { gerante, id } = await withProduct(t);
  const missing = await gerante("PUT", "/api/products/999/image", PNG_1PX, { ...BIN, ...FR });
  assert.deepEqual([missing.status, missing.body.error], [404, "Produit introuvable."]);
  assert.equal((await gerante("DELETE", "/api/products/999/image")).status, 404);
  assert.equal((await gerante("GET", "/api/products/999/image")).status, 404);
  const none = await gerante("GET", `/api/products/${id}/image`, undefined, FR);
  assert.deepEqual([none.status, none.body.error], [404, "Aucune photo pour ce produit."]);
  assert.equal((await gerante("DELETE", `/api/products/${id}/image`)).status, 404);
});

test("refus du module commun, mêmes textes que le logo ; rien d'enregistré", async (t) => {
  const { ctx, gerante, id } = await withProduct(t);
  const cases: [Buffer, string][] = [
    [Buffer.from("pas une image"), "Format non pris en charge\u00a0: PNG ou JPEG attendu."],
    [Buffer.alloc(1_048_577, 0), "Fichier trop lourd\u00a0: 1\u00a0Mo au plus."],
    [PNG.sync.write(new PNG({ width: 5000, height: 10 })), "Image trop grande\u00a0: 4\u00a0000 points de côté au plus."],
    [Buffer.concat([PNG_1PX.subarray(0, 20), Buffer.alloc(10)]), "Image illisible\u00a0: le fichier semble abîmé."],
  ];
  for (const [bytes, error] of cases) {
    const res = await gerante("PUT", `/api/products/${id}/image`, bytes, { ...BIN, ...FR });
    assert.deepEqual([res.status, res.body.error], [400, error]);
  }
  assert.equal(photoCount(ctx), 0);
});

test("taille du corps : 1 Mo + 1 accepté pour la photo (refus traduit), 413 au-delà ; les autres routes gardent 64 Ko", async (t) => {
  const { gerante, id } = await withProduct(t);
  assert.equal((await gerante("PUT", `/api/products/${id}/image`, Buffer.alloc(1_048_577, 0), BIN)).status, 400);
  assert.equal((await gerante("PUT", `/api/products/${id}/image`, Buffer.alloc(1_048_578, 0), BIN)).status, 413);
  assert.equal((await gerante("PUT", `/api/products/${id}`, { name: "x".repeat(70_000) })).status, 413);
});

test("version et cache : remplacée, retirée, redéposée, la version croît ; liste et fiche donnent image_version, jamais les octets", async (t) => {
  const { ctx, gerante, id } = await withProduct(t);
  assert.equal((await gerante("GET", `/api/products/${id}`)).body.product.image_version, null);
  assert.equal((await gerante("PUT", `/api/products/${id}/image`, PNG_1PX, BIN)).body.version, 1);
  assert.equal((await gerante("PUT", `/api/products/${id}/image`, JPEG_1PX, BIN)).body.version, 2);
  assert.equal((await gerante("GET", `/api/products/${id}/image?v=2`)).headers.get("content-type"), "image/jpeg");
  const item = (await gerante("GET", "/api/products")).body.products.find((p: { id: number }) => p.id === id);
  assert.equal(item.image_version, 2);
  assert.ok(!("octets" in item) && !("bytes" in item));
  const fiche = (await gerante("GET", `/api/products/${id}`)).body.product;
  assert.equal(fiche.image_version, 2);
  assert.ok(!JSON.stringify(fiche).includes("octets"));
  assert.equal((await gerante("DELETE", `/api/products/${id}/image`)).status, 200);
  assert.equal((await gerante("GET", `/api/products/${id}`)).body.product.image_version, null);
  assert.equal((await gerante("PUT", `/api/products/${id}/image`, PNG_1PX, BIN)).body.version, 3);
  const actions = ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'produit.%' ORDER BY id").all().map((r) => (r as { action: string }).action);
  assert.deepEqual(actions, ["produit.photo_depot", "produit.photo_depot", "produit.photo_retrait", "produit.photo_depot"]);
});

test("création d'un produit : image_version nulle", async (t) => {
  const { gerante } = await withProduct(t);
  const created = await gerante("POST", "/api/products", { name: "Huile de coco" });
  assert.equal(created.body.product.image_version, null);
});

test("suppression d'un produit : sa photo est supprimée avec lui", async (t) => {
  const { ctx, gerante, id } = await withProduct(t);
  await gerante("PUT", `/api/products/${id}/image`, PNG_1PX, BIN);
  assert.equal((await gerante("DELETE", `/api/products/${id}`)).status, 200);
  assert.equal(photoCount(ctx), 0);
  assert.equal((await gerante("GET", `/api/products/${id}/image`)).status, 404);
});

test("photo changée depuis une autre tablette : le dépôt et le retrait réveillent la ressource « products » (liste et fiche rechargées)", () => {
  // Passe déjà : il fixe le comportement sur lequel compte l'adresse versionnée.
  assert.equal(resourceFor("/api/products/3/image"), "products");
});
