/**
 * Avoirs (sous-projet 5 § 3.2, § 6.1) : lecture de la demande, état de la
 * facture corrigée (quantités déjà reprises), montants par les calculs
 * partagés avec l'écran, puis écriture de l'avoir, de ses lignes, des
 * remboursements (versements négatifs) et des remises en stock dans une
 * seule transaction, numéro AV compris. Fonctions synchrones sur la base,
 * appelées dans `StorageBinding.transaction` : toute erreur annule tout.
 */
import type { Database } from "../storage.ts";
import { coded, montant, type MessageKey } from "../messages.ts";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, SERIES, creditTotals, documentNumber, yearAt, type PaymentMethod } from "../../shared/caisse.ts";
import { checkClock, SaleError, takeNumber } from "./vente.ts";
import { recordCreditLoyalty } from "../crm/fidelite.ts";

export interface CreditLineRequest {
  /** Ligne de la facture reprise. */
  line_id: number;
  quantity: number;
  /** Produit rendu remis en stock (case « Remettre en stock »). */
  restock: boolean;
}

export interface CreditRequest {
  request_id: string;
  invoice_id: number;
  reason: string;
  lines: CreditLineRequest[];
  /** Remboursements, en montants positifs ; inscrits en négatif sur l'avoir. */
  refunds: { method: PaymentMethod; amount: number; reference: string }[];
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000_000;
const invalid = (key: MessageKey) => new SaleError(400, key);

/** Lit et vérifie la forme de la demande (`POST /api/credit-notes`) ; lève une `SaleError` 400 sinon. */
export function parseCreditRequest(input: unknown): CreditRequest {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)) throw invalid("vente.requete");
  if (!isId(body.invoice_id)) throw new SaleError(404, "facture.introuvable");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason === "" || reason.length > 200) throw invalid("avoir.motif");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw invalid("avoir.lignes");
  if (body.lines.length > 100) throw invalid("avoir.ligne_invalide");
  const seen = new Set<number>();
  const lines = body.lines.map((raw): CreditLineRequest => {
    const l = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!isId(l.line_id) || !isCount(l.quantity) || seen.has(l.line_id)) throw invalid("avoir.ligne_invalide");
    seen.add(l.line_id);
    return { line_id: l.line_id, quantity: l.quantity, restock: l.restock === true };
  });
  if (!Array.isArray(body.refunds) || body.refunds.length > 20) throw invalid("vente.versement_invalide");
  const refunds = body.refunds.map((raw) => {
    const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (!PAYMENT_METHODS.includes(p.method as PaymentMethod) || !isCount(p.amount)) throw invalid("vente.versement_invalide");
    const reference = typeof p.reference === "string" ? p.reference.trim() : "";
    if (reference.length > 64) throw invalid("vente.versement_invalide");
    return { method: p.method as PaymentMethod, amount: p.amount, reference };
  });
  return { request_id: body.request_id, invoice_id: body.invoice_id, reason, lines, refunds };
}

type Row = Record<string, unknown>;
const one = (db: Database, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).get(...params) as Row | undefined;

export interface CreditStateLine {
  id: number;
  kind: "service" | "product" | "libre";
  /** Article du catalogue ; `null` pour un supplément libre. */
  ref_id: number | null;
  label_fr: string;
  label_en: string;
  quantity: number;
  unit_price: number;
  staff_id: number | null;
  /** Ligne de la prestation dont cette ligne est un supplément (spec du 18/10/2026 § 3.5). */
  parent_line_id: number | null;
  /** Quantité déjà reprise par des avoirs. */
  credited: number;
}

export interface CreditState {
  invoice: Row & { id: number; kind: string; subtotal: number; total_ttc: number; lang: string; fiscal: { tva_active?: unknown; tva_taux?: unknown } };
  lines: CreditStateLine[];
  /** Total des avoirs déjà émis sur la facture. */
  credited_total: number;
}

