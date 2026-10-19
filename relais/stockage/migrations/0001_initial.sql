-- Relais de réservation, schéma initial. Mêmes migrations pour D1 (wrangler d1 migrations apply) et node:sqlite.
-- Un relais sert plusieurs salons : chaque table de données porte l'identifiant du salon.

-- Salons servis par le relais. cle : clé partagée chiffrée (noyau/coffre.ts). origines : JSON, origines autorisées pour l'API publique.
CREATE TABLE salons (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  cle TEXT NOT NULL,
  etat TEXT NOT NULL DEFAULT 'actif',
  origines TEXT NOT NULL DEFAULT '[]',
  cree_le INTEGER NOT NULL,
  dernier_appel_le INTEGER
);

-- Offre et plages en place de chaque salon : une ligne chacune ('offre', 'disponibilites'), contenu JSON.
CREATE TABLE documents (
  salon TEXT NOT NULL,
  nom TEXT NOT NULL,
  version INTEGER NOT NULL,
  contenu TEXT NOT NULL,
  maj_le INTEGER NOT NULL,
  PRIMARY KEY (salon, nom)
);

-- Demandes des clientes. cliente et note sont effacées à l'accusé de lama ; l'empreinte du téléphone à la décision.
CREATE TABLE demandes (
  curseur INTEGER PRIMARY KEY AUTOINCREMENT,
  salon TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  jeton TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  prestation TEXT NOT NULL,
  prestation_nom TEXT NOT NULL,
  praticienne TEXT,
  date TEXT,
  debut INTEGER,
  fin INTEGER,
  souhait TEXT,
  cliente TEXT,
  note TEXT,
  telephone_empreinte TEXT,
  recue_le INTEGER NOT NULL,
  accusee_le INTEGER,
  decision TEXT,
  decidee_le INTEGER,
  -- 0 tant que le contrôle de créneau après insertion n'est pas passé : lama ne voit pas encore la demande.
  verifiee INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX demandes_non_accusees ON demandes (salon, accusee_le, curseur);
CREATE INDEX demandes_date ON demandes (salon, date);

-- Compteurs des limites (demandes par adresse, essais de connexion), clé préfixée par le salon, fenêtre de temps.
CREATE TABLE limites (
  cle TEXT PRIMARY KEY,
  fenetre INTEGER NOT NULL,
  compte INTEGER NOT NULL
);
