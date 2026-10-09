import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/** Droits jugés sur le chemin décodé que le routeur utilise : un caractère encodé ou un identifiant en hexadécimal n'ouvre aucune route réservée. */

test("praticienne : refus sur les chemins encodés ou en hexadécimal des routes réservées à la réception et à la gérante", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const produit = (await gerante("POST", "/api/products", { name: "Sérum", price: 12000 })).body.product.id as number;
  const cliente = (await gerante("POST", "/api/clients", { name: "Aïcha", phone: "699123456" })).body.client.id as number;
  const praticienne = await ctx.as("practitioner");
  const refuses: [string, string, unknown?][] = [
    ["GET", `/api/clients/${cliente}/loy%61lty`],
    ["GET", `/api/products/${produit}/wh%61tsapp`],
    ["POST", `/api/products/${produit}/wh%61tsapp`, { text: "Bonjour" }],
    ["GET", "/api/products/0x1/whatsapp"],
    ["POST", "/api/products/0x1/whatsapp", { text: "Bonjour" }],
  ];
  for (const [method, path, body] of refuses) assert.equal((await praticienne(method, path, body)).status, 403, `${method} ${path}`);
});

test("réception et gérante : accès normal sur les chemins en clair ; identifiant en hexadécimal : introuvable, jamais celui du produit 1", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const reception = await ctx.as("reception");
  const produit = (await gerante("POST", "/api/products", { name: "Sérum", price: 12000 })).body.product.id as number;
  const cliente = (await gerante("POST", "/api/clients", { name: "Aïcha", phone: "699123456" })).body.client.id as number;
  assert.equal(produit, 1);
  for (const who of [reception, gerante]) {
    assert.equal((await who("GET", `/api/clients/${cliente}/loyalty`)).status, 200);
    assert.equal((await who("GET", `/api/products/${produit}/whatsapp?client_id=${cliente}`)).status, 200);
    assert.equal((await who("GET", "/api/products/0x1/whatsapp")).status, 404, "0x1 n'est pas l'identifiant 1");
    assert.equal((await who("GET", "/api/products/1e0/whatsapp")).status, 404);
  }
});
