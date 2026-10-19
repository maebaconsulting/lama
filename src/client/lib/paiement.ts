/**
 * Paiement de l'écran « Vente » (sous-projet 5 § 4.2), sans dépendance au
 * navigateur : versements saisis, moyen choisi, calculatrice (touches, « 000 »,
 * « Effacer »), montants rapides, et ce qui manque avant « Valider et émettre ».
 * La répartition des versements est celle du serveur (`settle`, calculs partagés).
 */
import { quickAmounts, REFERENCE_REQUIRED, settle, type PaymentMethod, type Settlement } from "../../shared/caisse.ts";
import type { Lang } from "../i18n/translate.ts";
import { deviseActive } from "../../shared/devise-active.ts";
import { formatEntier, separateurDecimal } from "../../shared/montants.ts";
import { formatAmount } from "./format.ts";

export interface PaymentEntry {
  method: PaymentMethod;
  /** Espèces : somme tendue par la cliente ; autres moyens : montant payé. */
  amount: number;
  reference: string;
  /**
   * Montant proposé (reste à payer, montant rapide) pas encore retouché : la
   * première touche du pavé le remplace au lieu de s'y ajouter.
   */
  proposed: boolean;
  /**
   * Chiffres déjà tapés après la virgule (devise à centimes, 0 juste après la
   * virgule). Clé absente pendant la saisie de la partie entière : les
   * versements se comparent alors tels qu'avant le chantier.
   */
  fraction?: number;
}

/** Versement sans la clé `fraction` (partie entière, montant rapide). */
function sansFraction(e: PaymentEntry): PaymentEntry {
  const copie = { ...e };
  delete copie.fraction;
  return copie;
}

export interface PaymentDraft {
  /** Moyen choisi : celui du versement en cours de saisie. */
  method: PaymentMethod;
  entries: PaymentEntry[];
  /** Versement que le pavé modifie ; `null` : le prochain chiffre en ouvre un. */
  active: number | null;
}

/** Touches du pavé d'une devise sans centimes, dans l'ordre d'affichage (trois colonnes). */
export const PAD_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "000", "0", "effacer"] as const;
export type PadKey = (typeof PAD_KEYS)[number] | "virgule";

/** Touches du pavé dans la devise active : « 000 » sans centimes, « virgule » avec. */
export function padKeys(): readonly PadKey[] {
  return deviseActive().decimales === 0 ? PAD_KEYS : PAD_KEYS.map((k) => (k === "000" ? "virgule" : k));
}

/**
 * Où tombe une frappe du clavier physique : `champ` (saisie de texte, comme la
 * référence de transaction), `fenetre` (approbation, confirmation), `pave`
 * (touche du pavé ou montant rapide restés sous le focus après un clic),
 * `controle` (autre bouton ou lien), `libre` (reste de la page).
 */
export type KeyPlace = "champ" | "fenetre" | "pave" | "controle" | "libre";

/**
 * Touche du clavier physique vers le pavé (retouche 7, poste fixe) : chiffres
 * 0 à 9 (pavé numérique compris), Retour arrière pour « Effacer », Entrée pour
 * « Valider et émettre ». Rien dans un champ ni dans une fenêtre, rien avec
 * Ctrl, Cmd ou Alt ; Entrée sur un autre bouton garde l'action de ce bouton.
 */
