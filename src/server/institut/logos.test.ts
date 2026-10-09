import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { unpackPrintImage } from "../impression/image-logo.ts";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { saveLogo } from "./logos.ts";
import { JPEG_1PX, PNG_1PX } from "./images-essai.ts";


const FR = { "Accept-Language": "fr" };
const BIN = { "content-type": "application/octet-stream" };

test("dépôt par la gérante, lecture publique avec version, nosniff et cache ; retrait ; journal", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const first = await gerante("PUT", "/api/institut/logos/clair", PNG_1PX, BIN);
  assert.equal(first.status, 200);
  assert.equal(first.body.version, 1);

  const anon = ctx.anonymous();
  const read = await anon("GET", "/api/institut/logos/clair");
  assert.equal(read.status, 200);
  assert.equal(read.headers.get("content-type"), "image/png");
  assert.equal(read.headers.get("x-content-type-options"), "nosniff");
  const cache = read.headers.get("cache-control") ?? "";
  assert.ok(cache.includes("max-age=31536000") && cache.includes("immutable"), cache);
  assert.deepEqual(read.bytes, PNG_1PX);

  assert.equal((await gerante("PUT", "/api/institut/logos/clair", PNG_1PX, BIN)).body.version, 2);
  const state = await anon("GET", "/api/auth/state");
  assert.equal(state.body.marque.logos.clair, 2);
  assert.equal(state.body.marque.logos.sombre, null);
  assert.equal(state.body.marque.nom, "");

  assert.equal((await gerante("DELETE", "/api/institut/logos/clair")).status, 200);
  assert.equal((await anon("GET", "/api/institut/logos/clair")).status, 404);

  const rows = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'logo.%' ORDER BY id").all() as { action: string; target: string }[];
  assert.deepEqual(rows.map((r) => r.action), ["logo.depot", "logo.depot", "logo.retrait"]);
  assert.ok(rows.every((r) => r.target === "clair"));
});

test("la version croît même après un retrait", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", "/api/institut/logos/sombre", JPEG_1PX, BIN)).body.version, 1);
  assert.equal((await gerante("DELETE", "/api/institut/logos/sombre")).status, 200);
  assert.equal((await gerante("PUT", "/api/institut/logos/sombre", JPEG_1PX, BIN)).body.version, 2);
  const read = await ctx.anonymous()("GET", "/api/institut/logos/sombre");
  assert.equal(read.headers.get("content-type"), "image/jpeg");
});

test("droits : réception, praticienne et administrateur ne déposent ni ne retirent ; variante inconnue refusée ; refus explicites", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  for (const role of ["reception", "practitioner", "admin"] as const) {
    const call = await ctx.as(role);
    assert.equal((await call("PUT", "/api/institut/logos/clair", PNG_1PX, BIN)).status, 403, role);
    assert.equal((await call("DELETE", "/api/institut/logos/clair")).status, 403, role);
  }
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", "/api/institut/logos/autre", PNG_1PX, BIN)).status, 404);

  const notImage = await gerante("PUT", "/api/institut/logos/clair", Buffer.from("pas une image"), { ...BIN, ...FR });
  assert.equal(notImage.status, 400);
  assert.equal(notImage.body.error, "Format non pris en charge\u00a0: PNG ou JPEG attendu.");

  const heavy = await gerante("PUT", "/api/institut/logos/clair", Buffer.alloc(1_048_577, 0), { ...BIN, ...FR });
  assert.equal(heavy.status, 400);
  assert.equal(heavy.body.error, "Logo trop lourd\u00a0: 1\u00a0Mo au plus.");

  const gif = await gerante("PUT", "/api/institut/logos/clair", Buffer.from("GIF89a\x01\x00\x01\x00"), { ...BIN, "content-type": "image/png", ...FR });
  assert.equal(gif.status, 400);
  assert.equal(gif.body.error, "Format non pris en charge\u00a0: PNG ou JPEG attendu.");

  assert.equal((await ctx.anonymous()("PUT", "/api/institut/logos/clair", PNG_1PX, BIN)).status, 401);
});

