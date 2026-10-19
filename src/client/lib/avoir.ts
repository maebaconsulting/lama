/**
 * Formulaire « Émettre un avoir » (sous-projet 5 § 6.1), sans dépendance au
 * navigateur pour être testé sous Node : lignes et quantités reprises,
 * remise en stock des produits, motif, remboursements, montant calculé par
 * la fonction partagée avec le serveur (`creditTotals`). Chaque fonction
 * rend un nouveau brouillon, sans modifier celui reçu.
 */
import type { Role } from "./auth-types.ts";
import type { Invoice, InvoiceLine, SaleSettings } from "./caisse-types.ts";
import { orderedLines } from "../../shared/supplements.ts";
import { creditTotals, PAYMENT_METHODS, REFERENCE_REQUIRED, type PaymentMethod } from "../../shared/caisse.ts";

export interface CreditDraftLine {
  line_id: number;
  /** Quantité reprise ; 0 : ligne non reprise. */
  quantity: number;
  restock: boolean;
}

export interface CreditRefund {
  method: PaymentMethod;
  amount: number;
  reference: string;
}

export interface CreditDraft {
  /** Identifiant de l'avoir, gardé tant que le formulaire est ouvert : un renvoi ne crée jamais un second avoir. */
  request_id: string;
  lines: CreditDraftLine[];
  reason: string;
  refunds: CreditRefund[];
}

/** Gérante toujours ; réception si la gérante l'autorise (`caisse.avoirs_reception`), comme le serveur. */
export function canCredit(role: Role, settings: Pick<SaleSettings, "avoirs_reception"> | null): boolean {
  return role === "manager" || (role === "reception" && settings?.avoirs_reception === true);
}

/** Quantité d'une ligne de la facture encore à reprendre. */
export function remainingOf(line: InvoiceLine): number {
  return Math.max(line.quantity - line.credited, 0);
}

/** Formulaire vierge : lignes encore à reprendre, aucune prise, remise en stock décochée, remboursement par le premier moyen de la facture. */
export function startCredit(invoice: Invoice, requestId: string): CreditDraft {
  return {
    request_id: requestId,
    reason: "",
    lines: invoice.lines.filter((l) => remainingOf(l) > 0).map((l) => ({ line_id: l.id, quantity: 0, restock: false })),
    refunds: [{ method: invoice.payments[0]?.method ?? "cash", amount: 0, reference: "" }],
  };
}

/** « Tout reprendre » : chaque ligne à son reste. */
export function takeAll(invoice: Invoice, draft: CreditDraft): CreditDraft {
  return { ...draft, lines: draft.lines.map((d) => ({ ...d, quantity: remainingOf(invoice.lines.find((l) => l.id === d.line_id)!) })) };
}

/** Lignes du formulaire dans l'ordre d'affichage : chaque supplément sous sa prestation (spec du 18/10/2026 § 3.5). */
export function draftRows(invoice: Invoice, draft: CreditDraft): { draft: CreditDraftLine; line: InvoiceLine; supplement: boolean }[] {
  const lines = draft.lines.flatMap((d) => invoice.lines.filter((l) => l.id === d.line_id));
  return orderedLines(lines).map((l) => ({ draft: draft.lines.find((d) => d.line_id === l.id)!, line: l, supplement: l.supplement }));
}

/** Vrai si un supplément de la ligne `parentLineId` n'est pas encore repris à son reste. */
export function supplementsLeft(invoice: Invoice, draft: CreditDraft, parentLineId: number): boolean {
  return draft.lines.some((d) => {
    const line = invoice.lines.find((l) => l.id === d.line_id);
    if (!line || line.parent_line_id !== parentLineId) return false;
    return d.quantity < remainingOf(line);
  });
}

/** « Reprendre aussi ses suppléments » : chaque supplément de la prestation à son reste. */
export function takeSupplements(invoice: Invoice, draft: CreditDraft, parentLineId: number): CreditDraft {
  return {
    ...draft,
    lines: draft.lines.map((d) => {
      const line = invoice.lines.find((l) => l.id === d.line_id);
      if (!line || line.parent_line_id !== parentLineId) return d;
      return { ...d, quantity: remainingOf(line) };
    }),
  };
}

/** − et + d'une ligne : entre 0 et son reste ; revenue à 0, sa case « Remettre en stock » se décoche. */
export function setQuantity(invoice: Invoice, draft: CreditDraft, lineId: number, quantity: number): CreditDraft {
  const line = invoice.lines.find((l) => l.id === lineId);
  if (!line) return draft;
  const q = Math.min(Math.max(Math.round(quantity), 0), remainingOf(line));
  return { ...draft, lines: draft.lines.map((d) => (d.line_id === lineId ? { ...d, quantity: q, restock: q > 0 && d.restock } : d)) };
}

