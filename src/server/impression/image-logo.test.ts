import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { decodeImage, packPrintImage, printImagePng, toPrintImage, unpackPrintImage } from "./image-logo.ts";

/** Image RGBA unie ou dégradée, pour les essais. */
function rgba(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, rgba: data };
}
const pngOf = (img: ReturnType<typeof rgba>) => { const p = new PNG({ width: img.width, height: img.height }); p.data = Buffer.from(img.rgba); return PNG.sync.write(p); };
const blacks = (img: { width: number; height: number; bits: Buffer }) => [...img.bits].reduce((n, b) => n + b.toString(2).split("1").length - 1, 0);

test("PNG transparent : la transparence devient blanche, le noir opaque reste noir", () => {
  const src = rgba(16, 8, (x) => (x < 8 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
  const img = toPrintImage(decodeImage(pngOf(src), "image/png"));
  assert.deepEqual([img.width, img.height], [16, 8]);
  for (let y = 0; y < 8; y++) assert.deepEqual([img.bits[y * 2], img.bits[y * 2 + 1]], [0xff, 0x00]);
});

test("JPEG décodé", () => {
  const src = rgba(8, 8, () => [0, 0, 0, 255]);
  const raw = jpeg.encode({ width: 8, height: 8, data: Buffer.from(src.rgba) }, 90).data;
  const img = toPrintImage(decodeImage(raw, "image/jpeg"));
  assert.equal(blacks(img), 64);
});

test("réduction dans 320 × 144 en gardant les proportions, jamais d'agrandissement, largeur multiple de 8", () => {
  const wide = toPrintImage(rgba(1000, 100, () => [0, 0, 0, 255]));
  assert.deepEqual([wide.width, wide.height], [320, 32]);
  const tall = toPrintImage(rgba(100, 1000, () => [0, 0, 0, 255]));
  assert.equal(tall.height, 144);
  assert.equal(tall.width % 8, 0);
  assert.ok(tall.width >= 8 && tall.width <= 16);
  const small = toPrintImage(rgba(40, 20, () => [0, 0, 0, 255]));
  assert.deepEqual([small.width, small.height], [40, 20], "jamais agrandie");
  const thin = toPrintImage(rgba(4000, 3, () => [0, 0, 0, 255]));
  assert.ok(thin.height >= 1, "au moins un point de haut");
});

test("trame : un gris moyen donne environ moitié de points noirs, un gris pâle ni tout blanc ni tout noir", () => {
  const grey = toPrintImage(rgba(64, 64, () => [128, 128, 128, 255]));
  const ratio = blacks(grey) / (64 * 64);
  assert.ok(ratio > 0.4 && ratio < 0.6, `gris moyen : ${ratio}`);
  const pale = toPrintImage(rgba(64, 64, () => [220, 220, 220, 255]));
  const paleRatio = blacks(pale) / (64 * 64);
  assert.ok(paleRatio > 0.02 && paleRatio < 0.3, `gris pâle : ${paleRatio}`);
  const ramp = toPrintImage(rgba(256, 16, (x) => [x, x, x, 255]));
  assert.ok(blacks(ramp) > 0 && blacks(ramp) < 256 * 16);
});

test("image démesurée en points ou fichier abîmé : refusée avant tout calcul", () => {
  const head = new PNG({ width: 5000, height: 10 });
  assert.throws(() => decodeImage(PNG.sync.write(head), "image/png"), /trop grande/);
  assert.throws(() => decodeImage(Buffer.from("x"), "image/png"));
  // JPEG de 4 100 × 8 : dimensions lues dans l'en-tête, refusée avant le décodage des pixels.
  const wideJpeg = jpeg.encode({ width: 4100, height: 8, data: Buffer.alloc(4100 * 8 * 4, 255) }, 50).data;
  assert.throws(() => decodeImage(wideJpeg, "image/jpeg"), /trop grande/);
  assert.throws(() => decodeImage(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"));
});

test("empaquetage aller-retour, paquet incohérent refusé, aperçu PNG lisible", () => {
  const img = toPrintImage(rgba(24, 4, (x) => (x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])));
  assert.deepEqual(unpackPrintImage(packPrintImage(img)), img);
  assert.equal(unpackPrintImage(Buffer.from([0, 9, 0, 1, 0xff])), null, "largeur non multiple de 8");
  assert.equal(unpackPrintImage(Buffer.from([0, 8, 0, 2, 0xff])), null, "octets manquants");
  const preview = PNG.sync.read(printImagePng(img));
  assert.deepEqual([preview.width, preview.height], [24, 4]);
});
