/**
 * Numéro de carte d'une cliente (mini CRM § 5) : préparation de la carte NFC
 * sans rien supposer du matériel. Vide (NULL) par défaut, unique quand il
 * est posé, lettres majuscules et chiffres de 4 à 32 (forme enregistrée par
 * `normalizeCard`). Un lecteur en mode clavier le tape dans la recherche.
 */
export default `
ALTER TABLE clients ADD COLUMN card TEXT CHECK (card IS NULL OR (length(card) BETWEEN 4 AND 32 AND card NOT GLOB '*[^A-Z0-9]*'));
CREATE UNIQUE INDEX clients_card ON clients(card) WHERE card IS NOT NULL;
`;
