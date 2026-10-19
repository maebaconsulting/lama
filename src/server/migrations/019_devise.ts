/**
 * Devise de l'institut (spec du 15/10/2026) : une base déjà en service
 * (comptes, ventes, acomptes ou clôtures) écrit sa devise, XAF, pour ne plus
 * dépendre du défaut du code ; une installation neuve n'écrit rien. Dès la
 * première facture (ou avoir), le premier acompte ou la première clôture, le
 * réglage ne s'écrit plus, ne change plus et ne s'efface plus, même en SQL direct.
 */
const FIGEE = `(EXISTS (SELECT 1 FROM invoices) OR EXISTS (SELECT 1 FROM deposits) OR EXISTS (SELECT 1 FROM cash_closings))`;
// SQLite évalue les expressions sur NEW et OLD une fois, en tête du déclencheur, sans court-circuit des
// conditions qui les précèdent : un réglage secret (valeur scellée, pas du JSON) ferait échouer json_extract.
const valeur = (col: string) => `json_extract(CASE WHEN json_valid(${col}) THEN ${col} END, '$')`;

export default `
INSERT INTO settings (key, value, secret, updated_at)
SELECT 'institut.devise', json_quote('XAF'), 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE (${FIGEE} OR EXISTS (SELECT 1 FROM accounts))
   AND NOT EXISTS (SELECT 1 FROM settings WHERE key = 'institut.devise');

-- Un upsert (INSERT … ON CONFLICT DO UPDATE, celui de setSetting) passe d'abord par ce déclencheur :
-- la même valeur que celle enregistrée est acceptée, comme prefixe_fige_ajout (018).
CREATE TRIGGER devise_figee_ajout BEFORE INSERT ON settings
WHEN NEW.key = 'institut.devise' AND ${FIGEE}
  AND ${valeur("NEW.value")} IS NOT (SELECT json_extract(value, '$') FROM settings WHERE key = 'institut.devise')
BEGIN SELECT RAISE(ABORT, 'Devise figée.'); END;

CREATE TRIGGER devise_figee_changement BEFORE UPDATE ON settings
WHEN (OLD.key = 'institut.devise' OR NEW.key = 'institut.devise') AND ${FIGEE}
  AND (NEW.key IS NOT OLD.key OR ${valeur("NEW.value")} IS NOT ${valeur("OLD.value")})
BEGIN SELECT RAISE(ABORT, 'Devise figée.'); END;

CREATE TRIGGER devise_figee_retrait BEFORE DELETE ON settings
WHEN OLD.key = 'institut.devise' AND ${FIGEE}
BEGIN SELECT RAISE(ABORT, 'Devise figée.'); END;
`;
