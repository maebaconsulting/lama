/**
 * Règles de la fidélité (mini CRM, spec § 2, décisions 12 à 17), communes à
 * l'écran et au serveur : points gagnés sur une facture, paliers atteints et
 * prochain palier, points repris par un avoir, contrôle des paliers réglés.
 * Nombres entiers seulement ; testé sous Node.
 */
import { deviseActive } from "./devise-active.ts";

/** Règle de gain : `points` par tranche entière de `tranche` unités mineures. */
export interface LoyaltyRule {
  tranche: number;
  points: number;
}

/** Palier de récompense : `points` dépensés pour `montant` unités mineures de remise. */
export interface Tier {
  points: number;
  montant: number;
}

/** Paliers par défaut (spec § 2). */
export const DEFAULT_TIERS: readonly Tier[] = [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }];

/**
 * Bornes des réglages (spec § 2 du mini CRM ; devise du 15/10/2026) : montants
 * en unités mineures, minimum 100 (100 F, 1,00 €), maximum 1 000 000 d'unités
 * de la devise pour la tranche, 10 000 000 pour une remise de palier.
 */
export function loyaltyLimits(decimales: number = deviseActive().decimales) {
  const k = 10 ** decimales;
  return {
    tranche: { min: 100, max: 1_000_000 * k },
    points: { min: 1, max: 100 },
    tiers: { min: 1, max: 5 },
    tierPoints: { min: 1, max: 100_000 },
    tierMontant: { min: 100, max: 10_000_000 * k },
  } as const;
}

/** Points d'une facture : tranches entières du total TTC (après remise, pourboire exclu), jamais négatif. */
export function pointsFor(totalTtc: number, rule: LoyaltyRule): number {
  if (!(totalTtc > 0) || !(rule.tranche > 0)) return 0;
  return Math.floor(totalTtc / rule.tranche) * rule.points;
}

const byPoints = (tiers: readonly Tier[]) => [...tiers].sort((a, b) => a.points - b.points);

/** Paliers que le solde permet d'utiliser, du plus petit au plus grand. */
export function reachableTiers(balance: number, tiers: readonly Tier[]): Tier[] {
  return byPoints(tiers).filter((t) => t.points <= balance);
}

/** Premier palier que le solde n'atteint pas encore, avec les points qui manquent ; `null` si tous sont atteints. */
export function nextTier(balance: number, tiers: readonly Tier[]): (Tier & { missing: number }) | null {
  const next = byPoints(tiers).find((t) => t.points > balance);
  return next ? { points: next.points, montant: next.montant, missing: next.points - balance } : null;
}

/**
 * Points repris par un avoir (décision 17) : points gagnés × TTC de l'avoir ÷
 * TTC de la facture, arrondi au point supérieur, jamais plus que ce qui reste
 * (`gained - alreadyTaken`) ; l'avoir qui annule la facture reprend tout ce
 * qui reste. Arrondi supérieur en entiers, sans virgule flottante.
 */
export function reprisePoints(gained: number, alreadyTaken: number, creditTtc: number, invoiceTtc: number, completes: boolean): number {
  const remaining = Math.max(gained - alreadyTaken, 0);
  if (completes) return remaining;
  if (remaining === 0 || invoiceTtc <= 0 || creditTtc <= 0) return 0;
  const share = Math.floor((gained * creditTtc + invoiceTtc - 1) / invoiceTtc);
  return Math.min(share, remaining);
}

/** Refus d'une liste de paliers : clé du message du serveur (`messages.ts`), reprise par l'écran. */
export type TierProblem = "reglage.paliers_nombre" | "reglage.paliers_points" | "reglage.paliers_montant" | "reglage.paliers_ordre";

const within = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Contrôle des paliers réglés : 1 à 5, points de 1 à 100 000 strictement croissants, remise de 100 unités mineures à 10 000 000 unités de la devise. */
export function tiersProblem(value: unknown, decimales?: number): TierProblem | null {
  const L = loyaltyLimits(decimales);
  if (!Array.isArray(value) || value.length < L.tiers.min || value.length > L.tiers.max) return "reglage.paliers_nombre";
  let previous = 0;
  for (const raw of value) {
    const tier = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!within(tier.points, L.tierPoints.min, L.tierPoints.max)) return "reglage.paliers_points";
    if (!within(tier.montant, L.tierMontant.min, L.tierMontant.max)) return "reglage.paliers_montant";
    if ((tier.points as number) <= previous) return "reglage.paliers_ordre";
    previous = tier.points as number;
  }
  return null;
}
