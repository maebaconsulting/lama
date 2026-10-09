/**
 * Acompte déduit d'une vente au comptoir (V1-78). `deposits_deduit` acceptait
 * seulement une facture du rendez-vous de l'acompte ; il accepte aussi une
 * facture sans rendez-vous, de la même cliente (jamais sans cliente), sans
 * aucune prestation, quand le rendez-vous de l'acompte est annulé ou que la
 * cliente est absente. La base reste le dernier garde-fou : tout autre
 * rattachement est refusé, même en SQL direct.
 */
export default `
DROP TRIGGER deposits_deduit;

CREATE TRIGGER deposits_deduit BEFORE UPDATE ON deposits
WHEN NEW.status = 'applied' AND NOT EXISTS (
  SELECT 1 FROM invoices i WHERE i.id = NEW.applied_invoice_id AND i.kind = 'invoice' AND (
    i.appointment_id = NEW.appointment_id
    OR (i.appointment_id IS NULL AND NEW.client_id IS NOT NULL AND i.client_id = NEW.client_id
      AND (SELECT status FROM appointments WHERE id = NEW.appointment_id) IN ('cancelled', 'no_show')
      AND NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = i.id AND kind <> 'product'))))
BEGIN SELECT RAISE(ABORT, 'Acompte déduit d''une facture d''un autre rendez-vous.'); END;
`;