export function padAction(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, place: KeyPlace): PadKey | "valider" | null {
  if (place === "champ" || place === "fenetre" || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (/^[0-9]$/.test(e.key)) return e.key as PadKey;
  if ((e.key === "," || e.key === ".") && deviseActive().decimales > 0) return "virgule";
  if (e.key === "Backspace") return "effacer";
  if (e.key === "Enter") return place === "controle" ? null : "valider";
  return null;
}

/** Aucune saisie ne dépasse 999 999 999 unités mineures. */
const MAX_AMOUNT = 999_999_999;

/** Premier paiement : espèces si la gérante les propose, sinon le premier moyen activé. */
export function startPayment(methods: readonly PaymentMethod[]): PaymentDraft {
  return { method: methods.includes("cash") ? "cash" : methods[0] ?? "cash", entries: [], active: null };
}

/** Reste à payer sans compter le versement `except` (montant proposé à la carte et aux paiements mobiles). */
function remainingWithout(d: PaymentDraft, due: number, except: number | null): number {
  return settle(due, d.entries.filter((_, i) => i !== except)).remaining;
}

/**
 * Choix d'un moyen (boutons de 64 px) : le versement en cours reste acquis ;
 * un nouveau versement s'ouvre, au reste à payer pour la carte, Orange Money
 * et MoMo, à zéro pour les espèces (la cliente dit ce qu'elle tend). Un
 * versement encore vide, ou dont le montant proposé n'a pas été touché
 * (moyen choisi par erreur), change seulement de moyen.
 */
export function chooseMethod(d: PaymentDraft, method: PaymentMethod, due: number): PaymentDraft {
  const current = d.active === null ? null : d.entries[d.active];
  if (current && current.method === method) return { ...d, method };
  const untouched = current !== null && (current.amount === 0 || (current.proposed && current.method !== "cash"));
  const reuse = untouched ? d.active : null;
  const proposed = method === "cash" ? 0 : remainingWithout(d, due, reuse);
  const entry: PaymentEntry = { method, amount: proposed, reference: "", proposed: true };
  if (reuse !== null) {
    return { method, entries: d.entries.map((e, i) => (i === reuse ? entry : e)), active: reuse };
  }
  return { method, entries: [...d.entries, entry], active: d.entries.length };
}

/** Une touche du pavé sur le versement en cours (ouvert au besoin avec le moyen choisi). */
export function pressKey(d: PaymentDraft, key: PadKey, due: number): PaymentDraft {
  let draft = d;
  if (draft.active === null) draft = chooseMethod({ ...draft, active: null }, draft.method, due);
  const index = draft.active!;
  const entry = draft.entries[index];
  const dec = deviseActive().decimales;
  const k = 10 ** dec;
  const base = entry.proposed ? 0 : entry.amount;
  let fraction: number | null = entry.proposed ? null : entry.fraction ?? null;
  let amount: number;
  if (key === "effacer") {
    if (entry.proposed) amount = 0;
    else if (fraction === null) amount = Math.floor(base / (10 * k)) * k;
    else if (fraction === 0) { amount = base; fraction = null; }
    else {
      const unit = 10 ** (dec - fraction);
      amount = base - (Math.floor(base / unit) % 10) * unit;
      fraction -= 1;
    }
  } else if (key === "000") {
    if (dec > 0) return draft;
    amount = base * 1000;
  } else if (key === "virgule") {
    if (dec === 0 || fraction !== null) return draft;
    amount = base;
    fraction = 0;
  } else if (fraction === null) {
    amount = base * 10 + Number(key) * k;
  } else {
    if (fraction >= dec) return draft;
    amount = base + Number(key) * 10 ** (dec - fraction - 1);
    fraction += 1;
  }
  if (amount > MAX_AMOUNT) return draft;
  const entries = draft.entries.map((e, i) => {
    if (i !== index) return e;
    return fraction === null ? { ...sansFraction(e), amount, proposed: false } : { ...e, amount, proposed: false, fraction };
  });
  return { ...draft, entries };
}

/**
 * Afficheur du pavé : le montant (`formatAmount`) ; pendant la saisie des
 * décimales, ce qui a été tapé, virgule comprise : « 15, », « 15,5 », « 15,50 ».
 */
export function saisiePave(e: Pick<PaymentEntry, "amount" | "fraction">, lang: Lang): string {
  const d = deviseActive();
  if (e.fraction === undefined || d.decimales === 0) return formatAmount(e.amount, lang);
  const k = 10 ** d.decimales;
  const tapes = String(e.amount % k).padStart(d.decimales, "0").slice(0, e.fraction);
  return `${formatEntier(Math.floor(e.amount / k))}${separateurDecimal(lang)}${tapes}`;
}

/**
 * Montants proposés pour les espèces (§ 4.2) : le montant exact qui solde le
 * reste (sans compter le versement d'espèces en cours), puis les trois
 * montants ronds au-dessus.
 */
export function cashSuggestions(d: PaymentDraft, due: number): number[] {
  const own = d.active !== null && d.entries[d.active].method === "cash" ? d.active : null;
  const exact = remainingWithout(d, due, own);
  return exact > 0 ? [exact, ...quickAmounts(exact)] : [];
}

/** Montant rapide des espèces (exact, 60 000…) : posé sur le versement d'espèces en cours. */
export function setTendered(d: PaymentDraft, amount: number, due: number): PaymentDraft {
  const draft = d.active !== null && d.entries[d.active].method === "cash" ? d : chooseMethod(d, "cash", due);
  const index = draft.active!;
  return { ...draft, entries: draft.entries.map((e, i) => (i === index ? { ...sansFraction(e), amount, proposed: true } : e)) };
}

export function setReference(d: PaymentDraft, index: number, reference: string): PaymentDraft {
  return { ...d, entries: d.entries.map((e, i) => (i === index ? { ...e, reference } : e)) };
}

/** Retire un versement (bouton « × ») ; le pavé repart sur le moyen choisi. */
export function removeEntry(d: PaymentDraft, index: number): PaymentDraft {
  const entries = d.entries.filter((_, i) => i !== index);
  const active = d.active === null || d.active === index ? null : d.active > index ? d.active - 1 : d.active;
  return { ...d, entries, active };
}

/** Répartition des versements saisis sur le montant dû. */
export function settlementOf(d: PaymentDraft, due: number): Settlement {
  return settle(due, d.entries);
}

/** Ce qui empêche d'émettre, le plus utile d'abord ; `null` : « Valider et émettre la facture » est actif. */
export type Blocker = "reste" | "trop" | "reference";

export function blocker(d: PaymentDraft, due: number): Blocker | null {
  const s = settlementOf(d, due);
  if (s.invalid.length > 0) return "trop";
  if (s.remaining > 0) return "reste";
  const withAmount = d.entries.filter((e) => e.amount > 0);
  if (withAmount.some((e) => REFERENCE_REQUIRED.includes(e.method) && e.reference.trim() === "")) return "reference";
  return null;
}

/** Versements envoyés au serveur : part réglée, somme tendue pour les espèces, référence s'il y en a une. */
export function paymentsBody(d: PaymentDraft, due: number) {
  return settlementOf(d, due).payments.map((p) => ({
    method: p.method,
    amount: p.amount,
    ...(p.reference ? { reference: p.reference } : {}),
    ...(p.cash_given !== null ? { cash_given: p.cash_given } : {}),
  }));
}
