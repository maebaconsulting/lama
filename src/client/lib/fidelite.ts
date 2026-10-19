/**
 * Fidélité côté écran (mini CRM § 2), sans dépendance au navigateur : points
 * écrits dans la langue de l'écran, nombres entiers saisis. Les règles de
 * calcul sont partagées avec le serveur (`src/shared/fidelite.ts`).
 */
import { translate, translatePlural, type Key, type Lang } from "../i18n/translate.ts";
import { formatEntier, formatPrice, parseAmount, readAmount } from "./format.ts";
import { deviseActive } from "../../shared/devise-active.ts";
import { reachableTiers, type Tier } from "../../shared/fidelite.ts";

/** Nombre entier saisi (espaces de milliers tolérées) ; `null` si ce n'en est pas un. */
export function parseWhole(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f]/g, "");
  return /^\d{1,9}$/.test(clean) ? Number(clean) : null;
}

/** « 140 points », « 1 point », « −20 points » (signe moins typographique), milliers groupés. */
export function pointsText(points: number, lang: Lang): string {
  const nombre = `${points < 0 ? "−" : ""}${formatEntier(Math.abs(points))}`;
  return translatePlural(lang, "fidelite.points", Math.abs(points), { nombre });
}

/**
 * Montant saisi dans la rubrique Fidélité, en unités mineures : sans
 * centimes, une vraie décimale (« 1,5 ») est refusée ; avec centimes, la
 * lecture commune (`readAmount`) s'applique. `null` si illisible.
 */
export function parseWholeAmount(text: string): number | null {
  const t = text.trim();
  if (deviseActive().decimales > 0) {
    const v = readAmount(t);
    return v === null || v > 999_999_999 ? null : v;
  }
  if (!/^(\d+|\d{1,3}([.,\s\u00a0\u202f]\d{3})+)$/.test(t) || t.replace(/\D/g, "").length > 9) return null;
  return parseAmount(t);
}

/** Palier proposé à la caisse : remise appliquée (ramenée au sous-total) et `capped` si elle l'a été. */
export interface RewardChoice extends Tier {
  applied: number;
  capped: boolean;
}

/** Paliers que le solde atteint, avec la remise réellement appliquée sur ce sous-total (décision 14). */
export function rewardChoices(balance: number, tiers: readonly Tier[], subtotal: number): RewardChoice[] {
  const room = Math.max(subtotal, 0);
  return reachableTiers(balance, tiers).map((t) => ({ points: t.points, montant: t.montant, applied: Math.min(t.montant, room), capped: t.montant > room }));
}

export type LoyaltyKind = "gain" | "recompense" | "reprise" | "restitution" | "correction";

/** Écriture du registre telle que `GET /api/clients/:id/loyalty` la rend. */
export interface LoyaltyEntry {
  id: number;
  kind: LoyaltyKind;
  points: number;
  note: string;
  created_at: number;
  invoice_id: number | null;
  invoice_number: string | null;
  account_name: string | null;
}

const ENTRY_KEYS: Record<LoyaltyKind, Key> = {
  gain: "fidelite.ecriture.gain",
  recompense: "fidelite.ecriture.recompense",
  reprise: "fidelite.ecriture.reprise",
  restitution: "fidelite.ecriture.restitution",
  correction: "fidelite.ecriture.correction",
};

/** Libellé d'une écriture : nature et document (« Points gagnés, facture FAC-2026-000012 »), ou motif d'une correction. */
export function entryText(e: Pick<LoyaltyEntry, "kind" | "note" | "invoice_number">, lang: Lang): string {
  return translate(lang, ENTRY_KEYS[e.kind], { numero: e.invoice_number ?? "", motif: e.note });
}

/** Points signés : « +12 », « −12 » (signe moins typographique), milliers groupés. */
export function signedPoints(points: number, lang: Lang): string {
  return `${points < 0 ? "−" : "+"}${formatEntier(Math.abs(points))}`;
}

/** Prochain palier : « Encore 30 points avant 5 000 F de remise » ; sinon « Tous les paliers… ». */
export function nextTierText(next: { points: number; montant: number; missing: number } | null, lang: Lang): string {
  if (!next) return translate(lang, "fidelite.tous_paliers");
  return translate(lang, "fidelite.prochain_palier", { points: pointsText(next.missing, lang), montant: formatPrice(next.montant, lang) });
}

/** Correction la plus grande, dans un sens ou dans l'autre (mêmes bornes que le serveur). */
export const MAX_CORRECTION = 100_000;

/** Correction saisie : sens, nombre de 1 à 100 000 et motif de 1 à 200 caractères ; sinon la clé du message. */
export function correctionValue(direction: "ajouter" | "retirer", text: string, note: string): { points: number; note: string } | { error: Key } {
  const n = parseWhole(text);
  if (n === null || n < 1 || n > MAX_CORRECTION) return { error: "fidelite.erreur_points" };
  const motif = note.trim();
  if (motif === "" || motif.length > 200) return { error: "fidelite.erreur_motif" };
  return { points: direction === "retirer" ? -n : n, note: motif };
}
