import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { JPEG_1PX, PNG_1PX } from "../institut/images-essai.ts";
import { deleteProductImage, readProductImage, saveProductImage } from "./images.ts";

/** Photo d'un produit (spec du 04/10/2026, § 1) : table `product_images`, version qui ne recule jamais. */

const NOW = Date.parse("2026-10-04T09:00:00Z");

function setup() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  db.exec("INSERT INTO products (id, name) VALUES (1, 'Sérum Karité'), (2, 'Huile de coco')");
  return db;
}

test("photo d'un produit : enregistrée, relue, remplacée, retirée ; la version ne recule jamais, même après un retrait ou d'un produit à l'autre", async () => {
  setup();
  assert.equal(await readProductImage(1), null);
  assert.equal(await saveProductImage(1, "image/png", PNG_1PX, NOW), 1);
  assert.deepEqual(await readProductImage(1), { type: "image/png", bytes: PNG_1PX, version: 1 });
  assert.equal(await saveProductImage(1, "image/jpeg", JPEG_1PX, NOW), 2);
  assert.equal((await readProductImage(1))?.type, "image/jpeg");
  assert.equal(await deleteProductImage(1), true);
  assert.equal(await deleteProductImage(1), false);
  assert.equal(await readProductImage(1), null);
  assert.equal(await saveProductImage(1, "image/png", PNG_1PX, NOW), 3);
  assert.equal(await saveProductImage(2, "image/png", PNG_1PX, NOW), 4);
});

test("versions : deux dépôts simultanés reçoivent n et n + 1, jamais la même", async () => {
  setup();
  const [a, b] = await Promise.all([saveProductImage(1, "image/png", PNG_1PX, NOW), saveProductImage(2, "image/png", PNG_1PX, NOW)]);
  assert.deepEqual([a, b].sort(), [1, 2]);
});

test("suppression d'un produit : sa photo part avec lui (clé étrangère, ON DELETE CASCADE)", async () => {
  const db = setup();
  await saveProductImage(2, "image/png", PNG_1PX, NOW);
  db.exec("DELETE FROM products WHERE id = 2");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM product_images").get() as { n: number }).n, 0);
});

test("table : type et poids contrôlés par la base, produit inexistant refusé", () => {
  const db = setup();
  const insert = db.prepare("INSERT INTO product_images (product_id, type, octets, version, mis_a_jour) VALUES (?, ?, ?, 1, '2026-10-04T09:00:00.000Z')");
  assert.throws(() => insert.run(1, "image/gif", PNG_1PX));
  assert.throws(() => insert.run(1, "image/png", Buffer.alloc(1_048_577)));
  assert.throws(() => insert.run(99, "image/png", PNG_1PX));
});
