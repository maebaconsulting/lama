/**
 * Mini CRM, vague 2 (spec § 2 et § 3) : registre de la fidélité et table des
 * campagnes (utilisée par la vague 3). Le registre n'a que des écritures
 * signées, jamais modifiées : le solde d'une cliente est leur somme. Une
 * écriture de vente ou d'avoir cite son document ; une correction n'en cite
 * aucun ; gain et restitution sont positifs, récompense et reprise négatives.
 * Déclencheurs : aucune modification, aucune suppression (sauf la cascade de
 * la suppression d'une cliente, qui n'arrive que pour une cliente sans
 * facture : la ligne de la cliente a déjà disparu quand la cascade passe),
 * aucun remplacement par `INSERT OR REPLACE`. AUTOINCREMENT : un identifiant
 * n'est jamais repris, le solde figé du ticket (« écritures d'identifiant
 * inférieur ou égal ») reste exact.
 */
export default `
CREATE TABLE loyalty_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_id INTEGER REFERENCES invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('gain', 'recompense', 'reprise', 'restitution', 'correction')),
  points INTEGER NOT NULL CHECK (points <> 0),
  note TEXT NOT NULL DEFAULT '',
  account_id INTEGER,
  created_at INTEGER NOT NULL,
  CHECK ((kind = 'correction') = (invoice_id IS NULL)),
  CHECK (kind = 'correction' OR (kind IN ('gain', 'restitution')) = (points > 0))
);
CREATE INDEX loyalty_entries_client ON loyalty_entries(client_id);
CREATE INDEX loyalty_entries_invoice ON loyalty_entries(invoice_id);

CREATE TRIGGER loyalty_entries_immuables BEFORE UPDATE ON loyalty_entries
BEGIN SELECT RAISE(ABORT, 'Une écriture de fidélité ne se modifie pas.'); END;
CREATE TRIGGER loyalty_entries_gardees BEFORE DELETE ON loyalty_entries
WHEN EXISTS (SELECT 1 FROM clients WHERE id = OLD.client_id)
BEGIN SELECT RAISE(ABORT, 'Une écriture de fidélité ne se supprime pas.'); END;
CREATE TRIGGER loyalty_entries_reecriture BEFORE INSERT ON loyalty_entries
WHEN EXISTS (SELECT 1 FROM loyalty_entries WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Une écriture de fidélité ne se modifie pas.'); END;

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tag TEXT NOT NULL,
  text_fr TEXT NOT NULL,
  text_en TEXT NOT NULL DEFAULT '',
  recipients INTEGER NOT NULL,
  excluded INTEGER NOT NULL,
  account_id INTEGER,
  created_at INTEGER NOT NULL
);
`;
