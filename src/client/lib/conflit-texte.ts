/** Texte des conflits d'horaire, composé par l'écran dans sa langue (pur, testé en exécution). */
import { translate, type Lang } from "../i18n/translate.ts";
import { formatRange } from "./format.ts";

/** One thing already in the way of a booking, as the API reports it. */
export type Conflict = {
  kind: "appointment" | "blocked";
  start_time: string;
  end_time: string;
  /** The client holding the slot, or the reason the time is blocked; empty when there is neither. */
  label: string;
};

/**
 * « 10:00–11:00 réservé pour Aïcha Mbarga », le motif d'un créneau bloqué, ou,
 * sans cliente ni motif (`label` vide, sous-projet 4 § 7.3), « déjà réservé »
 * et « bloqué » écrits dans la langue de l'écran, jamais dans celle de la requête.
 */
export function describeConflict(c: Conflict, lang: Lang): string {
  const plage = formatRange(c.start_time, c.end_time);
  if (c.kind === "blocked") return c.label ? `${plage} ${c.label}` : translate(lang, "conflit.creneau_bloque", { plage });
  return c.label ? translate(lang, "conflit.reserve_pour", { plage, nom: c.label }) : translate(lang, "conflit.deja_reserve", { plage });
}

/** Une phrase, là où il n'y a pas la place de lister les conflits. */
export function conflictSentence(lang: Lang, who: string, conflicts: Conflict[]): string {
  return translate(lang, "conflit.phrase", {
    qui: who || translate(lang, "conflit.ce_membre"),
    liste: conflicts.map((c) => describeConflict(c, lang)).join(", "),
  });
}
