/**
 * Mini CRM (spec du 04/10/2026, § 1) : anniversaire sans année (`MM-JJ`, vide
 * s'il est inconnu), préférences en texte libre, étiquettes libres d'une
 * cliente. `tag_key` est l'étiquette repliée (`fold`) : deux écritures qui ne
 * diffèrent que par les accents ou les majuscules sont la même étiquette.
 * Les étiquettes partent avec la cliente (clés étrangères actives).
 */
export default `
ALTER TABLE clients ADD COLUMN birthday TEXT NOT NULL DEFAULT '' CHECK (birthday = '' OR birthday GLOB '[0-1][0-9]-[0-3][0-9]');
ALTER TABLE clients ADD COLUMN preferences TEXT NOT NULL DEFAULT '';
CREATE TABLE client_tags (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (length(tag) BETWEEN 1 AND 30),
  tag_key TEXT NOT NULL,
  PRIMARY KEY (client_id, tag_key)
);
CREATE INDEX client_tags_key ON client_tags(tag_key);
`;
