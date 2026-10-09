/**
 * Sous-projet 5, vague 1 (spec § 3) : factures, lignes, versements,
 * pourboires et suites de numérotation. Montants en francs CFA entiers.
 * Déclencheurs : aucune facture, ligne, versement ni pourboire ne se modifie
 * ni ne se supprime, même en SQL direct, y compris par `INSERT OR REPLACE`
 * (SQLite ne déclenche pas les triggers `DELETE` de ce remplacement, donc un
 * déclencheur `BEFORE INSERT` refuse toute clé déjà présente dans chaque
 * table) ; une suite n'avance que d'un pas, et le numéro d'une facture est
 * celui que sa suite vient de prendre, sans trou même si la suite a été
 * avancée à la main sans facture correspondante. Pas de suppression en
 * cascade vers ces tables : les clés étrangères refusent de supprimer une
 * cliente, un rendez-vous ou un membre facturé.
 */
export default `
CREATE TABLE sequences (
  series TEXT NOT NULL,
  year INTEGER NOT NULL,
  last INTEGER NOT NULL,
  PRIMARY KEY (series, year)
);

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('invoice', 'credit_note')),
  number TEXT NOT NULL UNIQUE,
  series TEXT NOT NULL,
  year INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  issued_at INTEGER NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('fr', 'en')),
  client_id INTEGER REFERENCES clients(id),
  appointment_id INTEGER REFERENCES appointments(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  subtotal INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  discount_kind TEXT CHECK (discount_kind IN ('percent', 'amount')),
  discount_value INTEGER,
  discount_reason TEXT NOT NULL DEFAULT '',
  total_ttc INTEGER NOT NULL,
  total_ht INTEGER NOT NULL,
  total_tva INTEGER NOT NULL,
  fiscal TEXT NOT NULL,
  credited_invoice_id INTEGER REFERENCES invoices(id),
  reason TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL UNIQUE,
  UNIQUE (series, year, seq),
  CHECK (total_ht + total_tva = total_ttc),
  CHECK (subtotal - discount_amount = total_ttc)
);
CREATE INDEX invoices_issued ON invoices(issued_at);
CREATE INDEX invoices_appointment ON invoices(appointment_id);
CREATE INDEX invoices_client ON invoices(client_id);

CREATE TABLE invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'product')),
  ref_id INTEGER NOT NULL,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL,
  staff_id INTEGER REFERENCES staff(id),
  restock INTEGER NOT NULL DEFAULT 0,
  CHECK (line_total = quantity * unit_price)
);
CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id),
  deposit_id INTEGER,
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'orange_money', 'momo')),
  amount INTEGER NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  cash_given INTEGER,
  change_given INTEGER NOT NULL DEFAULT 0,
  CHECK (invoice_id IS NOT NULL OR deposit_id IS NOT NULL)
);
CREATE INDEX payments_invoice ON payments(invoice_id);

CREATE TABLE tips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  amount INTEGER NOT NULL CHECK (amount > 0)
);
CREATE INDEX tips_invoice ON tips(invoice_id);

CREATE TRIGGER sequences_debut BEFORE INSERT ON sequences WHEN NEW.last <> 1
BEGIN SELECT RAISE(ABORT, 'Une suite de numérotation commence à 1.'); END;
CREATE TRIGGER sequences_pas BEFORE UPDATE ON sequences
WHEN NEW.series <> OLD.series OR NEW.year <> OLD.year OR NEW.last <> OLD.last + 1
BEGIN SELECT RAISE(ABORT, 'Une suite de numérotation n''avance que d''un pas.'); END;
CREATE TRIGGER sequences_gardees BEFORE DELETE ON sequences
BEGIN SELECT RAISE(ABORT, 'Une suite de numérotation ne se supprime pas.'); END;
CREATE TRIGGER sequences_reecriture BEFORE INSERT ON sequences
WHEN EXISTS (SELECT 1 FROM sequences WHERE series = NEW.series AND year = NEW.year)
BEGIN SELECT RAISE(ABORT, 'Une suite de numérotation ne se supprime pas.'); END;

CREATE TRIGGER invoices_numero BEFORE INSERT ON invoices
WHEN NEW.seq IS NOT (SELECT last FROM sequences WHERE series = NEW.series AND year = NEW.year)
  OR NEW.number <> printf('%s-%d-%06d', NEW.series, NEW.year, NEW.seq)
  OR (NEW.seq <> 1 AND NOT EXISTS (SELECT 1 FROM invoices WHERE series = NEW.series AND year = NEW.year AND seq = NEW.seq - 1))
BEGIN SELECT RAISE(ABORT, 'Numéro de facture hors de sa suite.'); END;

CREATE TRIGGER invoices_immuables BEFORE UPDATE ON invoices
BEGIN SELECT RAISE(ABORT, 'Une facture ne se modifie pas.'); END;
CREATE TRIGGER invoices_gardees BEFORE DELETE ON invoices
BEGIN SELECT RAISE(ABORT, 'Une facture ne se supprime pas.'); END;
CREATE TRIGGER invoices_reecriture BEFORE INSERT ON invoices
WHEN EXISTS (SELECT 1 FROM invoices WHERE id = NEW.id)
  OR EXISTS (SELECT 1 FROM invoices WHERE number = NEW.number)
  OR EXISTS (SELECT 1 FROM invoices WHERE request_id = NEW.request_id)
  OR EXISTS (SELECT 1 FROM invoices WHERE series = NEW.series AND year = NEW.year AND seq = NEW.seq)
BEGIN SELECT RAISE(ABORT, 'Une facture ne se modifie pas.'); END;
CREATE TRIGGER invoice_lines_immuables BEFORE UPDATE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'Une ligne de facture ne se modifie pas.'); END;
CREATE TRIGGER invoice_lines_gardees BEFORE DELETE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'Une ligne de facture ne se supprime pas.'); END;
CREATE TRIGGER invoice_lines_reecriture BEFORE INSERT ON invoice_lines
WHEN EXISTS (SELECT 1 FROM invoice_lines WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Une ligne de facture ne se modifie pas.'); END;
CREATE TRIGGER payments_immuables BEFORE UPDATE ON payments
BEGIN SELECT RAISE(ABORT, 'Un versement ne se modifie pas.'); END;
CREATE TRIGGER payments_gardes BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'Un versement ne se supprime pas.'); END;
CREATE TRIGGER payments_reecriture BEFORE INSERT ON payments
WHEN EXISTS (SELECT 1 FROM payments WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Un versement ne se modifie pas.'); END;
CREATE TRIGGER tips_immuables BEFORE UPDATE ON tips
BEGIN SELECT RAISE(ABORT, 'Un pourboire ne se modifie pas.'); END;
CREATE TRIGGER tips_gardes BEFORE DELETE ON tips
BEGIN SELECT RAISE(ABORT, 'Un pourboire ne se supprime pas.'); END;
CREATE TRIGGER tips_reecriture BEFORE INSERT ON tips
WHEN EXISTS (SELECT 1 FROM tips WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Un pourboire ne se modifie pas.'); END;
`;
