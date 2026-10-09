/**
 * Contrôle commun des images déposées (images des produits, spec du
 * 04/10/2026, § 1) : logo de l'institut et photo d'un produit. Type d'après
 * les premiers octets (PNG ou JPEG, jamais d'après le nom ni l'en-tête de la
 * requête), 1 Mo au plus, 4 000 points de côté au plus lus dans l'en-tête
 * (IHDR, SOF) avant tout décodage, image lisible par pdfkit.
 */
import PDFDocument from "pdfkit";
import { readResource } from "./caisse/ressources.ts";

export const IMAGE_MAX_BYTES = 1_048_576;
/** Côté maximal accepté avant décodage : au-delà, une image légère en octets coûterait trop de mémoire. */
export const IMAGE_MAX_SIDE = 4000;
export type ImageType = "image/png" | "image/jpeg";
/** Raison d'un refus : clé du dictionnaire du serveur. */
export type ImageProblem = "image.trop_lourd" | "image.format" | "image.trop_grand" | "image.illisible";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Type d'image d'après ses premiers octets (jamais d'après le nom ou l'en-tête de la requête). */
export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

/** Dimensions déclarées par un JPEG (premier bloc SOF), sans décoder un seul pixel ; `null` si introuvables. */
export function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return null;
}

/** Image dont un côté dépasse 4 000 points : refusée avant tout décodage de pixels. */
export class ImageTooLarge extends Error {
  constructor() { super("image trop grande"); }
}

/** Contrôle les dimensions déclarées (IHDR ou SOF) sans décoder de pixels ; lève `ImageTooLarge`. Un en-tête illisible passe : pdfkit ou le décodage le jugera. */
export function checkImageSize(bytes: Buffer, type: ImageType): void {
  let size: { width: number; height: number } | null = null;
  if (type === "image/png") {
    // PNG : largeur et hauteur du bloc IHDR, aux octets 16 à 23.
    if (bytes.length >= 24) size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else {
    size = jpegSize(bytes);
  }
  if (size && (size.width > IMAGE_MAX_SIDE || size.height > IMAGE_MAX_SIDE)) throw new ImageTooLarge();
}

/** Raison d'un refus, ou `null` : poids, signature, dimensions lues dans l'en-tête, puis ouverture par pdfkit (les documents l'insèrent). */
export function imageProblem(bytes: Buffer): ImageProblem | null {
  if (bytes.length > IMAGE_MAX_BYTES) return "image.trop_lourd";
  const type = sniffImage(bytes);
  if (!type) return "image.format";
  try {
    checkImageSize(bytes, type);
  } catch {
    return "image.trop_grand";
  }
  try {
    // Police par défaut du ticket : jamais Helvetica, que le paquet livré ne contient pas.
    const pdf = new PDFDocument({ autoFirstPage: false, font: readResource("garamond-400.woff") as unknown as string });
    // `openImage` existe à l'exécution mais manque aux types de pdfkit.
    (pdf as unknown as { openImage(data: Buffer): unknown }).openImage(Buffer.from(bytes));
  } catch {
    return "image.illisible";
  }
  return null;
}
