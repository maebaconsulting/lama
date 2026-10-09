/**
 * Calculs de la caisse (sous-projet 5 § 4.4), communs à l'écran et au serveur :
 * l'écran montre exactement ce que le serveur recalcule et facture. Montants
 * en francs CFA entiers ; aucune dépendance (ni navigateur, ni base), testé
 * sous Node.
 */

export type PaymentMethod = "cash" | "card" | "orange_money" | "momo";
/** Moyens de paiement dans l'ordre d'affichage. */
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "card", "orange_money", "momo"];
/** Moyens dont la référence de transaction est obligatoire (§ 4.2). */
export const REFERENCE_REQUIRED: readonly PaymentMethod[] = ["orange_money", "momo"];

export type DiscountKind = "percent" | "amount";
/** Motifs de remise proposés (§ 4.3) ; « autre » s'accompagne d'un texte. */
export type DiscountReason = "fidelite" | "geste" | "autre";
export const DISCOUNT_REASONS: readonly DiscountReason[] = ["fidelite", "geste", "autre"];

/**
 * Suites de numérotation (§ 3.2) : avoirs et reçus d'acompte. Celle des
 * factures est le réglage `caisse.prefixe` de l'institut (distribution D-01).
 */
export const SERIES = { credit_note: "AV", deposit: "AC" } as const;

/** Préfixe des factures d'une installation neuve, tant que l'administrateur n'en a pas choisi un autre (distribution D-01). */
export const DEFAULT_INVOICE_PREFIX = "FAC";

/** Préfixe saisi mis en forme : espaces de bord retirées, majuscules. */
export function normalizeInvoicePrefix(text: string): string {
  return text.trim().toUpperCase();
}

/** Préfixe valable : 2 à 6 lettres A à Z ou chiffres dont une lettre au moins, jamais celui des avoirs (AV) ni des reçus d'acompte (AC). */
export function isInvoicePrefix(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z0-9]{2,6}$/.test(value) && /[A-Z]/.test(value) && value !== SERIES.credit_note && value !== SERIES.deposit;
}

/**
 * Clôture d'un jour passé (report de la vague 3a) : 30 jours au plus après
 * lui ; au-delà, la caisse du jour reste consultable, mais ne se clôture plus.
 */
export const CLOSING_WINDOW_DAYS = 30;

/** Décalage de Douala sur UTC, toute l'année (pas d'heure d'été). */
const DOUALA_OFFSET_MS = 60 * 60_000;

/** Prix du catalogue (colonne `REAL`) en francs entiers, jamais négatif (§ 3). */
export function wholeFrancs(price: number | null | undefined): number {
  const n = Math.round(Number(price) || 0);
  return n > 0 ? n : 0;
}

const FRANCS_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/**
 * Montant entier de francs, groupé par milliers à l'identique de l'écran
 * (`formatPrice`, décision du 30/09/2026, § 8) : même espace fine insécable
 * entre les groupes, dans les deux langues. Sans la devise : les messages du
 * serveur (relecture finale, mineur 3) l'ajoutent eux-mêmes, avec l'espace
 * insécable de leur dictionnaire.
 */
export function formatFrancs(amount: number): string {
  return FRANCS_FORMAT.format(Math.round(Number(amount) || 0));
}

/**
 * Montant sur un document officiel (ticket, avoir, reçu d'acompte) : `13\u202f000\u00a0FCFA`
 * dans les deux langues, équivalent côté serveur de `formatPriceDocument`
 * (décision du 30/09/2026, § 8). L'écran écrit « F » (`formatPrice`).
 */
export function formatFrancsDocument(amount: number): string {
  return `${formatFrancs(amount)}\u00a0FCFA`;
}

/** Montant de la remise : pourcentage arrondi au franc, ou montant ; jamais plus que le sous-total. */
export function discountAmount(subtotal: number, discount: { kind: DiscountKind; value: number } | null | undefined): number {
  if (!discount || subtotal <= 0) return 0;
  const raw = discount.kind === "percent" ? Math.round((subtotal * discount.value) / 100) : Math.round(discount.value);
  return Math.min(Math.max(raw, 0), subtotal);
}

/** Vrai si la remise dépasse le plafond réglé (en pour cent du sous-total) : mot de passe d'une gérante demandé. */
export function exceedsCap(subtotal: number, discount: number, capPercent: number): boolean {
  return discount * 100 > capPercent * subtotal;
}

