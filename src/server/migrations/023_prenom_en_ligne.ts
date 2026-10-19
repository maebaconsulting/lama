/**
 * Prénom de la cliente d'une demande en ligne, transmis à part par un relais récent
 * (`cliente.prenom`). NULL pour une demande déjà reçue ou venue d'un relais plus ancien : lama ne devine
 * alors aucun prénom.
 */
export default `
ALTER TABLE demandes_en_ligne ADD COLUMN cliente_prenom TEXT;
`;
