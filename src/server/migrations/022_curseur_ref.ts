/**
 * Référence du curseur de la réservation en ligne (adresse du relais et salon) : un curseur ne vaut que
 * pour le relais et le salon qui l'ont donné. Quand l'un ou l'autre change, lama oublie le curseur et
 * relève depuis le début (les accusés et `contrat_id` évitent les doublons). Une base en service n'a pas
 * encore de référence : son curseur est oublié une fois, au premier tour.
 */
export default `
ALTER TABLE en_ligne_etat ADD COLUMN curseur_ref TEXT;
`;
