import { enMinutes, localDe } from "./temps.ts";

/**
 * Horaires d'ouverture publiés avec l'offre (contrat v1, ajout du 18/10/2026, spec § 9.3) : même forme que le
 * réglage `institut.horaires` de lama. Ils servent seulement au message « dès l'ouverture » ; les créneaux
 * restent calculés depuis les plages libres. Module pur.
 */
export const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type Jour = (typeof JOURS)[number];
export type Horaires = Record<Jour, [string, string][]>;

/** Jour de la semaine d'une date `AAAA-MM-JJ`, calculé à midi UTC (aucun effet de fuseau). */
export function jourDe(date: string): Jour {
  return (["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] as const)[new Date(`${date}T12:00:00Z`).getUTCDay()];
}

/** L'institut est-il ouvert à `instant`, dans son fuseau ? `null` s'il n'a pas publié ses horaires. */
export function ouvertA(horaires: Horaires | undefined, instant: number, fuseau: string): boolean | null {
  if (!horaires) return null;
  const { date, minutes } = localDe(instant, fuseau);
  return (horaires[jourDe(date)] ?? []).some(([a, b]) => enMinutes(a) <= minutes && minutes < enMinutes(b));
}
