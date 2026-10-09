/**
 * Rubrique « Clientes et fidélité » des Réglages (mini CRM § 2, interrupteur général en tête), fonctions pures :
 * valeurs du serveur en formulaire, contrôle de la saisie (mêmes bornes que
 * le serveur), changements réels à enregistrer et exemple calculé.
 */
import type { Setting } from "./api-types.ts";
import type { Key } from "../i18n/translate.ts";
import { parseWhole, parseWholeAmount } from "./fidelite.ts";
import { DEFAULT_TIERS, LOYALTY_LIMITS, pointsFor, tiersProblem, type LoyaltyRule, type Tier, type TierProblem } from "../../shared/fidelite.ts";

/** Réglages de la rubrique, dans l'ordre de l'écran. */
export const FIDELITE_KEYS = ["crm.active", "fidelite.active", "fidelite.tranche", "fidelite.points", "fidelite.paliers"] as const;
export type FideliteKey = (typeof FIDELITE_KEYS)[number];

/** Saisie d'un palier, en texte. */
export interface TierInput {
  points: string;
  montant: string;
}

export interface FideliteForm {
  /** Interrupteur général du mini CRM (bloc « Mini CRM » en tête de la rubrique). */
  crm: boolean;
  active: boolean;
  tranche: string;
  points: string;
  tiers: TierInput[];
}

/** Message de succès selon les réglages enregistrés : l'interrupteur seul, la fidélité seule, ou les deux. */
export function savedMessage(changes: readonly { key: FideliteKey }[]): Key {
  const crm = changes.some((c) => c.key === "crm.active");
  const loyalty = changes.some((c) => c.key !== "crm.active");
  if (crm && loyalty) return "reglages_crm.enregistres_tous";
  return crm ? "reglages_crm.enregistre" : "reglages_fidelite.enregistres";
}

/** Champ fautif, signalé à sa place. */
export type FideliteField = "tranche" | "points" | "paliers";

/** Facture de l'exemple de la rubrique (spec § 2 : « Une facture de 23 500 F rapporte 23 points »). */
export const EXAMPLE_AMOUNT = 23500;
export const MAX_TIERS: number = LOYALTY_LIMITS.tiers.max;

const TIER_KEYS: Record<TierProblem, Key> = {
  "reglage.paliers_nombre": "reglages_fidelite.erreur_paliers_nombre",
  "reglage.paliers_points": "reglages_fidelite.erreur_paliers_points",
  "reglage.paliers_montant": "reglages_fidelite.erreur_paliers_montant",
  "reglage.paliers_ordre": "reglages_fidelite.erreur_paliers_ordre",
};

/** Valeurs du serveur en formulaire ; défauts de la spec pour un réglage absent. */
export function fideliteForm(settings: Setting[]): FideliteForm {
  const value = (key: FideliteKey) => settings.find((s) => s.key === key)?.value;
  const stored = value("fidelite.paliers");
  const tiers = Array.isArray(stored) ? (stored as Tier[]) : [...DEFAULT_TIERS];
  const tranche = value("fidelite.tranche");
  const points = value("fidelite.points");
  return {
    crm: value("crm.active") !== false,
    active: value("fidelite.active") === true,
    tranche: String(typeof tranche === "number" ? tranche : 1000),
    points: String(typeof points === "number" ? points : 1),
    tiers: tiers.map((t) => ({ points: String(t.points), montant: String(t.montant) })),
  };
}

const inRange = (n: number | null, limits: { min: number; max: number }): n is number => n !== null && n >= limits.min && n <= limits.max;

/** Règle saisie, si elle est valable. */
export function ruleOf(form: FideliteForm): LoyaltyRule | null {
  const tranche = parseWholeAmount(form.tranche);
  const points = parseWhole(form.points);
  return inRange(tranche, LOYALTY_LIMITS.tranche) && inRange(points, LOYALTY_LIMITS.points) ? { tranche, points } : null;
}

/** Paliers saisis, en nombres (texte illisible : `NaN`, refusé par `tiersProblem`). */
export function tiersOf(form: FideliteForm): Tier[] {
  return form.tiers.map((t) => ({ points: parseWhole(t.points) ?? Number.NaN, montant: parseWholeAmount(t.montant) ?? Number.NaN }));
}

/** Points rapportés par la facture de l'exemple avec la règle saisie ; `null` si la règle n'est pas valable. */
export function examplePoints(form: FideliteForm): number | null {
  const rule = ruleOf(form);
  return rule ? pointsFor(EXAMPLE_AMOUNT, rule) : null;
}

/** Ajoute un palier vide, cinq au plus. */
export function addTier(form: FideliteForm): FideliteForm {
  return form.tiers.length >= MAX_TIERS ? form : { ...form, tiers: [...form.tiers, { points: "", montant: "" }] };
}

/** Retire le palier `index`. */
export function removeTier(form: FideliteForm, index: number): FideliteForm {
  return { ...form, tiers: form.tiers.filter((_, i) => i !== index) };
}

/** Saisie d'un champ du palier `index`. */
export function setTier(form: FideliteForm, index: number, patch: Partial<TierInput>): FideliteForm {
  return { ...form, tiers: form.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) };
}

/**
 * Changements à enregistrer, dans l'ordre de la rubrique : seulement ce qui
 * change vraiment (« 1 000 » retapé « 1000 » n'est pas un changement, rien
 * au journal) ; sinon la première erreur et son champ (rien n'est enregistré).
 */
export function fideliteChanges(baseline: FideliteForm, form: FideliteForm): { changes: { key: FideliteKey; value: unknown }[] } | { error: Key; field: FideliteField } {
  const changes: { key: FideliteKey; value: unknown }[] = [];
  if (form.crm !== baseline.crm) changes.push({ key: "crm.active", value: form.crm });
  if (form.active !== baseline.active) changes.push({ key: "fidelite.active", value: form.active });
  const tranche = parseWholeAmount(form.tranche);
  if (!inRange(tranche, LOYALTY_LIMITS.tranche)) return { error: "reglages_fidelite.erreur_tranche", field: "tranche" };
  if (tranche !== parseWholeAmount(baseline.tranche)) changes.push({ key: "fidelite.tranche", value: tranche });
  const points = parseWhole(form.points);
  if (!inRange(points, LOYALTY_LIMITS.points)) return { error: "reglages_fidelite.erreur_points", field: "points" };
  if (points !== parseWhole(baseline.points)) changes.push({ key: "fidelite.points", value: points });
  const tiers = tiersOf(form);
  const problem = tiersProblem(tiers);
  if (problem) return { error: TIER_KEYS[problem], field: "paliers" };
  if (JSON.stringify(tiers) !== JSON.stringify(tiersOf(baseline))) changes.push({ key: "fidelite.paliers", value: tiers });
  return { changes };
}