/**
 * Part hors taxe et TVA d'un total TTC (§ 4.4) : un seul arrondi, sur le
 * total ; HT plus TVA égale toujours TTC. Taux en pour cent (19,25), calculé
 * en centièmes de point pour rester en nombres entiers.
 */
export function vatSplit(ttc: number, vat: { active: boolean; rate: number }): { ht: number; tva: number } {
  if (!vat.active || ttc <= 0) return { ht: ttc, tva: 0 };
  const points = Math.round(vat.rate * 100);
  const ht = Math.round((ttc * 10000) / (10000 + points));
  return { ht, tva: ttc - ht };
}

export interface Totals {
  subtotal: number;
  discount_amount: number;
  total_ttc: number;
  total_ht: number;
  total_tva: number;
  /** Pourboire, hors facture et sans TVA. */
  tip: number;
  /** À payer : total de la facture plus le pourboire. */
  due: number;
}

/** Totaux d'une vente : sous-total, remise, TVA sur le total remisé, pourboire à part. */
export function saleTotals(input: {
  lines: { unit_price: number; quantity: number }[];
  discount: { kind: DiscountKind; value: number } | null | undefined;
  vat: { active: boolean; rate: number };
  tip: number;
}): Totals {
  const subtotal = input.lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  const discount = discountAmount(subtotal, input.discount);
  const ttc = subtotal - discount;
  const { ht, tva } = vatSplit(ttc, input.vat);
  const tip = Math.max(Math.round(input.tip || 0), 0);
  return { subtotal, discount_amount: discount, total_ttc: ttc, total_ht: ht, total_tva: tva, tip, due: ttc + tip };
}

/**
 * Montants d'un avoir (§ 6.1), communs à l'écran et au serveur : lignes
 * reprises au prix de la facture ; la remise de la facture s'applique au
 * prorata, arrondie une fois, sur le total ; l'avoir qui termine toutes les
 * quantités de la facture prend exactement le reste, pour que la somme des
 * avoirs égale son total ; jamais plus que ce reste. TVA au taux figé de la
 * facture corrigée, un seul arrondi comme à la vente.
 *
 * Le prorata est cumulé sur l'ensemble de ce qui a déjà été repris
 * (`credited_subtotal`) : l'avoir qui termine prend exactement le reste sans
 * être plafonné par le sous-total de ses seules lignes. La TVA est elle
 * aussi cumulée (différence entre la TVA après et avant cet avoir), pour que
 * sa somme égale toujours exactement la TVA de la facture, quel que soit le
 * nombre d'avoirs (correctif final, point 7 : `credited_subtotal`
 * obligatoire, ses deux appelants le fournissent déjà).
 */
export function creditTotals(input: {
  invoice: { subtotal: number; total_ttc: number };
  /** Total des avoirs déjà émis sur cette facture (somme de leur `total_ttc`). */
  credited: number;
  /** Sous-total brut (prix des lignes, sans remise) déjà repris par les avoirs précédents sur cette facture. */
  credited_subtotal: number;
  lines: { unit_price: number; quantity: number }[];
  /** Vrai si, avec cet avoir, toutes les quantités de la facture sont reprises. */
  completes: boolean;
  vat: { active: boolean; rate: number };
}): { subtotal: number; discount_amount: number; total_ttc: number; total_ht: number; total_tva: number } {
  const subtotal = input.lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  const remaining = Math.max(input.invoice.total_ttc - input.credited, 0);
  const share = input.invoice.subtotal <= 0 ? 0
    : Math.round((input.credited_subtotal + subtotal) * input.invoice.total_ttc / input.invoice.subtotal) - input.credited;
  const ttc = input.completes ? remaining : Math.min(share, remaining, subtotal);
  const total_tva = vatSplit(input.credited + ttc, input.vat).tva - vatSplit(input.credited, input.vat).tva;
  return { subtotal, discount_amount: subtotal - ttc, total_ttc: ttc, total_ht: ttc - total_tva, total_tva };
}

/**
 * Montants rapides des espèces (§ 4.2), au-dessus du montant exact : les plus
 * petits multiples de 1 000, 2 000, 5 000 et 10 000 strictement supérieurs,
 * complétés par les multiples de 5 000 suivants ; les trois plus petits.
 */
