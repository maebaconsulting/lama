/**
 * Mention de la base de formation sur les documents (distribution D-17,
 * D-18) : « FORMATION » en tête et au pied de chaque ticket, sur papier comme
 * en PDF (facture, avoir, reçu d'acompte, clôture, ticket de test). Style
 * `total` (gras, double hauteur sur papier) et jamais `titre` : sur papier,
 * « DUPLICATA » se place sous le premier titre, qui doit rester celui du
 * document. Démonstration publique (démo publique, DP-04) : « DÉMONSTRATION »
 * (« DEMO » en anglais) à la place.
 */
import type { TicketRow } from "../caisse/ticket.ts";
import { message, type Lang } from "../messages.ts";
import { estDemoPublique, estFormation } from "./mode.ts";

/** Rangées marquées en formation ; hors formation, les mêmes rangées, intactes. */
export function marquerFormation(rows: TicketRow[], lang: Lang): TicketRow[] {
  if (!estFormation()) return rows;
  const mention: TicketRow = { type: "text", text: message(lang, estDemoPublique() ? "demo.ticket" : "formation.ticket"), style: "total", align: "center" };
  return [mention, { type: "rule" }, ...rows, { type: "rule" }, mention];
}
