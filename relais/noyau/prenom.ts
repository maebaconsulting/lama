/**
 * Forme d'un prénom : une seule ligne, lettres de toutes langues, apostrophe, trait d'union et point en fin de mot (jamais l'adresse d'un site), au plus
 * 3 mots séparés par une espace simple. Le prénom est repris dans les messages de l'institut : rien d'autre n'y passe.
 */
export const FORME_PRENOM = /^(?=.*\p{L})[\p{L}\p{M}'’-]+\.?(?: [\p{L}\p{M}'’-]+\.?){0,2}$/u;

/**
 * Forme d'un nom complet : une seule ligne de 120 caractères au plus, de 1 à 8 mots séparés par une espace simple, faits de lettres, d'apostrophe,
 * de trait d'union et d'un point en fin de mot (jamais l'adresse d'un site). Le nom est repris dans les messages de l'institut et dans la fiche.
 */
export const FORME_NOM = /^(?=.{1,120}$)(?=.*\p{L})[\p{L}\p{M}'’-]+\.?(?: [\p{L}\p{M}'’-]+\.?){0,7}$/u;
