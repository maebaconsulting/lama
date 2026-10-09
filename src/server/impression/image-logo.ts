/**
 * Image du logo pour l'imprimante thermique (vague B, spec § 2, « Image
 * d'impression ») : décodage du PNG ou du JPEG, transparence sur blanc,
 * niveaux de gris, réduction dans 320 × 144 points (40 × 18 mm à 8 points
 * par mm, jamais d'agrandissement), trame de Floyd-Steinberg, rangées de bits
 * pour la commande raster `GS v 0`. Préparée une fois, au dépôt du logo.
 */
import { PNG } from "pngjs";
import jpeg from "jpeg-js";
import { checkImageSize, IMAGE_MAX_SIDE, ImageTooLarge, jpegSize, type ImageType } from "../images.ts";

export interface PrintImage { width: number; height: number; bits: Buffer }
interface Rgba { width: number; height: number; rgba: Uint8Array }

/** Décode un logo en RGBA ; refuse, avant de décoder les pixels, une image de plus de 4 000 points de côté. */
export function decodeImage(bytes: Buffer, type: ImageType): Rgba {
  checkImageSize(bytes, type);
  if (type === "image/png") {
    if (bytes.length < 24) throw new Error("PNG tronqué");
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, rgba: new Uint8Array(png.data) };
  }
  if (!jpegSize(bytes)) throw new Error("JPEG illisible");
  // 4 000 × 4 000 demande environ 340 Mo au décodeur (mesuré : 128 Mo refuse déjà du 3 000 × 3 000) ; 512 Mo laisse de la marge.
  const img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: (IMAGE_MAX_SIDE * IMAGE_MAX_SIDE) / 1e6, maxMemoryUsageInMB: 512 });
  if (img.width > IMAGE_MAX_SIDE || img.height > IMAGE_MAX_SIDE) throw new ImageTooLarge();
  return { width: img.width, height: img.height, rgba: img.data };
}

/** Gris (0 noir, 255 blanc) d'un pixel posé sur du blanc. */
function grey(r: number, g: number, b: number, a: number): number {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return 255 - ((255 - lum) * a) / 255;
}

/** Réduit dans `maxWidth` × `maxHeight` (jamais d'agrandissement) et passe en points noirs ou blancs par trame. */
export function toPrintImage(img: Rgba, maxWidth = 320, maxHeight = 144): PrintImage {
  const scale = Math.min(1, maxWidth / img.width, maxHeight / img.height);
  const height = Math.max(1, Math.round(img.height * scale));
  const inner = Math.max(1, Math.round(img.width * scale));
  const width = Math.ceil(inner / 8) * 8;
  // Réduction par moyenne de zone : chaque point de sortie prend la moyenne des pixels qu'il couvre.
  const levels = new Float32Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * img.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / height));
    for (let x = 0; x < inner; x++) {
      const x0 = Math.floor((x * img.width) / inner);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / inner));
      let sum = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const i = (sy * img.width + sx) * 4;
        sum += grey(img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]);
        n++;
      }
      // Image plus étroite que sa largeur arrondie à 8 : centrée, marges blanches.
      levels[y * width + x + Math.floor((width - inner) / 2)] = sum / n;
    }
  }
  // Trame de Floyd-Steinberg : l'erreur d'arrondi passe aux voisins (7/16, 3/16, 5/16, 1/16).
  const bits = Buffer.alloc((width / 8) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = levels[i];
      const black = old < 128;
      const err = old - (black ? 0 : 255);
      if (black) bits[y * (width / 8) + (x >> 3)] |= 0x80 >> (x & 7);
      if (x + 1 < width) levels[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) levels[i + width - 1] += (err * 3) / 16;
        levels[i + width] += (err * 5) / 16;
        if (x + 1 < width) levels[i + width + 1] += err / 16;
      }
    }
  }
  return { width, height, bits };
}

/** Paquet stocké : largeur et hauteur sur 2 octets chacune (grand-boutiste), puis les rangées de bits. */
export function packPrintImage(img: PrintImage): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(img.width, 0);
  head.writeUInt16BE(img.height, 2);
  return Buffer.concat([head, img.bits]);
}

/** Relit un paquet ; `null` s'il est incohérent (largeur nulle ou non multiple de 8, longueur fausse). */
export function unpackPrintImage(buf: Buffer): PrintImage | null {
  if (buf.length < 4) return null;
  const width = buf.readUInt16BE(0);
  const height = buf.readUInt16BE(2);
  if (width === 0 || height === 0 || width % 8 !== 0 || buf.length !== 4 + (width / 8) * height) return null;
  return { width, height, bits: Buffer.from(buf.subarray(4)) };
}

/** Aperçu « tel qu'imprimé » : chaque bit noir en pixel noir, le reste blanc. */
export function printImagePng(img: PrintImage): Buffer {
  const png = new PNG({ width: img.width, height: img.height });
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const on = (img.bits[y * (img.width / 8) + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
    const i = (y * img.width + x) * 4;
    png.data[i] = png.data[i + 1] = png.data[i + 2] = on ? 0 : 255;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
