/**
 * Journée de l'institut et créneaux horaires proposés dans les listes
 * d'heures (ChampHeure). Une seule source pour l'agenda (calendar-view.tsx)
 * et les champs. Sans dépendance au navigateur (testé sous Node).
 */

/** Première heure de la journée (graduation de l'agenda). */
export const DAY_START_HOUR = 7;
/** Fin de la journée : la dernière graduation est 20:00, la journée se termine à 21:00. */
export const DAY_END_HOUR = 21;
/** Pas des créneaux, en minutes. */
export const SLOT_MINUTES = 15;

/** Début d'un horaire (rendez-vous, blocage) ou fin d'un horaire. */
export type Borne = "debut" | "fin";

const pad = (n: number) => String(n).padStart(2, "0");
const label = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Créneaux de 15 minutes sur 24 h : début de 07:00 à 20:45, fin de 07:15 à
 * 21:00. Une valeur existante hors grille ou hors bornes (09:10, 22:00) est
 * insérée à sa place pour ne jamais être perdue.
 */
export function timeSlots(borne: Borne, current = ""): string[] {
  const first = DAY_START_HOUR * 60 + (borne === "fin" ? SLOT_MINUTES : 0);
  const last = DAY_END_HOUR * 60 - (borne === "debut" ? SLOT_MINUTES : 0);
  const slots: string[] = [];
  for (let m = first; m <= last; m += SLOT_MINUTES) slots.push(label(m));
  const value = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(current);
  if (!value) return slots;
  const extra = `${value[1]}:${value[2]}`;
  if (slots.includes(extra)) return slots;
  const at = slots.findIndex((s) => s > extra);
  if (at === -1) slots.push(extra);
  else slots.splice(at, 0, extra);
  return slots;
}