/** Facture (ou avoir) avec ses lignes et ce que les avoirs en ont déjà repris ; `null` si elle n'existe pas. */
export function creditState(db: Database, invoiceId: number): CreditState | null {
  const invoice = one(db, "SELECT * FROM invoices WHERE id = ?", invoiceId);
  if (!invoice) return null;
  const lines = (db.prepare(
    `SELECT l.id, l.kind, l.ref_id, l.label_fr, l.label_en, l.quantity, l.unit_price, l.staff_id, l.parent_line_id,
            COALESCE((SELECT SUM(x.quantity) FROM invoice_lines x WHERE x.credited_line_id = l.id), 0) AS credited
       FROM invoice_lines l WHERE l.invoice_id = ? ORDER BY l.id`,
  ).all(invoiceId) as Row[]).map((l): CreditStateLine => ({
    id: Number(l.id), kind: l.kind as CreditStateLine["kind"], ref_id: l.ref_id === null ? null : Number(l.ref_id), label_fr: String(l.label_fr), label_en: String(l.label_en ?? ""),
    quantity: Number(l.quantity), unit_price: Number(l.unit_price), staff_id: l.staff_id === null ? null : Number(l.staff_id),
    parent_line_id: l.parent_line_id === null ? null : Number(l.parent_line_id), credited: Number(l.credited),
  }));
  const credited = one(db, "SELECT COALESCE(SUM(total_ttc), 0) AS total FROM invoices WHERE credited_invoice_id = ?", invoiceId);
  return {
    invoice: { ...invoice, id: Number(invoice.id), kind: String(invoice.kind), subtotal: Number(invoice.subtotal), total_ttc: Number(invoice.total_ttc), lang: String(invoice.lang), fiscal: JSON.parse(String(invoice.fiscal)) },
    lines,
    credited_total: Number(credited?.total ?? 0),
  };
}

export interface CreditContext {
  now: number;
  accountId: number;
  /** Identité de l'institut au moment de l'émission (nom, adresse, NIU, RCCM, mentions) ; la TVA est celle de la facture. */
  identity: Record<string, unknown>;
  /** Langue de la demande : désignation d'un produit dans un refus. */
  requestLang: "fr" | "en";
}

/**
 * Émet un avoir sur une facture, dans la transaction ouverte par l'appelant :
 * même `request_id` déjà émis, l'avoir existant est rendu (`replay`) ; sinon
 * quantités, plafond et remboursements sont vérifiés, la suite AV de l'année
 * avance d'un pas, puis avoir, lignes, remises en stock et remboursements
 * sont écrits. Toute erreur lève : l'appelant annule tout, numéro compris.
 */
