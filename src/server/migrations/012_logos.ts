/**
 * Logo de l'institut (renommage lama, vague B, spec § 2) : deux variantes,
 * `clair` (documents, fond clair) et `sombre` (écran, fond noir) ; version
 * incrémentée à chaque dépôt (adresse publique avec la version, cache long) ;
 * `impression` : image tramée pour l'imprimante thermique, logo clair seulement.
 */
export default `
CREATE TABLE institut_logos (
  variante TEXT PRIMARY KEY CHECK (variante IN ('clair', 'sombre')),
  type TEXT NOT NULL CHECK (type IN ('image/png', 'image/jpeg')),
  octets BLOB NOT NULL,
  version INTEGER NOT NULL,
  mis_a_jour TEXT NOT NULL,
  impression BLOB
) WITHOUT ROWID;
`;
