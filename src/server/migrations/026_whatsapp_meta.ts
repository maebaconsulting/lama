/**
 * WhatsApp Business (spec du 21/10/2026, W-7) : identifiant du message chez le fournisseur (Meta : `wamid`),
 * gardé avec l'envoi pour les accusés de remise d'une version suivante ; vide pour WAHA, le SMS et les autres envois.
 */
export default `
ALTER TABLE outbox ADD COLUMN provider_ref TEXT NOT NULL DEFAULT '';
`;
