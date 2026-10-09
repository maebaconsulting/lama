/**
 * Sous-projet 7, vague 1 (spec § 2 et § 3) : WhatsApp. Accord de la cliente
 * (`whatsapp_ok`, coché par défaut) et langue de ses messages (`fr`, `en`,
 * vide = langue de l'institut) ; heure à laquelle le rendez-vous a été pris
 * ou déplacé (`booked_at`, en millisecondes, nulle pour les rendez-vous
 * antérieurs) pour ne pas rappeler un rendez-vous pris moins de
 * `whatsapp.rappel_heures` à l'avance ; sort donné à la main à un envoi
 * (`manual` : vide, `sent` « marqué comme envoyé », `ignored` « ignoré »).
 */
export default `
ALTER TABLE clients ADD COLUMN whatsapp_ok INTEGER NOT NULL DEFAULT 1 CHECK (whatsapp_ok IN (0, 1));
ALTER TABLE clients ADD COLUMN language TEXT NOT NULL DEFAULT '' CHECK (language IN ('', 'fr', 'en'));
ALTER TABLE appointments ADD COLUMN booked_at INTEGER;
ALTER TABLE outbox ADD COLUMN manual TEXT NOT NULL DEFAULT '' CHECK (manual IN ('', 'sent', 'ignored'));
`;
