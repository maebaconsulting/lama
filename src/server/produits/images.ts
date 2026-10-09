/**
 * Photo d'un produit (images des produits, spec du 04/10/2026, § 1) :
 * stockage en BLOB dans `product_images`, version croissante, jamais les
 * octets dans la liste des produits. Contrôle du fichier par le module
 * d'images commun (`src/server/images.ts`), avant l'appel.
 */
import { get, run } from "@clawnify/db";
import type { ImageType } from "../images.ts";
import type { DocumentFile } from "../whatsapp/fournisseur.ts";

export interface ProductImage { type: ImageType; bytes: Buffer; version: number }

export async function readProductImage(productId: number): Promise<ProductImage | null> {
  const row = await get<{ type: ImageType; octets: Uint8Array; version: number }>("SELECT type, octets, version FROM product_images WHERE product_id = ?", [productId]);
  return row ? { type: row.type, bytes: Buffer.from(row.octets), version: row.version } : null;
}

/**
 * Enregistre ou remplace la photo d'un produit existant ; rend la nouvelle
 * version. Un seul compteur pour toutes les photos, incrémenté en une seule
 * instruction : deux dépôts ne reçoivent jamais la même version (cache d'un an).
 */
export async function saveProductImage(productId: number, type: ImageType, bytes: Buffer, now: number): Promise<number> {
  const row = await get<{ v: number }>(
    "INSERT INTO _meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING CAST(value AS INTEGER) AS v",
    ["product_image_version"],
  );
  const version = row!.v;
  await run(
    `INSERT INTO product_images (product_id, type, octets, version, mis_a_jour) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET type = excluded.type, octets = excluded.octets, version = excluded.version, mis_a_jour = excluded.mis_a_jour`,
    [productId, type, bytes, version, new Date(now).toISOString()],
  );
  return version;
}

export async function deleteProductImage(productId: number): Promise<boolean> {
  const result = await run("DELETE FROM product_images WHERE product_id = ?", [productId]);
  return Number(result.changes) > 0;
}

/** Version de la photo d'un produit dans une requête sur `products p` (liste, fiche, envoi) ; `null` sans photo. */
export const IMAGE_VERSION_SQL = "(SELECT version FROM product_images WHERE product_id = p.id) AS image_version";

/**
 * Photo d'un produit au moment de l'envoi par WhatsApp : `{ photo: null }`
 * pour un produit sans photo (le texte part seul), `null` pour un produit
 * supprimé depuis la demande (message ignoré).
 */
export async function readProductPhoto(productId: number): Promise<{ photo: DocumentFile | null } | null> {
  const product = await get<{ id: number }>("SELECT id FROM products WHERE id = ?", [productId]);
  if (!product) return null;
  const image = await readProductImage(productId);
  if (!image) return { photo: null };
  return { photo: { name: `produit-${productId}.${image.type === "image/png" ? "png" : "jpg"}`, mime: image.type, data: image.bytes } };
}
