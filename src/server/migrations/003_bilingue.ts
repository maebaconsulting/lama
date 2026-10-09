/**
 * Sous-projet 3 : versions anglaises facultatives des données (texte vide par
 * défaut, repli sur le français à l'affichage) et langue de chaque compte.
 * Les données existantes restent en français, sans reprise (spec § 5.1).
 */
export default `
ALTER TABLE services ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN description_en TEXT NOT NULL DEFAULT '';
ALTER TABLE services ADD COLUMN category_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN name_en TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN category_en TEXT NOT NULL DEFAULT '';
ALTER TABLE staff ADD COLUMN title_en TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'fr' CHECK (language IN ('fr', 'en'));
`;
