/**
 * Heure du serveur vue de l'écran (distribution D-11, D-12) : écart entre
 * l'en-tête `Date` des réponses du serveur et l'horloge de l'appareil,
 * texte de cet écart, heure saisie à la main. Fonctions pures, plus la
 * dernière heure lue, notée par `api()` à chaque réponse.
 */
import type { Role } from "./auth-types.ts";
import { translate, translatePlural, type Key, type Lang } from "../i18n/translate.ts";
import { formatInstant } from "./format.ts";
import { timeFromText } from "./saisie-date.ts";

/** Réponse de `GET /api/heure` (administrateur et gérante). */
export interface EtatHeure { serveur: number; derniere_facture: number | null; caisse_bloquee: boolean }

/** Réponse de `POST /api/heure` : `synchro` n'est présent que s'il vaut `false` ; caisse et dernière facture recalculées après le réglage. */
export interface ReponseReglage { ancienne: number; nouvelle: number; synchro?: boolean; derniere_facture: number | null; caisse_bloquee: boolean }

/** Avertissement à montrer après un réglage réussi : clé du texte et, au besoin, l'instant du dernier document. */
export interface AvertissementReglage { key: Key; derniere?: number }

/**
 * Avertissements d'après la réponse du réglage : synchronisation automatique
 * non réactivée (appeler le technicien) ; caisse encore bloquée (elle le reste
 * tant que l'heure n'a pas dépassé celle du dernier document).
 */
export function avertissementsReglage(r: Pick<ReponseReglage, "synchro" | "derniere_facture" | "caisse_bloquee">): AvertissementReglage[] {
  const liste: AvertissementReglage[] = [];
  if (r.synchro === false) liste.push({ key: "heure.synchro_non_retablie" });
  if (r.caisse_bloquee && r.derniere_facture !== null) liste.push({ key: "heure.caisse_reste_bloquee", derniere: r.derniere_facture });
  return liste;
}

/** Écart au-delà duquel le bandeau s'affiche : 2 minutes (D-11). */
export const SEUIL_ECART_MS = 2 * 60_000;

const DOUALA_OFFSET_MS = 60 * 60_000;
const MIN = Date.UTC(2026, 0, 1);
const MAX = Date.UTC(2100, 0, 1);

/**
 * Écart en millisecondes (positif : le serveur est en avance sur
 * l'appareil), d'après l'en-tête `Date` (à la seconde) et l'heure de
 * l'appareil à la réception ; `null` sans en-tête lisible.
 */
export function ecartHeure(dateHeader: string | null | undefined, appareilMs: number): number | null {
  if (!dateHeader) return null;
  const serveur = Date.parse(dateHeader);
  return Number.isNaN(serveur) ? null : serveur - appareilMs;
}

/** Vrai si l'écart dépasse 2 minutes, dans un sens ou dans l'autre. */
export function ecartVisible(ecart: number | null): boolean {
  return ecart !== null && Math.abs(ecart) > SEUIL_ECART_MS;
}

/** Bandeau d'heure : administrateur et gérante seulement (D-11). */
export const voitHeure = (role: Role) => role === "admin" || role === "manager";

/** Écart lisible : minutes jusqu'à 2 h, puis heures jusqu'à 2 jours, puis jours. */
export function ecartTexte(ecart: number, lang: Lang): string {
  const ms = Math.abs(ecart);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 120) return translate(lang, "heure.ecart_min", { n: minutes });
  const heures = Math.round(ms / 3_600_000);
  if (heures < 48) return translate(lang, "heure.ecart_h", { n: heures });
  return translatePlural(lang, "heure.ecart_jours", Math.round(ms / 86_400_000));
}

/**
 * Heure saisie à la main (date `aaaa-mm-jj` de `ChampDate`, heure `hh:mm`
 * en texte), à Douala, en millisecondes ; refus lisible si l'une manque ou
 * sort de la plage que le serveur accepte (2026 à 2099).
 */
export function heureSaisie(date: string, heure: string): { value: number } | { error: Key } {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const h = timeFromText(heure);
  if (!d || !h) return { error: "saisie.date_heure_manquantes" };
  const [hh, mm] = h.split(":").map(Number);
  const value = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hh, mm) - DOUALA_OFFSET_MS;
  if (value < MIN || value >= MAX) return { error: "heure.hors_plage" };
  return { value };
}

/**
 * Texte du bandeau d'heure (D-11, D-13), en forme longue et courte (téléphone : `court` pour l'administrateur, qui a le lien, `gerante` avec la consigne),
 * ou `null` s'il n'y a rien à dire : la caisse bloquée passe avant l'écart,
 * qu'elle explique. Heures montrées à Douala, celle de l'appareil prise à `appareilMs`.
 */
export function bandeauHeure(etat: EtatHeure, ecart: number | null, appareilMs: number, lang: Lang): { long: string; court: string; gerante: string } | null {
  if (etat.caisse_bloquee && etat.derniere_facture !== null) {
    return {
      long: translate(lang, "bandeau.heure_caisse", { serveur: formatInstant(etat.serveur, lang), derniere: formatInstant(etat.derniere_facture, lang) }),
      court: translate(lang, "bandeau.heure_caisse_court"),
      gerante: translate(lang, "bandeau.heure_caisse_gerante"),
    };
  }
  if (ecart === null || !ecartVisible(ecart)) return null;
  const texte = ecartTexte(ecart, lang);
  return {
    long: translate(lang, "bandeau.heure_ecart", { ecart: texte, serveur: formatInstant(appareilMs + ecart, lang), appareil: formatInstant(appareilMs, lang) }),
    court: translate(lang, "bandeau.heure_ecart_court", { ecart: texte }),
    gerante: translate(lang, "bandeau.heure_ecart_gerante"),
  };
}

let dernier: number | null = null;

/** Note l'écart lu sur une réponse du serveur (appelé par `api()`). */
export function noterDate(dateHeader: string | null | undefined, appareilMs: number): void {
  const ecart = ecartHeure(dateHeader, appareilMs);
  if (ecart !== null) dernier = ecart;
}

/** Dernier écart lu, `null` avant la première réponse. */
export function dernierEcart(): number | null {
  return dernier;
}