/** « Remettre en stock » : un produit repris seulement. */
export function setRestock(invoice: Invoice, draft: CreditDraft, lineId: number, on: boolean): CreditDraft {
  const line = invoice.lines.find((l) => l.id === lineId);
  return { ...draft, lines: draft.lines.map((d) => (d.line_id === lineId ? { ...d, restock: on && line?.kind === "product" && d.quantity > 0 } : d)) };
}

export function setReason(draft: CreditDraft, reason: string): CreditDraft {
  return { ...draft, reason };
}

/** Un moyen de plus, le premier des quatre pas encore pris (quatre au plus). */
export function addRefund(draft: CreditDraft): CreditDraft {
  const next = PAYMENT_METHODS.find((m) => !draft.refunds.some((r) => r.method === m));
  return next ? { ...draft, refunds: [...draft.refunds, { method: next, amount: 0, reference: "" }] } : draft;
}

export function removeRefund(draft: CreditDraft, index: number): CreditDraft {
  return draft.refunds.length > 1 ? { ...draft, refunds: draft.refunds.filter((_, i) => i !== index) } : draft;
}

export function setRefund(draft: CreditDraft, index: number, patch: Partial<CreditRefund>): CreditDraft {
  return { ...draft, refunds: draft.refunds.map((r, i) => (i === index ? { ...r, ...patch } : r)) };
}

const chosenOf = (draft: CreditDraft) => draft.lines.filter((d) => d.quantity > 0);

/**
 * Vrai si l'avoir reprend toute la facture, chaque ligne à son reste (mineur
 * 4, relecture finale) : l'acompte déjà versé ne se rappelle alors qu'au
 * remboursement complet (`formulaire-avoir.tsx`), jamais pour un avoir partiel
 * qui ne la rembourse pas elle.
 */
export function completesInvoice(invoice: Invoice, draft: CreditDraft): boolean {
  const taken = (id: number) => draft.lines.find((d) => d.line_id === id)?.quantity ?? 0;
  return invoice.lines.every((l) => l.credited + taken(l.id) >= l.quantity);
}

/** Montants de l'avoir tel que saisi, calculés comme le serveur. */
export function creditPreview(invoice: Invoice, draft: CreditDraft) {
  const chosen = chosenOf(draft);
  const taken = (id: number) => chosen.find((d) => d.line_id === id)?.quantity ?? 0;
  return creditTotals({
    invoice,
    credited: invoice.credited_total,
    credited_subtotal: invoice.lines.reduce((sum, l) => sum + l.credited * l.unit_price, 0),
    completes: invoice.lines.every((l) => l.credited + taken(l.id) >= l.quantity),
    vat: { active: invoice.fiscal.tva_active, rate: invoice.fiscal.tva_taux },
    lines: chosen.map((d) => ({ unit_price: invoice.lines.find((l) => l.id === d.line_id)!.unit_price, quantity: d.quantity })),
  });
}

/** Remboursements envoyés : un seul moyen porte tout le montant de l'avoir ; plusieurs, ceux qui ont un montant. Avoir à 0 F : aucun. */
export function refundsOf(draft: CreditDraft, total: number): CreditRefund[] {
  if (total <= 0) return [];
  const refunds = draft.refunds.length === 1 ? [{ ...draft.refunds[0], amount: total }] : draft.refunds.filter((r) => r.amount > 0);
  return refunds.map((r) => ({ ...r, reference: r.reference.trim() }));
}

/** Ce qui empêche d'émettre : aucune ligne, motif vide, remboursements qui n'égalent pas l'avoir, référence manquante. */
export type CreditBlocker = "lignes" | "motif" | "ecart" | "reference";

export function creditBlocker(invoice: Invoice, draft: CreditDraft): CreditBlocker | null {
  if (chosenOf(draft).length === 0) return "lignes";
  if (draft.reason.trim() === "") return "motif";
  const total = creditPreview(invoice, draft).total_ttc;
  const refunds = refundsOf(draft, total);
  if (refunds.reduce((sum, r) => sum + r.amount, 0) !== total) return "ecart";
  if (refunds.some((r) => REFERENCE_REQUIRED.includes(r.method) && r.reference === "")) return "reference";
  return null;
}

/** Corps de `POST /api/credit-notes`. */
export function creditBody(invoice: Invoice, draft: CreditDraft) {
  const total = creditPreview(invoice, draft).total_ttc;
  return {
    request_id: draft.request_id,
    invoice_id: invoice.id,
    reason: draft.reason.trim(),
    lines: chosenOf(draft).map((d) => ({ line_id: d.line_id, quantity: d.quantity, restock: d.restock })),
    refunds: refundsOf(draft, total),
  };
}
