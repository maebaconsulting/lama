/**
 * Mise à jour par le réseau (spec du 21/10/2026, M-12, M-15) : ligne unique de l'état de la rubrique
 * « Mise à jour ». Dernière consultation du serveur des versions (date, version, date de publication,
 * note dans les deux langues, erreur sous forme codée) et dernière opération déjà inscrite au journal
 * (une seule inscription par opération, même après un redémarrage).
 */
export default `
CREATE TABLE mise_a_jour_etat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  verifie_le INTEGER,
  version TEXT,
  publiee_le INTEGER,
  note_fr TEXT,
  note_en TEXT,
  erreur TEXT,
  operation_journalisee TEXT
);
INSERT INTO mise_a_jour_etat (id) VALUES (1);
`;