export function quickAmounts(due: number): number[] {
  if (due <= 0) return [];
  const above = (step: number) => (Math.floor(due / step) + 1) * step;
  const set = new Set([1000, 2000, 5000, 10000].map(above));
  let next = Math.max(...set);
  while (set.size < 3) {
    next = (Math.floor(next / 5000) + 1) * 5000;
    set.add(next);
  }
  return [...set].sort((a, b) => a - b).slice(0, 3);
}

/** Billets et pièces du franc CFA proposés pour rendre la monnaie (§ 4.2). */
export const BILLS: readonly number[] = [10000, 5000, 2000, 1000];
export const COINS: readonly number[] = [500, 100, 50, 25, 10];

export interface ChangePart {
  value: number;
  count: number;
  kind: "billet" | "piece";
}

/** Coupures suggérées pour rendre `amount`, les plus grosses d'abord ; `rest` : moins de 10 francs non décomposés. */
export function changeBreakdown(amount: number): { parts: ChangePart[]; rest: number } {
  let left = Math.max(Math.round(amount), 0);
  const parts: ChangePart[] = [];
  for (const [kind, values] of [["billet", BILLS], ["piece", COINS]] as const) {
    for (const value of values) {
      const count = Math.floor(left / value);
      if (count > 0) {
        parts.push({ value, count, kind });
        left -= count * value;
      }
    }
  }
  return { parts, rest: left };
}

/** Versement saisi à l'écran : pour les espèces, `amount` est ce que la cliente tend. */
export interface Tender {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

/** Versement tel qu'il est envoyé au serveur et inscrit sur la facture. */
export interface SettledPayment {
  method: PaymentMethod;
  /** Part du total réglée par ce versement. */
  amount: number;
  reference: string;
  /** Espèces : somme tendue ; `null` pour les autres moyens. */
  cash_given: number | null;
  change_given: number;
}

export interface Settlement {
  payments: SettledPayment[];
  /** Somme tendue (espèces comprises au montant reçu). */
  received: number;
  /** Reste à payer, jamais négatif. */
  remaining: number;
  /** Monnaie à rendre (espèces seulement). */
  change: number;
  /** Indices des versements refusés : versement en trop, carte ou mobile au-delà du reste. */
  invalid: number[];
}

/**
 * Répartit les versements saisis sur le montant dû, dans l'ordre (§ 4.2) :
 * chaque versement règle au plus le reste ; l'excédent d'espèces est la
 * monnaie rendue ; une carte ou un paiement mobile ne dépasse jamais le reste.
 */
export function settle(due: number, tenders: Tender[]): Settlement {
  let remaining = due;
  let received = 0;
  let change = 0;
  const payments: SettledPayment[] = [];
  const invalid: number[] = [];
  tenders.forEach((tender, index) => {
    const given = Math.max(Math.round(tender.amount), 0);
    if (given === 0) return;
    received += given;
    const applied = Math.min(given, remaining);
    remaining -= applied;
    const extra = given - applied;
    if (applied === 0 || (tender.method !== "cash" && extra > 0)) invalid.push(index);
    if (tender.method === "cash") change += extra;
    payments.push({
      method: tender.method,
      amount: applied,
      reference: (tender.reference ?? "").trim(),
      cash_given: tender.method === "cash" ? given : null,
      change_given: tender.method === "cash" ? extra : 0,
    });
  });
  return { payments, received, remaining, change, invalid };
}

/** Année civile à Douala d'un instant : la suite repart à 1 chaque 1er janvier, heure de l'institut (§ 3.2). */
export function yearAt(ms: number): number {
  return new Date(ms + DOUALA_OFFSET_MS).getUTCFullYear();
}

/** Jour de Douala d'un instant, `aaaa-mm-jj`. */
export function doualaDay(ms: number): string {
  return new Date(ms + DOUALA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Début et fin (exclue) d'un jour `aaaa-mm-jj` de Douala, en millisecondes. */
export function dayBounds(day: string): { start: number; end: number } {
  const [y, m, d] = day.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d) - DOUALA_OFFSET_MS;
  return { start, end: start + 24 * 60 * 60_000 };
}

/** Numéro d'un document : `FAC-2026-000001`. */
export function documentNumber(series: string, year: number, seq: number): string {
  return `${series}-${year}-${String(seq).padStart(6, "0")}`;
}
