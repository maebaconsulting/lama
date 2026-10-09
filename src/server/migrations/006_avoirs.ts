/**
 * Sous-projet 5, vague 3a (spec § 3, § 6.1) : avoirs. La série des factures de
 * la première installation est écrite par ses codes de caractères (`char(79, 67, 80)`) :
 * aucun nom d'institut en clair dans le dépôt public (démo publique DP-12) ; la
 * migration 018 remplace ce déclencheur par le préfixe réglable. Un avoir est une ligne
 * de `invoices` (`kind = 'credit_note'`, série AV) qui cite la facture
 * corrigée ; chacune de ses lignes cite la ligne de la facture qu'elle
 * reprend (`credited_line_id`). Les déclencheurs tiennent, même en SQL
 * direct : la nature de chaque document (série, facture corrigée, motif,
 * jamais de montant ni de remise négatifs sur un avoir), la quantité reprise
 * d'une ligne et le total des avoirs d'une facture jamais au-delà de
 * l'original, le signe des versements (négatif pour le remboursement d'un
 * avoir), et aucun pourboire sur un avoir. La vue
 * `invoice_balance` dit, pour chaque facture, le total déjà repris et si
 * toutes ses quantités l'ont été (facture « annulée » : le rendez-vous
 * redevient à encaisser, § 3.4).
 */
export default `
ALTER TABLE invoice_lines ADD COLUMN credited_line_id INTEGER REFERENCES invoice_lines(id);
CREATE INDEX invoice_lines_credited ON invoice_lines(credited_line_id);
CREATE INDEX invoices_credited ON invoices(credited_invoice_id);

CREATE TRIGGER invoices_nature BEFORE INSERT ON invoices
WHEN (NEW.kind = 'invoice' AND (NEW.series <> char(79, 67, 80) OR NEW.credited_invoice_id IS NOT NULL))
  OR (NEW.kind = 'credit_note' AND (NEW.series <> 'AV' OR trim(NEW.reason) = ''
      OR NEW.total_ttc < 0 OR NEW.discount_amount < 0
      OR NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.credited_invoice_id AND kind = 'invoice')))
BEGIN SELECT RAISE(ABORT, 'Nature du document incohérente.'); END;

CREATE TRIGGER avoirs_plafond BEFORE INSERT ON invoices
WHEN NEW.kind = 'credit_note'
  AND NEW.total_ttc + (SELECT COALESCE(SUM(total_ttc), 0) FROM invoices WHERE credited_invoice_id = NEW.credited_invoice_id)
    > (SELECT total_ttc FROM invoices WHERE id = NEW.credited_invoice_id)
BEGIN SELECT RAISE(ABORT, 'Avoirs au-delà du total de la facture.'); END;

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
       AND l.kind = NEW.kind AND l.ref_id = NEW.ref_id AND l.unit_price = NEW.unit_price)
  OR NEW.quantity + (SELECT COALESCE(SUM(quantity), 0) FROM invoice_lines WHERE credited_line_id = NEW.credited_line_id)
    > (SELECT quantity FROM invoice_lines WHERE id = NEW.credited_line_id))
BEGIN SELECT RAISE(ABORT, 'Quantité reprise au-delà de la ligne de la facture.'); END;

CREATE TRIGGER payments_signe BEFORE INSERT ON payments
WHEN NEW.invoice_id IS NOT NULL
  AND (NEW.amount = 0 OR ((SELECT kind FROM invoices WHERE id = NEW.invoice_id) = 'credit_note') <> (NEW.amount < 0))
BEGIN SELECT RAISE(ABORT, 'Signe du versement incohérent.'); END;

CREATE TRIGGER tips_facture BEFORE INSERT ON tips
WHEN (SELECT kind FROM invoices WHERE id = NEW.invoice_id) <> 'invoice'
BEGIN SELECT RAISE(ABORT, 'Un avoir n''a pas de pourboire.'); END;

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
