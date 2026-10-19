/**
 * Suppléments paramétrables (spec du 18/10/2026 § 3) : case « supplément seulement »
 * d'une prestation, liste ordonnée de ses suppléments possibles (prestations ou produits),
 * suppléments posés sur une prestation d'un rendez-vous (prix, minutes et libellés figés),
 * et lignes de facture rattachées à leur prestation (`parent_line_id`), dont le supplément
 * libre (type `libre`, sans article). `invoice_lines` est reconstruite pour accepter
 * `libre` et un `ref_id` vide pour lui seul : lignes, identifiants et numérotation gardés ;
 * déclencheurs d'immuabilité recréés, celui des avoirs compare `ref_id` avec `IS` ;
 * vue `invoice_balance` et déclencheur `deposits_deduit` recréés à l'identique.
 */
export default `
ALTER TABLE services ADD COLUMN supplement_seulement INTEGER NOT NULL DEFAULT 0 CHECK (supplement_seulement IN (0, 1));

CREATE TABLE service_supplements (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'product')),
  ref_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (service_id, kind, ref_id),
  CHECK (NOT (kind = 'service' AND ref_id = service_id))
);
CREATE INDEX idx_service_supplements_ref ON service_supplements(kind, ref_id);
CREATE TRIGGER service_supplements_prestation_retiree AFTER DELETE ON services
BEGIN DELETE FROM service_supplements WHERE kind = 'service' AND ref_id = OLD.id; END;
CREATE TRIGGER service_supplements_produit_retire AFTER DELETE ON products
BEGIN DELETE FROM service_supplements WHERE kind = 'product' AND ref_id = OLD.id; END;

CREATE TABLE appointment_supplements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_service_id INTEGER NOT NULL REFERENCES appointment_services(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service', 'product', 'libre')),
  ref_id INTEGER,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  price INTEGER NOT NULL CHECK (price >= 0),
  minutes INTEGER NOT NULL CHECK (minutes BETWEEN 0 AND 720),
  position INTEGER NOT NULL,
  CHECK ((kind = 'libre') = (ref_id IS NULL)),
  CHECK (kind <> 'libre' OR (length(trim(label_fr)) BETWEEN 1 AND 80 AND minutes <= 240)),
  CHECK (kind = 'product' OR quantity = 1),
  CHECK (kind <> 'product' OR minutes = 0)
);
CREATE INDEX idx_appointment_supplements_service ON appointment_supplements(appointment_service_id);

DROP VIEW invoice_balance;
DROP TRIGGER deposits_deduit;

CREATE TABLE invoice_lines_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL CHECK (kind IN ('service', 'product', 'libre')),
  ref_id INTEGER,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  line_total INTEGER NOT NULL,
  staff_id INTEGER REFERENCES staff(id),
  restock INTEGER NOT NULL DEFAULT 0,
  credited_line_id INTEGER REFERENCES invoice_lines_v2(id),
  parent_line_id INTEGER REFERENCES invoice_lines_v2(id),
  CHECK (line_total = quantity * unit_price),
  CHECK ((kind = 'libre') = (ref_id IS NULL))
);
INSERT INTO invoice_lines_v2 (id, invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id, restock, credited_line_id)
  SELECT id, invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id, restock, credited_line_id FROM invoice_lines ORDER BY id;
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'invoice_lines_v2', seq FROM sqlite_sequence WHERE name = 'invoice_lines'
   AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'invoice_lines_v2');
UPDATE sqlite_sequence SET seq = (SELECT seq FROM sqlite_sequence WHERE name = 'invoice_lines')
 WHERE name = 'invoice_lines_v2' AND seq < (SELECT seq FROM sqlite_sequence WHERE name = 'invoice_lines');
DROP TABLE invoice_lines;
ALTER TABLE invoice_lines_v2 RENAME TO invoice_lines;

CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id);
CREATE INDEX invoice_lines_credited ON invoice_lines(credited_line_id);
CREATE INDEX invoice_lines_parent ON invoice_lines(parent_line_id);

CREATE TRIGGER invoice_lines_immuables BEFORE UPDATE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'Une ligne de facture ne se modifie pas.'); END;
CREATE TRIGGER invoice_lines_gardees BEFORE DELETE ON invoice_lines
BEGIN SELECT RAISE(ABORT, 'Une ligne de facture ne se supprime pas.'); END;
CREATE TRIGGER invoice_lines_reecriture BEFORE INSERT ON invoice_lines
WHEN EXISTS (SELECT 1 FROM invoice_lines WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'Une ligne de facture ne se modifie pas.'); END;

CREATE TRIGGER invoice_lines_nature BEFORE INSERT ON invoice_lines
WHEN ((SELECT kind FROM invoices WHERE id = NEW.invoice_id) = 'credit_note' AND NEW.credited_line_id IS NULL)
  OR ((SELECT kind FROM invoices WHERE id = NEW.invoice_id) = 'invoice' AND (NEW.credited_line_id IS NOT NULL OR NEW.restock <> 0))
  OR (NEW.restock <> 0 AND NEW.kind <> 'product')
BEGIN SELECT RAISE(ABORT, 'Ligne incohérente avec son document.'); END;

CREATE TRIGGER avoir_lignes_plafond BEFORE INSERT ON invoice_lines
WHEN NEW.credited_line_id IS NOT NULL AND (
  NOT EXISTS (
    SELECT 1 FROM invoice_lines l JOIN invoices a ON a.id = NEW.invoice_id
     WHERE l.id = NEW.credited_line_id AND l.invoice_id = a.credited_invoice_id
       AND l.kind = NEW.kind AND l.ref_id IS NEW.ref_id AND l.unit_price = NEW.unit_price AND l.label_fr = NEW.label_fr)
  OR NEW.quantity + (SELECT COALESCE(SUM(quantity), 0) FROM invoice_lines WHERE credited_line_id = NEW.credited_line_id)
    > (SELECT quantity FROM invoice_lines WHERE id = NEW.credited_line_id))
BEGIN SELECT RAISE(ABORT, 'Quantité reprise au-delà de la ligne de la facture.'); END;

CREATE TRIGGER invoice_lines_supplement BEFORE INSERT ON invoice_lines
WHEN (NEW.parent_line_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM invoice_lines p WHERE p.id = NEW.parent_line_id AND p.invoice_id = NEW.invoice_id
           AND p.kind = 'service' AND p.parent_line_id IS NULL))
  OR (NEW.kind = 'libre' AND NEW.parent_line_id IS NULL AND (SELECT kind FROM invoices WHERE id = NEW.invoice_id) = 'invoice')
BEGIN SELECT RAISE(ABORT, 'Supplément sans sa prestation sur le même document.'); END;

CREATE TRIGGER deposits_deduit BEFORE UPDATE ON deposits
WHEN NEW.status = 'applied' AND NOT EXISTS (
  SELECT 1 FROM invoices i WHERE i.id = NEW.applied_invoice_id AND i.kind = 'invoice' AND (
    i.appointment_id = NEW.appointment_id
    OR (i.appointment_id IS NULL AND NEW.client_id IS NOT NULL AND i.client_id = NEW.client_id
      AND (SELECT status FROM appointments WHERE id = NEW.appointment_id) IN ('cancelled', 'no_show')
      AND NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = i.id AND kind <> 'product'))))
BEGIN SELECT RAISE(ABORT, 'Acompte déduit d''une facture d''un autre rendez-vous.'); END;

CREATE VIEW invoice_balance AS
SELECT i.id AS invoice_id, i.appointment_id, i.client_id, i.total_ttc,
       COALESCE((SELECT SUM(a.total_ttc) FROM invoices a WHERE a.credited_invoice_id = i.id), 0) AS credited_total,
       CASE WHEN EXISTS (
         SELECT 1 FROM invoice_lines l
          WHERE l.invoice_id = i.id
            AND l.quantity > COALESCE((SELECT SUM(x.quantity) FROM invoice_lines x WHERE x.credited_line_id = l.id), 0)
       ) THEN 0 ELSE 1 END AS cancelled
  FROM invoices i
 WHERE i.kind = 'invoice';
`;
