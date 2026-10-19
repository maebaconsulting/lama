/** Motifs partagés entre le noyau et les pages (aucun import : les pages n'ont pas à charger zod). */

/** Premiers segments d'adresse du relais, interdits comme identifiants de salon. */
export const SALONS_RESERVES: readonly string[] = Object.freeze(["api", "gestion", "lama", "assets"]);

/** Identifiant de salon : 1 à 32 caractères, minuscules, chiffres et tirets (ni en tête ni en fin). */
export const MOTIF_SALON = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Origine d'un site : schéma, hôte et port éventuel, sans chemin. */
export const MOTIF_ORIGINE = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/;
