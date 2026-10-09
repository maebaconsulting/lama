/**
 * Passerelle SMS (spec du 04/10/2026, § 1) : canal de la cliente à la place
 * de l'accord WhatsApp (`whatsapp_ok` 1 → « whatsapp », 0 → « none ») ;
 * canal réellement utilisé par chaque envoi de la file (vide tant qu'il
 * n'est pas parti, ou pour les autres types d'envoi).
 */
export default `
ALTER TABLE clients ADD COLUMN channel TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'sms', 'none'));
UPDATE clients SET channel = CASE whatsapp_ok WHEN 1 THEN 'whatsapp' ELSE 'none' END;
ALTER TABLE clients DROP COLUMN whatsapp_ok;
ALTER TABLE outbox ADD COLUMN channel TEXT NOT NULL DEFAULT '' CHECK (channel IN ('', 'whatsapp', 'sms'));
`;
