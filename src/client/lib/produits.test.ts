import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCT_IMAGE_MAX_BYTES, photoFileName, productImageUrl, productInitial } from "./produits.ts";

/** Photo d'un produit à l'écran (images des produits, spec du 04/10/2026, § 2). */

test("adresse de la photo : versionnée (cache long) ; sans photo, aucune", () => {
  assert.equal(productImageUrl({ id: 3, image_version: 7 }), "/api/products/3/image?v=7");
  assert.equal(productImageUrl({ id: 3, image_version: null }), null);
  assert.equal(productImageUrl({ id: 3 }), null);
  assert.equal(PRODUCT_IMAGE_MAX_BYTES, 1_048_576);
});

test("pastille sans photo : initiale du nom en capitale, accent gardé ; nom sans lettre : vide", () => {
  assert.equal(productInitial("sérum Karité"), "S");
  assert.equal(productInitial("éclat"), "É");
  assert.equal(productInitial("  (3) huile"), "3");
  assert.equal(productInitial(""), "");
});

test("nom du fichier téléchargé : nom du produit sans accents ni signes, extension d'après le type", () => {
  assert.equal(photoFileName("Sérum Karité 50 ml", "image/jpeg"), "serum-karite-50-ml.jpg");
  assert.equal(photoFileName("Huile !", "image/png"), "huile.png");
  assert.equal(photoFileName("***", "image/png"), "produit.png");
});
