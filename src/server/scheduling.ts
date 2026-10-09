/**
 * Booking conflict detection.
 *
 * Pure interval maths, no database, so the rules can be unit-tested directly.
 *
 * Intervals are half-open `[start, end)`. That is the whole reason a 10:00-11:00
 * cut and an 11:00-12:00 colour are back-to-back rather than a clash: in a salon
 * the next client sits down the minute the last one gets up.
 *
 * Times are `HH:MM` wall clock in the business's own day. Minutes are counted
 * from midnight.
 */

import { message, type Lang } from "./messages.ts";

export type Interval = { start: number; end: number };

/** Something already occupying a staff member's day. */
export type Busy = {
  kind: "appointment" | "blocked";
  start_time: string;
  end_time: string;
  /**
   * Who or what holds the slot: the client's name, or the reason for the block.
   * Empty when there is neither: the screen words it in its own language.
   */
  label: string;
};

/** `"09:30"` -> `570`. Returns `null` for anything unparseable. */
export function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Ouverture et fermeture de la grille de l'agenda (décision 6 de la passe V 1.0), en minutes depuis minuit. */
export const DAY_OPEN = 7 * 60;
export const DAY_CLOSE = 21 * 60;
/** Heure de fermeture, telle que l'affichent les messages. */
export const CLOSE_TIME = "21:00";

/**
 * Heure acceptée par le serveur (décision 6) : `hh:mm` sur deux chiffres,
 * de 07:00 à 21:00, minutes multiples de 5, mêmes bornes que la grille de
 * l'écran. Rend la clé du refus, ou `null` si l'heure est acceptée.
 */
export function validTime(time: string): "rdv.heures_format" | "rdv.heures_plage" | null {
  if (!/^\d{2}:\d{2}$/.test(time ?? "")) return "rdv.heures_format";
  const minutes = toMinutes(time);
  if (minutes === null) return "rdv.heures_format";
  if (minutes < DAY_OPEN || minutes > DAY_CLOSE || minutes % 5 !== 0) return "rdv.heures_plage";
  return null;
}

/** Do two half-open intervals share any minute? */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Everything in `busy` that collides with `[start_time, end_time)`.
 *
 * A candidate that does not parse, or that does not run forwards, is treated as
 * having no conflicts: it is the caller's job to reject it, and answering
 * "clashes with nothing" is safer than answering from a nonsense interval.
 */
export function findConflicts(start_time: string, end_time: string, busy: Busy[]): Busy[] {
  const start = toMinutes(start_time);
  const end = toMinutes(end_time);
  if (start === null || end === null || end <= start) return [];
  return busy.filter((b) => {
    const bs = toMinutes(b.start_time);
    const be = toMinutes(b.end_time);
    if (bs === null || be === null || be <= bs) return false;
    return overlaps({ start, end }, { start: bs, end: be });
  });
}

/**
 * The 409 message.
 *
 * Written to be acted on rather than just read: an agent booking on behalf of
 * the owner gets the times that are taken and the two ways out, so it can offer
 * another slot instead of failing the request back to a human.
 */
export function describeConflicts(staffName: string, conflicts: Busy[], action: "book" | "block" = "book", lang: Lang = "en"): string {
  const liste = conflicts
    .map((c) => `${c.start_time}-${c.end_time} (${c.label || message(lang, c.kind === "blocked" ? "conflit.bloque" : "conflit.autre_rdv")})`)
    .join(", ");
  const key = conflicts.every((c) => c.kind === "blocked") ? "conflit.indisponible" : "conflit.rdv";
  return message(lang, key, {
    qui: staffName || message(lang, "conflit.ce_membre"),
    liste,
    verbe: message(lang, action === "block" ? "conflit.verbe.block" : "conflit.verbe.book"),
  });
}
