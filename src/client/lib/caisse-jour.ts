/**
 * « Caisse du jour » (sous-projet 5 § 6.3), sans dépendance au navigateur
 * pour être testée sous Node : jours voisins, espèces comptées saisies,
 * écart, moyens montrés, documents rangés par clôture, clôture possible.
 */
import type { CashClosing, CashDay, ClosingSummary, DayDocument, MethodTotal } from "./caisse-types.ts";
import type { Lang } from "../i18n/translate.ts";
import { formatPrice, readAmount } from "./format.ts";
import { CLOSING_WINDOW_DAYS } from "../../shared/caisse.ts";

/** Jour voisin `aaaa-mm-jj` (`delta` jours plus tard, ou plus tôt s'il est négatif). */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Espèces comptées saisies : `null` tant que le champ est vide ou illisible, 0 accepté (« 0 », « 0,00 »). */
export function parseCounted(text: string): number | null {
  const t = text.trim();
  return t === "" ? null : readAmount(t);
}

/** Écart entre les espèces comptées et attendues : juste, de plus ou de moins, et de combien. */
export function differenceOf(expected: number, counted: number): { kind: "juste" | "plus" | "moins"; amount: number } {
  const diff = counted - expected;
  return { kind: diff === 0 ? "juste" : diff > 0 ? "plus" : "moins", amount: Math.abs(diff) };
}

/** Moyens montrés : les espèces toujours (le tiroir se compte), les autres s'ils ont reçu ou remboursé. */
export function movedMethods(summary: ClosingSummary): MethodTotal[] {
  return summary.methods.filter((m) => m.method === "cash" || m.received > 0 || m.refunded > 0);
}

/** Documents du jour rangés sous la clôture qui les couvre, puis ceux qui ne le sont pas encore. */
export function documentGroups(report: CashDay): { closing: CashClosing | null; documents: DayDocument[] }[] {
  const groups = report.closings
    .map((closing) => ({ closing: closing as CashClosing | null, documents: report.documents.filter((d) => d.closing_id === closing.id) }))
    .filter((g) => g.documents.length > 0);
  const open = report.documents.filter((d) => d.closing_id === null);
  return open.length ? [...groups, { closing: null, documents: open }] : groups;
}

/**
 * « Clôturer la caisse » : le jour même ou un jour passé de 30 jours au plus
 * (au-delà, consultable seulement, comme le serveur), et quelque chose de
 * nouveau depuis la clôture précédente.
 */
export function canClose(report: CashDay, today: string): boolean {
  if (report.day > today || report.day < shiftDay(today, -CLOSING_WINDOW_DAYS)) return false;
  return report.closings.length === 0 || report.open.count > 0;
}

/** Montant qui peut être négatif (remboursements au-delà des encaissements) : signe moins typographique, « \u22129\u202f750\u00a0F ». */
export function signedPrice(amount: number, lang: Lang): string {
  return amount < 0 ? `\u2212${formatPrice(-amount, lang)}` : formatPrice(amount, lang);
}
