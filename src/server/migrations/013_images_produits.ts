/**
 * Photo d'un produit (images des produits, spec du 04/10/2026, § 1) : une
 * seule par produit, supprimée avec lui (clés étrangères actives, `storage.ts`) ;
 * version tirée d'un compteur de `_meta` qui ne recule jamais (adresse avec
 * la version, cache long). Elle suit la sauvegarde chiffrée sans changement.
 */
export default `
CREATE TABLE product_images (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg')),
  octets BLOB NOT NULL CHECK (length(octets) <= 1048576),
  version INTEGER NOT NULL,
  mis_a_jour TEXT NOT NULL
);
`;
