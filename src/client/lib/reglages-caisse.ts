/**
 * Rubrique « Caisse » des Réglages (sous-projet 5 § 5.2), fonctions pures :
 * valeurs du serveur en texte de formulaire (pour `rebase` et `changedKeys`
 * de `reglages.ts`), puis texte saisi en valeurs contrôlées à enregistrer.
 */
import type { Setting } from "./api-types.ts";
import { formatRate } from "./format.ts";
import { PAYMENT_METHODS, isInvoicePrefix, normalizeInvoicePrefix, type PaymentMethod } from "../../shared/caisse.ts";
import type { Key, Lang } from "../i18n/translate.ts";

/** Réglages de la rubrique, dans l'ordre de l'écran. */
export const CAISSE_KEYS = [
  "institut.niu", "institut.rccm",
  "caisse.tva_active", "caisse.tva_taux",
  "caisse.mentions_fr", "caisse.mentions_en",
  "caisse.remises", "caisse.remise_plafond", "caisse.pourboires", "caisse.acomptes", "caisse.avoirs_reception", "caisse.encaissement_praticienne",
  "caisse.moyens",
  "caisse.imprimante", "caisse.imprimer_logo",
] as const;

export type CaisseKey = (typeof CAISSE_KEYS)[number];

const BOOLEANS: readonly string[] = ["caisse.tva_active", "caisse.remises", "caisse.pourboires", "caisse.acomptes", "caisse.avoirs_reception", "caisse.encaissement_praticienne", "caisse.imprimer_logo"];

/** Valeurs du serveur en texte : `oui`/`non`, taux dans la langue de l'écran (`19,25`), moyens séparés par des virgules. */
export function caisseValues(settings: Setting[], lang: Lang): Record<CaisseKey, string> {
  const out = {} as Record<CaisseKey, string>;
  for (const key of CAISSE_KEYS) {
    const value = settings.find((s) => s.key === key)?.value;
    if (BOOLEANS.includes(key)) out[key] = value === true ? "oui" : "non";
    else if (key === "caisse.tva_taux") out[key] = typeof value === "number" ? formatRate(value, lang) : "";
    else if (key === "caisse.moyens") out[key] = Array.isArray(value) ? PAYMENT_METHODS.filter((m) => value.includes(m)).join(",") : "";
    else out[key] = value === null || value === undefined ? "" : String(value);
  }
  return out;
}

/** Moyens cochés, dans l'ordre d'affichage. */
export function methodsOf(text: string): PaymentMethod[] {
  const set = text.split(",");
  return PAYMENT_METHODS.filter((m) => set.includes(m));
}

/** Coche ou décoche un moyen ; rend le texte du formulaire. */
export function toggleMethod(text: string, method: PaymentMethod, on: boolean): string {
  const set = new Set(methodsOf(text));
  if (on) set.add(method);
  else set.delete(method);
  return PAYMENT_METHODS.filter((m) => set.has(m)).join(",");
}

/** Taux de TVA saisi (`19,25` ou `19.25`, `%` toléré) : de 0 à 100, deux décimales au plus ; `null` sinon. */
export function parseRate(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f%]/g, "").replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const rate = Number(clean);
  return rate <= 100 ? rate : null;
}

/** Plafond de remise saisi : pourcentage entier de 0 à 100 ; `null` sinon. */
export function parseCap(text: string): number | null {
  const clean = text.replace(/[\s\u00a0\u202f%]/g, "");
  if (!/^\d{1,3}$/.test(clean)) return null;
  const cap = Number(clean);
  return cap <= 100 ? cap : null;
}

/** Valeur à enregistrer pour un champ, ou le message d'erreur à afficher. */
export function caisseValue(key: CaisseKey, text: string): { value: unknown } | { error: Key } {
  if (BOOLEANS.includes(key)) return { value: text === "oui" };
  if (key === "caisse.tva_taux") {
    const rate = parseRate(text);
    return rate === null ? { error: "reglages_caisse.erreur_taux" } : { value: rate };
  }
  if (key === "caisse.remise_plafond") {
    const cap = parseCap(text);
    return cap === null ? { error: "reglages_caisse.erreur_plafond" } : { value: cap };
  }
  if (key === "caisse.moyens") {
    const methods = methodsOf(text);
    return methods.length ? { value: methods } : { error: "reglages_caisse.erreur_moyens" };
  }
  return { value: text.trim() };
}

/**
 * Changements à envoyer, dans l'ordre de l'écran : seulement les champs dont
 * la valeur contrôlée change vraiment (`19.25` retapé `19,25` n'est pas un
 * changement, rien au journal). Première erreur rencontrée sinon : rien
 * n'est enregistré ; la clé du réglage fautif accompagne le message pour que
 * l'écran signale le bon champ, même très haut dans un long formulaire.
 * Un champ grisé (case décochée) n'est ni validé ni envoyé, même si sa
 * saisie est invalide : le taux de TVA quand `caisse.tva_active` vaut
 * « non », le plafond de remise quand `caisse.remises` vaut « non ».
 */
export function caisseChanges(baseline: Record<CaisseKey, string>, form: Record<CaisseKey, string>): { changes: { key: CaisseKey; value: unknown }[] } | { error: Key; key: CaisseKey } {
  const changes: { key: CaisseKey; value: unknown }[] = [];
  for (const key of CAISSE_KEYS) {
    if (key === "caisse.tva_taux" && form["caisse.tva_active"] !== "oui") continue;
    if (key === "caisse.remise_plafond" && form["caisse.remises"] !== "oui") continue;
    if (form[key] === baseline[key]) continue;
    const next = caisseValue(key, form[key]);
    if ("error" in next) return { error: next.error, key };
    const before = caisseValue(key, baseline[key]);
    if ("value" in before && JSON.stringify(before.value) === JSON.stringify(next.value)) continue;
    changes.push({ key, value: next.value });
  }
  return { changes };
}

/** Préfixe des factures à l'écran (distribution D-01) : valeur, facture qui le fige, et s'il se change encore. */
export interface PrefixeEtat {
  valeur: string;
  fige: string | null;
  modifiable: boolean;
}

/** État du préfixe d'après le réglage reçu ; `null` si le serveur ne l'envoie pas à ce rôle. */
export function prefixeEtat(setting: Setting | undefined): PrefixeEtat | null {
  if (!setting || typeof setting.value !== "string") return null;
  const fige = setting.frozen?.numero ?? null;
  return { valeur: setting.value, fige, modifiable: setting.editable === true && fige === null };
}

/** Préfixe saisi : mis en majuscules, puis contrôlé comme le serveur le contrôle. */
export function prefixeSaisi(text: string): { value: string } | { error: Key } {
  const value = normalizeInvoicePrefix(text);
  return isInvoicePrefix(value) ? { value } : { error: "reglages_caisse.prefixe_erreur" };
}
