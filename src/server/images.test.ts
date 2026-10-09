import assert from "node:assert/strict";
import { test } from "node:test";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { checkImageSize, IMAGE_MAX_BYTES, imageProblem, ImageTooLarge, sniffImage } from "./images.ts";
import { JPEG_1PX, PNG_1PX } from "./institut/images-essai.ts";
import { message } from "./messages.ts";

/** Module d'images commun (images des produits, spec du 04/10/2026, § 1) : mêmes essais que le logo de la vague B. */

/** JPEG uni de la taille donnée. */
function flatJpeg(width: number, height: number): Buffer {
  return Buffer.from(jpeg.encode({ data: Buffer.alloc(width * height * 4, 128), width, height }, 50).data);
}

/** En-tête PNG déclarant les dimensions données (le reste du fichier n'est pas lu par le contrôle des dimensions). */
function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_1PX);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

test("signature : PNG et JPEG reconnus, le reste refusé", () => {
  assert.equal(sniffImage(PNG_1PX), "image/png");
  assert.equal(sniffImage(JPEG_1PX), "image/jpeg");
  assert.equal(sniffImage(Buffer.from("GIF89a")), null);
  assert.equal(sniffImage(Buffer.from("<svg xmlns=")), null);
});

test("contrôle d'une image : poids, signature, dimensions, fichier abîmé, dans cet ordre", () => {
  assert.equal(IMAGE_MAX_BYTES, 1_048_576);
  assert.equal(imageProblem(PNG_1PX), null);
  assert.equal(imageProblem(JPEG_1PX), null);
  assert.equal(imageProblem(Buffer.alloc(1_048_577, 0)), "image.trop_lourd");
  assert.equal(imageProblem(Buffer.from("pas une image")), "image.format");
  assert.equal(imageProblem(PNG.sync.write(new PNG({ width: 5000, height: 10 }))), "image.trop_grand");
  assert.equal(imageProblem(flatJpeg(4100, 8)), "image.trop_grand");
  const broken = Buffer.concat([PNG_1PX.subarray(0, 20), Buffer.alloc(10)]);
  assert.equal(imageProblem(broken), "image.illisible");
});

test("dimensions lues dans l'en-tête, sans décoder : 4 000 acceptés, 4 001 refusés", () => {
  assert.doesNotThrow(() => checkImageSize(pngHeader(4000, 4000), "image/png"));
  assert.throws(() => checkImageSize(pngHeader(4001, 1), "image/png"), ImageTooLarge);
  assert.throws(() => checkImageSize(pngHeader(1, 4001), "image/png"), ImageTooLarge);
  assert.doesNotThrow(() => checkImageSize(flatJpeg(4000, 8), "image/jpeg"));
});

test("textes des refus : communs, identiques à ceux du logo de la vague B ; le logo garde « Logo trop lourd »", () => {
  assert.equal(message("fr", "image.format"), "Format non pris en charge\u00a0: PNG ou JPEG attendu.");
  assert.equal(message("fr", "image.trop_grand"), "Image trop grande\u00a0: 4\u00a0000 points de côté au plus.");
  assert.equal(message("en", "image.trop_grand"), "Image too large: 4,000 pixels per side at most.");
  assert.equal(message("fr", "image.illisible"), "Image illisible\u00a0: le fichier semble abîmé.");
  assert.equal(message("fr", "image.trop_lourd"), "Fichier trop lourd\u00a0: 1\u00a0Mo au plus.");
  assert.equal(message("en", "image.trop_lourd"), "File too large: 1 MB at most.");
  assert.equal(message("fr", "logo.trop_lourd"), "Logo trop lourd\u00a0: 1\u00a0Mo au plus.");
});
