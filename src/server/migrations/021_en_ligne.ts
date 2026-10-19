/**
 * Réservation en ligne, étape 3 (spec du 16/10/2026 § 4.3 et § 4.4) : demandes reçues du relais, avec leur
 * état, la praticienne demandée et celle retenue, la fiche trouvée et la décision à transmettre ; état de la
 * liaison (curseur du relevé, empreintes et versions publiées, dernier échange, dernière erreur) ; marque
 * En ligne des rendez-vous créés depuis une demande. Une prestation, une praticienne ou une fiche
 * supprimée laisse la demande en place (`ON DELETE SET NULL`), avec le nom qu'avait la prestation.
 */
export default `
ALTER TABLE appointments ADD COLUMN en_ligne INTEGER NOT NULL DEFAULT 0;

CREATE TABLE demandes_en_ligne (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrat_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('creneau', 'rappel')),
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  prestation_ref TEXT NOT NULL,
  prestation_nom TEXT NOT NULL DEFAULT '',
  prestation_nom_en TEXT NOT NULL DEFAULT '',
  staff_demande_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  sans_preference INTEGER NOT NULL DEFAULT 0 CHECK (sans_preference IN (0, 1)),
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  cliente_nom TEXT NOT NULL,
  cliente_telephone TEXT NOT NULL,
  cliente_langue TEXT NOT NULL CHECK (cliente_langue IN ('fr', 'en')),
  note TEXT NOT NULL DEFAULT '',
  souhait TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  fiche TEXT NOT NULL CHECK (fiche IN ('connue', 'nouvelle', 'a_verifier')),
  etat TEXT NOT NULL CHECK (etat IN ('a_confirmer', 'en_conflit', 'a_rappeler', 'confirmee', 'autre_horaire', 'refusee', 'traitee')),
  tentatives INTEGER NOT NULL DEFAULT 0,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  autre_date TEXT,
  autre_heure TEXT,
  autre_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  motif TEXT NOT NULL DEFAULT '',
  recue_le INTEGER NOT NULL,
  enregistree_le INTEGER NOT NULL,
  accusee_le INTEGER,
  decidee_le INTEGER,
  decidee_par INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  decision TEXT,
  decision_envoyee_le INTEGER
);
CREATE INDEX idx_demandes_en_ligne_etat ON demandes_en_ligne(etat);
CREATE INDEX idx_demandes_en_ligne_agenda ON demandes_en_ligne(staff_id, date);

CREATE TABLE en_ligne_etat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  curseur TEXT,
  offre_empreinte TEXT,
  offre_version INTEGER NOT NULL DEFAULT 0,
  offre_publiee_le INTEGER,
  plages_empreinte TEXT,
  plages_version INTEGER NOT NULL DEFAULT 0,
  plages_publiees_le INTEGER,
  dernier_succes_le INTEGER,
  derniere_erreur TEXT,
  derniere_erreur_le INTEGER,
  attente_relais INTEGER
);
INSERT INTO en_ligne_etat (id) VALUES (1);
`;
