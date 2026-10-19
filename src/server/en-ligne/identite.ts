/**
 * Formes du prénom et du nom d'une demande en ligne. Copies de `FORME_PRENOM` et `FORME_NOM` du relais (`relais/noyau/prenom.ts`),
 * car le code de lama n'importe rien de `relais/` ; un essai vérifie qu'elles restent identiques.
 */
export const FORME_PRENOM_LAMA = /^(?=.*\p{L})[\p{L}\p{M}'’-]+\.?(?: [\p{L}\p{M}'’-]+\.?){0,2}$/u;
export const FORME_NOM_LAMA = /^(?=.{1,120}$)(?=.*\p{L})[\p{L}\p{M}'’-]+\.?(?: [\p{L}\p{M}'’-]+\.?){0,7}$/u;

/**
 * Nom reçu, rendu inoffensif sans jamais le refuser : toute suite d'espaces (sauts de ligne, tabulations, espace insécable)
 * devient une espace simple, les caractères de contrôle et de format (U+200B, U+202E…) partent, 120 caractères au plus.
 */
export function nettoyerNom(nom: string): string {
  return nom.replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/ {2,}/g, " ").trim().slice(0, 120).trim();
}