export function issueCreditNote(db: Database, req: CreditRequest, ctx: CreditContext): { id: number; replay: boolean } {
  const existing = one(db, "SELECT id, kind, credited_invoice_id FROM invoices WHERE request_id = ?", req.request_id);
  if (existing) {
    if (existing.kind === "credit_note" && Number(existing.credited_invoice_id) === req.invoice_id) return { id: Number(existing.id), replay: true };
    throw new SaleError(409, "vente.requete");
  }
  checkClock(db, ctx.now);
  const state = creditState(db, req.invoice_id);
  if (!state) throw new SaleError(404, "facture.introuvable");
  if (state.invoice.kind !== "invoice") throw invalid("avoir.sur_avoir");
  if (state.lines.every((l) => l.credited >= l.quantity)) throw new SaleError(409, "avoir.deja_annulee");

  const label = (l: CreditStateLine) => (ctx.requestLang === "en" && l.label_en ? l.label_en : l.label_fr);
  const chosen = req.lines.map((r) => {
    const line = state.lines.find((l) => l.id === r.line_id);
    if (!line) throw invalid("avoir.ligne_invalide");
    if (r.restock && line.kind !== "product") throw invalid("avoir.restock_prestation");
    const left = line.quantity - line.credited;
    if (r.quantity > left) throw new SaleError(409, "avoir.quantite", { designation: label(line), reste: left });
    return { line, quantity: r.quantity, restock: r.restock };
  });
  const completes = state.lines.every((l) => l.credited + (chosen.find((c) => c.line.id === l.id)?.quantity ?? 0) >= l.quantity);
  const vat = { active: state.invoice.fiscal.tva_active === true, rate: Number(state.invoice.fiscal.tva_taux) || 0 };
  // Correctif 1 : sous-total déjà repris par les avoirs précédents, pour un prorata cumulé (creditTotals).
  const creditedSubtotal = state.lines.reduce((sum, l) => sum + l.credited * l.unit_price, 0);
  const totals = creditTotals({
    invoice: state.invoice, credited: state.credited_total, credited_subtotal: creditedSubtotal, completes, vat,
    lines: chosen.map((c) => ({ unit_price: c.line.unit_price, quantity: c.quantity })),
  });

  // Remboursement par les quatre moyens, même désactivés pour la vente : on rend comme la cliente a payé.
  for (const r of req.refunds) {
    if (REFERENCE_REQUIRED.includes(r.method) && r.reference === "") {
      throw new SaleError(400, "vente.reference_obligatoire", { moyen: coded(`moyen.${r.method}` as MessageKey) });
    }
  }
  const refunded = req.refunds.reduce((sum, r) => sum + r.amount, 0);
  if (refunded !== totals.total_ttc) {
    throw new SaleError(409, "avoir.remboursement", { rembourse: montant(refunded), du: montant(totals.total_ttc) }, { code: "total", due: totals.total_ttc });
  }

  const series = SERIES.credit_note;
  const year = yearAt(ctx.now);
  const seq = takeNumber(db, series, year);
  const inv = state.invoice;
  const discounted = totals.discount_amount > 0;
  const fiscal = { ...ctx.identity, tva_active: vat.active, tva_taux: vat.rate };
  const note = db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, client_id, appointment_id, account_id,
       subtotal, discount_amount, discount_kind, discount_value, discount_reason, total_ttc, total_ht, total_tva, fiscal,
       credited_invoice_id, reason, request_id)
     VALUES ('credit_note', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    documentNumber(series, year, seq), series, year, seq, ctx.now, inv.lang, (inv.client_id as number | null) ?? null, (inv.appointment_id as number | null) ?? null, ctx.accountId,
    totals.subtotal, totals.discount_amount, discounted ? (inv.discount_kind as string | null) ?? null : null, discounted ? (inv.discount_value as number | null) ?? null : null,
    discounted ? String(inv.discount_reason ?? "") : "", totals.total_ttc, totals.total_ht, totals.total_tva, JSON.stringify(fiscal),
    inv.id, req.reason, req.request_id,
  );
  const id = Number(note.lastInsertRowid);

  const addLine = db.prepare(
    `INSERT INTO invoice_lines (invoice_id, kind, ref_id, label_fr, label_en, quantity, unit_price, line_total, staff_id, credited_line_id, restock, parent_line_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const giveBack = db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?");
  // Supplément repris avec sa prestation (spec § 3.5) : rattaché à la ligne de cet avoir qui reprend sa prestation
  // d'origine ; repris sans elle, aucun rattachement. Ordre de la facture : la prestation est écrite avant ses suppléments.
  const written = new Map<number, number>();
  for (const c of [...chosen].sort((a, b) => a.line.id - b.line.id)) {
    const l = c.line;
    const parent = l.parent_line_id === null ? null : written.get(l.parent_line_id) ?? null;
    const row = addLine.run(id, l.kind, l.ref_id, l.label_fr, l.label_en, c.quantity, l.unit_price, l.unit_price * c.quantity, l.staff_id, l.id, c.restock ? 1 : 0, parent);
    written.set(l.id, Number(row.lastInsertRowid));
    if (c.restock && Number(giveBack.run(c.quantity, l.ref_id).changes) === 0) {
      throw new SaleError(409, "avoir.produit_supprime", { produit: label(l) });
    }
  }
  const addRefund = db.prepare("INSERT INTO payments (invoice_id, method, amount, reference, cash_given, change_given) VALUES (?, ?, ?, ?, NULL, 0)");
  for (const r of req.refunds) addRefund.run(id, r.method, -r.amount, r.reference);
  // Fidélité (décision 17) : reprise des points de la facture et, si l'avoir l'annule, restitution de la récompense.
  recordCreditLoyalty(db, {
    creditId: id, invoiceId: inv.id, clientId: (inv.client_id as number | null) ?? null,
    creditTtc: totals.total_ttc, invoiceTtc: inv.total_ttc, completes, accountId: ctx.accountId, now: ctx.now,
  });
  return { id, replay: false };
}
