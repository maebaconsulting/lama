/**
 * Distribution D-01 : préfixe des factures réglable (`caisse.prefixe`).
 * Une base déjà en service (des comptes ou des factures) garde la série
 * qu'elle a toujours eue, écrite par ses codes de caractères (`char(79, 67, 80)`,
 * aucun nom d'institut en clair dans le dépôt public, démo publique DP-12) ; une installation neuve n'écrit rien, le code prend
 * le défaut (`DEFAULT_INVOICE_PREFIX`) jusqu'au choix de l'administrateur.
 * `invoices_nature` n'exige plus cette série : une facture porte 2 à 6 lettres
 * majuscules ou chiffres dont une lettre au moins, ni AV ni AC, la série réglée s'il y en a une, et la
 * même série que toutes les factures déjà émises. Le réglage lui-même ne
 * change plus, ne s'efface plus et ne s'écrit plus autrement dès qu'une
 * facture existe, même en SQL direct. Les autres règles (avoir en AV qui cite
 * une facture, facture sans facture corrigée) ne changent pas.
 */
export default `
INSERT INTO settings (key, value, secret, updated_at)
SELECT 'caisse.prefixe', json_quote(char(79, 67, 80)), 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE (EXISTS (SELECT 1 FROM invoices) OR EXISTS (SELECT 1 FROM accounts))
   AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'caisse.prefixe');

DROP TRIGGER invoices_nature;

CREATE TRIGGER invoices_nature BEFORE INSERT ON invoices
WHEN (NEW.kind = 'invoice' AND (NEW.credited_invoice_id IS NOT NULL
      OR length(NEW.series) NOT BETWEEN 2 AND 6 OR NEW.series GLOB '*[^A-Z0-9]*' OR NEW.series NOT GLOB '*[A-Z]*' OR NEW.series IN ('AV', 'AC')
      OR NEW.series IS NOT COALESCE((SELECT json_extract(value, '$') FROM settings WHERE key = 'caisse.prefixe'), NEW.series)
      OR NEW.series IS NOT COALESCE((SELECT series FROM invoices WHERE kind = 'invoice' ORDER BY id LIMIT 1), NEW.series)))
  OR (NEW.kind = 'credit_note' AND (NEW.series <> 'AV' OR trim(NEW.reason) = ''
      OR NEW.total_ttc < 0 OR NEW.discount_amount < 0
      OR NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.credited_invoice_id AND kind = 'invoice')))
BEGIN SELECT RAISE(ABORT, 'Nature du document incohérente.'); END;

CREATE TRIGGER prefixe_fige_ajout BEFORE INSERT ON settings
WHEN NEW.key = 'caisse.prefixe'
  AND COALESCE((SELECT series FROM invoices WHERE kind = 'invoice' ORDER BY id LIMIT 1), json_extract(NEW.value, '$')) IS NOT json_extract(NEW.value, '$')
BEGIN SELECT RAISE(ABORT, 'Préfixe des factures figé.'); END;

CREATE TRIGGER prefixe_fige_changement BEFORE UPDATE ON settings
WHEN (OLD.key = 'caisse.prefixe' OR NEW.key = 'caisse.prefixe')
  AND EXISTS (SELECT 1 FROM invoices WHERE kind = 'invoice' LIMIT 1)
  AND (NEW.key <> 'caisse.prefixe'
    OR (SELECT series FROM invoices WHERE kind = 'invoice' ORDER BY id LIMIT 1) IS NOT json_extract(NEW.value, '$'))
BEGIN SELECT RAISE(ABORT, 'Préfixe des factures figé.'); END;

CREATE TRIGGER prefixe_fige_retrait BEFORE DELETE ON settings
WHEN OLD.key = 'caisse.prefixe' AND EXISTS (SELECT 1 FROM invoices WHERE kind = 'invoice')
BEGIN SELECT RAISE(ABORT, 'Préfixe des factures figé.'); END;
`;
