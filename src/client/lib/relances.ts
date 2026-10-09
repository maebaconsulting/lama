/**
 * Bloc « Relances » de la rubrique Messages (mini CRM, décisions 23 à 25),
 * fonctions pures : valeurs du serveur en texte de formulaire (pour
 * `rebase` de `reglages.ts`), puis texte saisi en valeurs contrôlées à
 * enregistrer, avec les mêmes bornes que le serveur.
 */
import type { Setting } from "./api-types.ts";
import type { Key } from "../i18n/translate.ts";
import { DEFAULT_ABSENCE_DAYS } from "./crm.ts";

export const RELANCE_KEYS = ["relances.anniversaire", "relances.absence", "relances.absence_jours", "relances.heure"] as const;
export type RelanceKey = (typeof RELANCE_KEYS)[number];
export type RelanceChange = { key: RelanceKey; value: boolean | number | string };

const FLAGS: readonly string[] = ["relances.anniversaire", "relances.absence"];

/** Valeurs du serveur en texte : cases en `oui` ou `non`, seuil et heure tels quels (vides si invisibles). */
export function relanceValues(settings: Setting[]): Record<RelanceKey, string> {
  const out = {} as Record<RelanceKey, string>;
  for (const key of RELANCE_KEYS) {
    const value = settings.find((s) => s.key === key)?.value;
    if (FLAGS.includes(key)) out[key] = value === true ? "oui" : "non";
    else out[key] = value === null || value === undefined ? "" : String(value);
  }
  return out;
}

/** Champs changés en valeurs à enregistrer, ou la clé du premier problème (seuil de 15 à 365 jours, heure `hh:mm`). */
export function relanceChanges(before: Record<RelanceKey, string>, after: Record<RelanceKey, string>): { changes: RelanceChange[] } | { error: Key } {
  const changes: RelanceChange[] = [];
  for (const key of RELANCE_KEYS) {
    if (after[key] === before[key]) continue;
    if (FLAGS.includes(key)) {
      changes.push({ key, value: after[key] === "oui" });
    } else if (key === "relances.absence_jours") {
      const text = after[key].trim();
      const days = /^\d{1,3}$/.test(text) ? Number(text) : Number.NaN;
      if (!(days >= 15 && days <= 365)) return { error: "relances.probleme.jours" };
      changes.push({ key, value: days });
    } else {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(after[key])) return { error: "relances.probleme.heure" };
      changes.push({ key, value: after[key] });
    }
  }
  return { changes };
}

/** Seuil d'absence rendu par `GET /api/relances/seuil` ; le défaut de la vague 1 tant qu'il n'est pas lu, ou s'il est hors bornes. */
export function absenceThreshold(data: { absence_days?: unknown } | null): number {
  const days = data?.absence_days;
  return typeof days === "number" && Number.isInteger(days) && days >= 15 && days <= 365 ? days : DEFAULT_ABSENCE_DAYS;
}
