/**
 * Textes de la caisse composés dans la langue de l'écran (sous-projet 5 § 4),
 * sans dépendance au navigateur : moyens de paiement, coupures à rendre,
 * libellé de la remise et de la TVA, ce qui empêche d'émettre.
 */
import { translate, translatePlural, type Key, type Lang } from "../i18n/translate.ts";
import { changeBreakdown, type DiscountReason, type PaymentMethod } from "../../shared/caisse.ts";
import { formatAmount, formatPrice, formatRate } from "./format.ts";
import { pointsText } from "./fidelite.ts";
import type { Blocker } from "./paiement.ts";

const METHOD_KEYS: Record<PaymentMethod, Key> = {
  cash: "caisse.moyen.cash",
  card: "caisse.moyen.card",
  orange_money: "caisse.moyen.orange_money",
  momo: "caisse.moyen.momo",
};

export function methodLabel(method: PaymentMethod, lang: Lang): string {
  return translate(lang, METHOD_KEYS[method]);
}

/**
 * Coupures suggérées pour rendre la monnaie (§ 4.2) : « 1 billet de 10 000 +
 * 1 billet de 1 000 » ; `court` (téléphone) : « 10 000 + 1 000 », « 2 × 100 ».
 * Moins de 10 francs restants : dits à part (petite monnaie). Espaces
 * insécables dans chaque terme, sécables seulement autour de « + ».
 */
export function changeText(amount: number, lang: Lang, court = false): string {
  const { parts, rest } = changeBreakdown(amount);
  const words = parts.map((p) => {
    const valeur = formatAmount(p.value, lang);
    if (court) return p.count === 1 ? valeur : `${p.count}\u00a0×\u00a0${valeur}`;
    return translatePlural(lang, p.kind === "billet" ? "caisse.billets" : "caisse.pieces", p.count, { valeur });
  });
  if (rest > 0) words.push(translate(lang, "caisse.petite_monnaie", { montant: formatPrice(rest, lang) }));
  // Chaque terme d'un seul tenant (« 1 pièce de 50 ») : la ligne ne se coupe qu'autour de « + ».
  return words.map((w) => w.replace(/ /g, "\u00a0")).join(" + ");
}

const REASON_KEYS: Record<DiscountReason, Key> = {
  fidelite: "caisse.motif.fidelite",
  geste: "caisse.motif.geste",
  autre: "caisse.motif.autre",
};

export function reasonLabel(reason: DiscountReason, lang: Lang): string {
  return translate(lang, REASON_KEYS[reason]);
}

/** Ligne de la remise au ticket : « Remise fidélité 5 % », « Remise geste commercial », « Remise : anniversaire ». */
export function discountLabel(d: { kind: "percent" | "amount"; value: number; reason: DiscountReason; note: string; reward_points?: number }, lang: Lang): string {
  // Récompense fidélité (mini CRM § 2) : « Récompense fidélité, 100 points ».
  if (d.reward_points !== undefined) return translate(lang, "caisse.remise_recompense", { points: pointsText(d.reward_points, lang) });
  const label = d.reason === "autre"
    ? translate(lang, "caisse.remise_motif_libre", { motif: d.note })
    : translate(lang, d.reason === "fidelite" ? "caisse.remise_fidelite" : "caisse.remise_geste");
  return d.kind === "percent" ? translate(lang, "caisse.remise_pourcent", { libelle: label, taux: formatRate(d.value, lang) }) : label;
}

/**
 * Remise d'une facture émise, motif tel qu'il est stocké (`fidelite`,
 * `geste` ou `autre:texte`, § 4.3) : même libellé qu'au ticket de la vente.
 */
export function invoiceDiscountLabel(kind: "percent" | "amount" | null, value: number | null, stored: string, lang: Lang): string {
  const reason: DiscountReason = stored === "fidelite" || stored === "geste" ? stored : "autre";
  const note = reason === "autre" ? stored.replace(/^autre:/, "").trim() : "";
  return discountLabel({ kind: kind ?? "amount", value: value ?? 0, reason, note }, lang);
}

/** « dont TVA 19,25 % » (TVA active seulement). */
export function vatLabel(rate: number, lang: Lang): string {
  return translate(lang, "caisse.dont_tva", { taux: formatRate(rate, lang) });
}

/**
 * Coupe un libellé traduit autour de son montant (« Encaisser 33 350 F »,
 * « Montant exact · 59 000 ») : `[avant, montant, après]`, pour composer le
 * montant en chiffres de la charte sans figer l'ordre des mots de la langue.
 * Montant absent du texte : `[texte, "", ""]`.
 */
export function aroundAmount(text: string, amount: string): [string, string, string] {
  const at = amount === "" ? -1 : text.indexOf(amount);
  if (at < 0) return [text, "", ""];
  return [text.slice(0, at), amount, text.slice(at + amount.length)];
}

/** Ce qui empêche « Valider et émettre la facture », dit sous le bouton. */
export function blockerText(b: Blocker, remaining: number, lang: Lang): string {
  if (b === "reste") return translate(lang, "caisse.bloque_reste", { montant: formatPrice(remaining, lang) });
  return translate(lang, b === "trop" ? "caisse.bloque_trop" : "caisse.bloque_reference");
}
