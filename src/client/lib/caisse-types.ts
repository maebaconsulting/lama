/** Types des réponses des routes de la caisse (sous-projet 5 § 4.5). */
import type { DiscountKind, PaymentMethod } from "../../shared/caisse.ts";
import type { Tier } from "../../shared/fidelite.ts";

/**
 * Réglages de la caisse lus par l'écran de vente (`GET /api/sales/settings`).
 * Retouche (relecture du correctif final) : pour la praticienne, réglage
 * désactivé, le serveur ne rend que `practitioner_checkout` (§ 4.5) ; tous
 * les autres champs sont donc optionnels, avec une valeur de secours à
 * chaque lecture.
 */
export interface SaleSettings {
  vat_active?: boolean;
  vat_rate?: number;
  discounts?: boolean;
  discount_cap?: number;
  tips?: boolean;
  methods?: PaymentMethod[];
  /** Avoirs émis par la réception (§ 6.1), autorisés par la gérante. */
  avoirs_reception?: boolean;
  /** Encaissement par la praticienne de ses propres rendez-vous, activé par la gérante. */
  practitioner_checkout: boolean;
  /** Acomptes (§ 6.2) activés par la gérante ; jamais pour la praticienne. */
  deposits?: boolean;
  /** Impression directe : une imprimante de tickets est réglée (case « Imprimer le ticket », bouton « Imprimer » vers elle). */
  printer?: boolean;
  /** Fidélité (mini CRM § 2) : paliers de récompense ; absent ou `active` faux pour la praticienne. */
  loyalty?: { active: boolean; tiers: Tier[] };
}

export type DepositStatus = "held" | "applied" | "refunded" | "kept";

/** Reçu d'acompte (`GET /api/deposits?appointment_id=`, vague 3b). */
export interface Deposit {
  id: number;
  number: string;
  appointment_id: number;
  /** Cliente du rendez-vous à l'encaissement de l'acompte : gelée depuis (correctif final, point 3). */
  client_id: number | null;
  client_name: string | null;
  amount: number;
  issued_at: number;
  account_name: string | null;
  status: DepositStatus;
  applied_invoice_id: number | null;
  applied_invoice_number: string | null;
  settled_at: number | null;
  settled_by_name: string | null;
  settle_reason: string;
  appointment: { identifier: string; date: string; time: string; status: string };
  payments: { method: PaymentMethod; amount: number; reference: string }[];
}

export interface InvoiceLine {
  id: number;
  kind: "service" | "product";
  ref_id: number;
  label_fr: string;
  label_en: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  staff_id: number | null;
  staff_name: string | null;
  /** Quantité déjà reprise par des avoirs (ligne d'une facture). */
  credited: number;
  /** Ligne de la facture reprise (ligne d'un avoir). */
  credited_line_id: number | null;
  /** Produit remis en stock (ligne d'un avoir) : 1 ou 0. */
  restock: number;
}

export interface InvoicePayment {
  method: PaymentMethod;
  amount: number;
  reference: string;
  cash_given: number | null;
  change_given: number;
}

/** Facture émise, telle que le serveur la rend (valeurs figées à l'émission). */
export interface Invoice {
  id: number;
  kind: "invoice" | "credit_note";
  number: string;
  issued_at: number;
  lang: "fr" | "en";
  client_id: number | null;
  client_name: string | null;
  appointment_id: number | null;
  appointment_identifier: string | null;
  account_name: string | null;
  subtotal: number;
  discount_amount: number;
  discount_kind: DiscountKind | null;
  discount_value: number | null;
  discount_reason: string;
  total_ttc: number;
  total_ht: number;
  total_tva: number;
  fiscal: { tva_active: boolean; tva_taux: number };
  lines: InvoiceLine[];
  payments: InvoicePayment[];
  tip: { staff_id: number; amount: number; staff_name: string | null } | null;
  /** Avoir : facture corrigée et motif. */
  credited_invoice_id: number | null;
  credited_number: string | null;
  reason: string;
  /** Facture : avoirs émis, total qu'ils reprennent, et vrai si toutes ses quantités le sont. */
  credits: { id: number; number: string; issued_at: number; total_ttc: number; reason: string }[];
  /** Facture : acomptes déduits, versements déjà reçus (vague 3b). */
  deposits?: { id: number; number: string; amount: number }[];
  credited_total: number;
  cancelled: boolean;
  /** Vente émise avec la case « Envoyer par WhatsApp » cochée : ticket mis en file (sous-projet 7, vague 2). */
  whatsapp_queued?: boolean;
  /** Émis avec la case « Imprimer le ticket » : imprimé, ou raison traduite de l'échec (impression directe). */
  printed?: boolean;
  print_error?: string;
}

/** Ligne des listes de factures (`GET /api/invoices?date=` ou `?client_id=`). */
export interface InvoiceSummary {
  id: number;
  kind: "invoice" | "credit_note";
  number: string;
  issued_at: number;
  total_ttc: number;
  client_id: number | null;
  client_name: string | null;
  appointment_id: number | null;
  account_id: number;
  account_name: string | null;
  tip: number | null;
  credited_number: string | null;
  credited_total: number;
  /** 1 si la facture est entièrement reprise par des avoirs. */
  cancelled: number;
}

/** Totaux d'un moyen de paiement sur une période de caisse (§ 6.3). */
export interface MethodTotal {
  method: PaymentMethod;
  received: number;
  refunded: number;
  net: number;
}

/** Résumé d'une période de caisse, tel que le serveur le calcule et le fige sur une clôture. */
export interface ClosingSummary {
  methods: MethodTotal[];
  invoices: { count: number; total: number };
  credit_notes: { count: number; total: number };
  /** Acomptes reçus et remboursés pendant la période (vague 3b) ; leurs versements sont dans `methods`. */
  deposits: { received: { count: number; total: number }; refunded: { count: number; total: number } };
  tips: { staff_id: number; staff_name: string; amount: number }[];
  cash_expected: number;
}

/** Clôture de caisse enregistrée. */
export interface CashClosing {
  id: number;
  day: string;
  seq: number;
  closed_at: number;
  period_start: number;
  account_id: number;
  account_name: string | null;
  cash_expected: number;
  cash_counted: number;
  difference: number;
  note: string;
  summary: ClosingSummary;
}

/** Facture ou avoir du jour, avec la clôture qui le couvre (`null` : pas encore clôturé). */
export interface DayDocument {
  id: number;
  kind: "invoice" | "credit_note";
  number: string;
  issued_at: number;
  total_ttc: number;
  client_name: string | null;
  account_name: string | null;
  credited_number: string | null;
  closing_id: number | null;
}

/** Caisse d'un jour (`GET /api/cash/day`). */
export interface CashDay {
  day: string;
  closings: CashClosing[];
  open: { period_start: number; count: number; summary: ClosingSummary };
  documents: DayDocument[];
}
