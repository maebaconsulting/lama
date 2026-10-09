/**
 * Numéro de carte d'une cliente (mini CRM § 5), commun au serveur et à
 * l'écran : lettres et chiffres, 4 à 32, enregistré sans espaces ni tirets
 * et en majuscules, pour qu'un numéro tapé à la main ou lu par un lecteur
 * soit toujours le même.
 */
export const CARD_FORMAT = /^[A-Z0-9]{4,32}$/;

/** Forme enregistrée d'un numéro saisi ou lu : espaces et tirets retirés, majuscules. */
export function normalizeCard(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}
