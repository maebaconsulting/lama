/**
 * Sous-projet 4 (spec § 3.2) : thème de chaque compte, choisi comme la langue.
 * `system` (par défaut) suit le réglage clair ou sombre de l'appareil.
 */
export default `
ALTER TABLE accounts ADD COLUMN theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system'));
`;
