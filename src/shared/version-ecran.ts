/**
 * Version du contrat entre l'écran et le serveur (PWA, P-05). L'écran l'envoie
 * dans l'en-tête `X-Lama-Ecran` de chaque requête à l'API ; le serveur refuse
 * (409, code `ecran_perime`) un écran plus ancien que `VERSION_ECRAN_MINIMALE`,
 * et l'écran recharge alors de lui-même sa nouvelle version. Augmenter les
 * deux nombres ensemble le jour où un écran resté ouvert ne doit plus parler
 * au nouveau serveur.
 */
export const VERSION_ECRAN = 1;
export const VERSION_ECRAN_MINIMALE = 1;
export const ENTETE_VERSION_ECRAN = "X-Lama-Ecran";

/**
 * Vrai si le serveur répond à cet écran. Sans en-tête (curl, agent IA, page du
 * certificat) ou avec une valeur qui n'est pas un entier, la requête n'est pas
 * celle d'un écran de lama : acceptée. Seul un entier plus petit que la
 * version minimale est refusé.
 */
export function ecranAccepte(entete: string | null | undefined, minimale: number = VERSION_ECRAN_MINIMALE): boolean {
  if (entete === null || entete === undefined || entete.trim() === "") return true;
  const version = Number(entete);
  return !Number.isInteger(version) || version >= minimale;
}
