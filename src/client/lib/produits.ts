/**
 * Photo d'un produit à l'écran (images des produits, spec du 04/10/2026,
 * § 2) : adresse versionnée, initiale de la pastille sans photo. Fonctions
 * pures, testées sous Node.
 */

/** Poids maximal d'une photo, le même que celui du serveur. */
export const PRODUCT_IMAGE_MAX_BYTES = 1_048_576;

/** Adresse de la photo avec sa version (un nouveau dépôt change l'adresse, cache long) ; `null` sans photo. */
export function productImageUrl(p: { id: number; image_version?: number | null }): string | null {
  return Number.isInteger(p.image_version) ? `/api/products/${p.id}/image?v=${p.image_version}` : null;
}

/** Initiale de la pastille neutre : première lettre ou premier chiffre du nom, en capitale ; vide pour un nom sans lettre. */
export function productInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toLocaleUpperCase("fr") : "";
}

/** Nom du fichier de la photo téléchargée à la main : nom du produit sans accents ni signes, extension d'après le type. */
export function photoFileName(name: string, type: string): string {
  const base = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "produit";
  return `${base}.${type === "image/png" ? "png" : "jpg"}`;
}
