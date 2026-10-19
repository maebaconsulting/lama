/**
 * Rendez-vous et suppléments à l'écran (spec du 18/10/2026 § 3.3) : total de la prise de
 * rendez-vous, brouillons d'une prestation décochée, décision après un refus du serveur.
 * Module pur, testé sous Node.
 */
import type { Service } from "../types.ts";
import type { Conflict } from "./conflit-texte.ts";
import { draftTotals, type DraftSupplement } from "./supplements.ts";

/** Prix et durée de la prise de rendez-vous : prestations choisies et leurs suppléments. */
export function bookingTotals(services: Service[], selected: number[], drafts: Record<number, DraftSupplement[]>): { price: number; minutes: number } {
  const chosen = services.filter((s) => selected.includes(s.id));
  const extra = draftTotals(selected.flatMap((id) => drafts[id] ?? []));
  return {
    price: chosen.reduce((sum, s) => sum + s.price, 0) + extra.price,
    minutes: chosen.reduce((sum, s) => sum + s.duration, 0) + extra.minutes,
  };
}

/** Brouillons sans ceux d'une prestation décochée. */
export function withoutDrafts(drafts: Record<number, DraftSupplement[]>, serviceId: number): Record<number, DraftSupplement[]> {
  const { [serviceId]: _retire, ...reste } = drafts;
  return reste;
}

/**
 * Après un refus du serveur : `clashes` vient de `conflictsFrom` (`null` si ce n'est pas un 409).
 * Un 409 avec conflits propose « Enregistrer quand même » ; un 409 sans conflits (rendez-vous
 * encaissé entre-temps) se dit en message seul et demande de relire la fiche ; le reste est un message.
 */
export function afterSaveError(clashes: Conflict[] | null, message: string): { conflicts: Conflict[] | null; error: string | null; reload: boolean } {
  if (clashes && clashes.length > 0) return { conflicts: clashes, error: null, reload: false };
  return { conflicts: null, error: message, reload: clashes !== null };
}