test("réglages de la vague B : marque.documents et caisse.imprimer_logo, gérante, valeurs contrôlées", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", "/api/settings/marque.documents", { value: "logo" })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/marque.documents", { value: "nom" })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/caisse.imprimer_logo", { value: true })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/caisse.imprimer_logo", { value: "oui" })).status, 400);
  const keys = (await gerante("GET", "/api/settings")).body.settings.map((s: { key: string; value: unknown }) => [s.key, s.value]);
  assert.deepEqual(keys.filter(([k]: [string]) => k === "caisse.imprimer_logo"), [["caisse.imprimer_logo", true]]);
  assert.deepEqual(keys.filter(([k]: [string]) => k === "marque.documents"), [["marque.documents", "logo"]]);
  for (const role of ["reception", "practitioner", "admin"] as const) {
    assert.equal((await (await ctx.as(role))("PUT", "/api/settings/marque.documents", { value: "logo" })).status, 403, role);
  }
});

/** PNG noir opaque de la taille donnée. */
function blackPng(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set([0, 0, 0, 255], i);
  return PNG.sync.write(png);
}

test("image d'impression : préparée au dépôt clair, absente au dépôt sombre, aperçu réservé à la gérante", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("GET", "/api/institut/logos/impression")).status, 404, "sans logo clair");

  assert.equal((await gerante("PUT", "/api/institut/logos/sombre", blackPng(600, 200), BIN)).status, 200);
  const printRow = () => ctx.db.prepare("SELECT impression FROM institut_logos WHERE variante = ?");
  assert.equal((printRow().get("sombre") as { impression: unknown }).impression, null, "le sombre n'a pas d'image d'impression");

  assert.equal((await gerante("PUT", "/api/institut/logos/clair", blackPng(600, 200), BIN)).status, 200);
  const packed = (printRow().get("clair") as { impression: Uint8Array | null }).impression;
  assert.ok(packed);
  const img = unpackPrintImage(Buffer.from(packed));
  assert.deepEqual([img?.width, img?.height], [320, 107]);

  const preview = await gerante("GET", "/api/institut/logos/impression");
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  assert.deepEqual([PNG.sync.read(Buffer.from(preview.bytes)).width, PNG.sync.read(Buffer.from(preview.bytes)).height], [320, 107]);

  assert.equal((await (await ctx.as("reception"))("GET", "/api/institut/logos/impression")).status, 403);
  assert.equal((await ctx.anonymous()("GET", "/api/institut/logos/impression")).status, 401);
});

/** JPEG uni de la taille donnée. */
function flatJpeg(width: number, height: number): Buffer {
  return Buffer.from(jpeg.encode({ data: Buffer.alloc(width * height * 4, 128), width, height }, 50).data);
}

const TROP_GRAND = { fr: "Image trop grande\u00a0: 4\u00a0000 points de côté au plus.", en: "Image too large: 4,000 pixels per side at most." };

test("dépôt d'une image démesurée : raison « trop grande », rien d'enregistré, clair comme sombre", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const big = { png: PNG.sync.write(new PNG({ width: 5000, height: 10 })), jpg: flatJpeg(4100, 8) };
  for (const variant of ["clair", "sombre"]) {
    for (const bytes of [big.png, big.jpg]) {
      const fr = await gerante("PUT", `/api/institut/logos/${variant}`, bytes, { ...BIN, ...FR });
      assert.equal(fr.status, 400, variant);
      assert.equal(fr.body.error, TROP_GRAND.fr);
      const en = await gerante("PUT", `/api/institut/logos/${variant}`, bytes, { ...BIN, "Accept-Language": "en" });
      assert.equal(en.body.error, TROP_GRAND.en);
    }
    assert.equal((await ctx.anonymous()("GET", `/api/institut/logos/${variant}`)).status, 404, "rien d'enregistré");
  }
});

test("fichier abîmé : toujours « illisible », pas « trop grande »", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const broken = Buffer.concat([PNG_1PX.subarray(0, 20), Buffer.alloc(10)]);
  const res = await gerante("PUT", "/api/institut/logos/clair", broken, { ...BIN, ...FR });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /illisible/);
});

test("JPEG de 4 000 × 4 000 et de 4 000 × 3 000 : acceptés (limite mémoire du décodeur)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  for (const [w, h] of [[4000, 4000], [4000, 3000]]) {
    assert.equal((await gerante("PUT", "/api/institut/logos/clair", flatJpeg(w, h), BIN)).status, 200, `${w} × ${h}`);
  }
});

test("versions : deux dépôts simultanés reçoivent n et n + 1, jamais la même", async () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  const [a, b] = await Promise.all([saveLogo("sombre", "image/png", PNG_1PX, null, 1000), saveLogo("sombre", "image/png", PNG_1PX, null, 1000)]);
  assert.deepEqual([a, b].sort(), [1, 2]);
  assert.equal(await saveLogo("sombre", "image/png", PNG_1PX, null, 1000), 3);
});
