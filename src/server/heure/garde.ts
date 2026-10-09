/**
 * Caisse gardée contre une heure qui recule (distribution D-13) : si l'heure
 * du serveur est antérieure de plus d'une minute au dernier document numéroté
 * émis (facture, avoir ou reçu d'acompte), une nouvelle vente, un avoir ou un
 * acompte serait daté avant lui. Fonctions pures et lecture synchrone, pour
 * la transaction d'émission (`checkClock` dans `caisse/vente.ts`).
 */
import type { Database } from "../storage.ts";

/** Recul toléré : une minute (horloges des appareils, arrondis). */
export const MARGE_RECUL_MS = 60_000;

/** Instant du dernier document numéroté émis, `null` s'il n'y en a aucun. */
export const DERNIER_DOCUMENT_SQL = "SELECT MAX(at) AS at FROM (SELECT MAX(issued_at) AS at FROM invoices UNION ALL SELECT MAX(issued_at) AS at FROM deposits)";

export function dernierDocument(db: Database): number | null {
  const row = db.prepare(DERNIER_DOCUMENT_SQL).get() as { at: number | null } | undefined;
  return row?.at ?? null;
}

/** Vrai si `now` est antérieur de plus d'une minute au dernier document. */
export function heureRecule(derniere: number | null, now: number): boolean {
  return derniere !== null && now < derniere - MARGE_RECUL_MS;
}

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Douala" });
const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Douala" });

/** Date et heure de Douala, identiques dans les deux langues : `05/10/2026 14:32`. */
export function instantDouala(ms: number): string {
  return `${DATE.format(ms)} ${TIME.format(ms)}`;
}
