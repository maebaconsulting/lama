/**
 * Acomptes (sous-projet 5 § 3.2, § 6.2) : lecture des demandes, encaissement
 * d'un acompte sur un rendez-vous à venir (reçu AC numéroté sans trou, dans la
 * même transaction que ses versements), puis son sort : déduit de la facture
 * du rendez-vous (`applyDeposit`, appelé par `issueSale`), remboursé ou gardé
 * si le rendez-vous est annulé ou la cliente absente (gérante). Fonctions
 * synchrones sur la base, appelées dans `StorageBinding.transaction` : toute
 * erreur annule tout, numéro compris.
 */
import type { Database } from "../storage.ts";
import { coded, montant, type MessageKey } from "../messages.ts";
import { PAYMENT_METHODS, REFERENCE_REQUIRED, SERIES, documentNumber, yearAt, type PaymentMethod } from "../../shared/caisse.ts";
import { entierMineur } from "../../shared/montants.ts";
import { checkClock, SaleError, takeNumber } from "./vente.ts";

export type DepositStatus = "held" | "applied" | "refunded" | "kept";

/** Versement d'un acompte, ou remboursement (montant positif, inscrit en négatif). */
export interface DepositPayment {
  method: PaymentMethod;
  amount: number;
  reference: string;
}

export interface DepositRequest {
  request_id: string;
  appointment_id: number;
  amount: number;
  payments: DepositPayment[];
}

export interface SettleRequest {
  request_id: string;
  deposit_id: number;
  /** `refund` : « Rembourser » (versements négatifs) ; `keep` : « Garder » (motif obligatoire). */
  action: "refund" | "keep";
  reason: string;
  refunds: DepositPayment[];
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 1_000_000_000;
const invalid = (key: MessageKey) => new SaleError(400, key);

/** Versements d'une demande : moyen connu, montant entier positif, référence de 64 caractères au plus. */
function parsePayments(raw: unknown): DepositPayment[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) throw invalid("vente.versement_invalide");
  return raw.map((item) => {
    const p = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (!PAYMENT_METHODS.includes(p.method as PaymentMethod) || !isCount(p.amount)) throw invalid("vente.versement_invalide");
    const reference = typeof p.reference === "string" ? p.reference.trim() : "";
    if (reference.length > 64) throw invalid("vente.versement_invalide");
    return { method: p.method as PaymentMethod, amount: p.amount, reference };
  });
}

/** Lit et vérifie la forme de la demande (`POST /api/deposits`) ; lève une `SaleError` 400 sinon. */
export function parseDepositRequest(input: unknown): DepositRequest {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)) throw invalid("vente.requete");
  if (!isId(body.appointment_id)) throw invalid("vente.rdv_inconnu");
  if (!isCount(body.amount)) throw invalid("acompte.montant");
  return { request_id: body.request_id, appointment_id: body.appointment_id, amount: body.amount, payments: parsePayments(body.payments) };
}

/** Lit et vérifie la forme de la demande (`POST /api/deposits/:id/settle`) ; lève une `SaleError` 400 sinon. */
export function parseSettleRequest(depositId: number, input: unknown): SettleRequest {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)) throw invalid("vente.requete");
  if (body.action !== "refund" && body.action !== "keep") throw invalid("acompte.action");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > 200 || (body.action === "keep" && reason === "")) throw invalid("acompte.motif");
  return { request_id: body.request_id, deposit_id: depositId, action: body.action, reason, refunds: body.action === "refund" ? parsePayments(body.refunds) : [] };
}

type Row = Record<string, unknown>;
const one = (db: Database, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).get(...params) as Row | undefined;

/** Moyen proposé et référence obligatoire pour Orange Money et MoMo ; somme exactement égale à `due`. */
function checkDepositPayments(payments: DepositPayment[], due: number, methods: readonly PaymentMethod[], sumKey: MessageKey): void {
  for (const p of payments) {
    if (!methods.includes(p.method)) throw new SaleError(400, "vente.moyen_refuse", { moyen: coded(`moyen.${p.method}` as MessageKey) });
    if (REFERENCE_REQUIRED.includes(p.method) && p.reference === "") throw new SaleError(400, "vente.reference_obligatoire", { moyen: coded(`moyen.${p.method}` as MessageKey) });
  }
  const received = payments.reduce((sum, p) => sum + p.amount, 0);
  if (received !== due) throw new SaleError(409, sumKey, { recu: montant(received), du: montant(due) });
}

/** Total prévu d'un rendez-vous : prix de ses prestations et de leurs suppléments (prix unitaire × quantité), comme `total_price`. */
export function plannedTotal(db: Database, appointmentId: number): number {
  const services = (db.prepare("SELECT price FROM appointment_services WHERE appointment_id = ?").all(appointmentId) as { price: number }[])
    .reduce((sum, s) => sum + entierMineur(s.price), 0);
  const supplements = db.prepare(
    `SELECT COALESCE(SUM(s.price * s.quantity), 0) AS total FROM appointment_supplements s
       JOIN appointment_services aps ON aps.id = s.appointment_service_id WHERE aps.appointment_id = ?`,
  ).get(appointmentId) as { total: number };
  return services + Number(supplements.total);
}

/** Statuts d'un rendez-vous « à venir » : seul un rendez-vous réservé ou confirmé reçoit un acompte (§ 6.2). */
export const UPCOMING = ["booked", "confirmed"] as const;
/** Statuts qui ouvrent « Rembourser » et « Garder » : rendez-vous annulé, cliente absente. */
export const SETTLEABLE = ["cancelled", "no_show"] as const;

export interface DepositContext {
  now: number;
  accountId: number;
  /** Langue de l'institut, figée sur le reçu. */
  lang: "fr" | "en";
  /** Copie des réglages fiscaux et de l'institut au moment de l'encaissement (§ 3.1). */
  fiscal: Record<string, unknown>;
  /** Moyens de paiement proposés par la gérante. */
  methods: readonly PaymentMethod[];
}

/**
 * Encaisse un acompte, dans la transaction ouverte par l'appelant : même
 * `request_id` déjà servi pour ce rendez-vous, le reçu existant (`replay`) ;
 * pour un autre, refusé. Le rendez-vous doit être à venir, sans facture
 * active ni autre acompte en attente, et l'acompte ne dépasse pas le total prévu
 * (prestations et suppléments). Puis la suite AC de l'année avance d'un pas, le reçu
 * et ses versements sont écrits.
 */
export function issueDeposit(db: Database, req: DepositRequest, ctx: DepositContext): { id: number; replay: boolean } {
  const existing = one(db, "SELECT id, appointment_id FROM deposits WHERE request_id = ?", req.request_id);
  if (existing) {
    if (Number(existing.appointment_id) !== req.appointment_id) throw new SaleError(409, "vente.requete");
    return { id: Number(existing.id), replay: true };
  }
  checkClock(db, ctx.now);
  const apt = one(db, "SELECT id, client_id, status FROM appointments WHERE id = ?", req.appointment_id);
  if (!apt) throw new SaleError(404, "vente.rdv_inconnu");
  if (!(UPCOMING as readonly string[]).includes(String(apt.status))) throw new SaleError(409, "acompte.rdv_statut");
  const paid = one(db, "SELECT i.number FROM invoices i JOIN invoice_balance b ON b.invoice_id = i.id WHERE i.appointment_id = ? AND b.cancelled = 0", req.appointment_id);
  if (paid) throw new SaleError(409, "vente.rdv_deja_paye", { numero: String(paid.number) });
  const held = one(db, "SELECT number FROM deposits WHERE appointment_id = ? AND status = 'held'", req.appointment_id);
  if (held) throw new SaleError(409, "acompte.deja", { numero: String(held.number) });
  const planned = plannedTotal(db, req.appointment_id);
  if (req.amount > planned) throw new SaleError(409, "acompte.plafond", { prevu: montant(planned) });
  checkDepositPayments(req.payments, req.amount, ctx.methods, "acompte.versements");

  const series = SERIES.deposit;
  const year = yearAt(ctx.now);
  const seq = takeNumber(db, series, year);
  const info = db.prepare(
    `INSERT INTO deposits (number, series, year, seq, appointment_id, client_id, amount, issued_at, account_id, fiscal, lang, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    documentNumber(series, year, seq), series, year, seq, req.appointment_id, (apt.client_id as number | null) ?? null, req.amount, ctx.now,
    ctx.accountId, JSON.stringify(ctx.fiscal), ctx.lang, req.request_id,
  );
  const id = Number(info.lastInsertRowid);
  const add = db.prepare("INSERT INTO payments (deposit_id, method, amount, reference, cash_given, change_given) VALUES (?, ?, ?, ?, NULL, 0)");
  for (const p of req.payments) add.run(id, p.method, p.amount, p.reference);
  return { id, replay: false };
}

/**
 * Sort d'un acompte dont le rendez-vous est annulé ou dont la cliente est
 * absente (§ 6.2, gérante) : « Rembourser » (acompte `refunded`, versements
 * négatifs égaux à son montant, par les quatre moyens) ou « Garder » (`kept`,
 * motif obligatoire). Même `request_id` déjà servi : `replay`. Un acompte déjà
 * déduit, remboursé ou gardé ne change plus.
 */
export function settleDeposit(db: Database, req: SettleRequest, ctx: { now: number; accountId: number }): { id: number; replay: boolean } {
  const dep = one(db, "SELECT d.id, d.amount, d.status, d.settle_request_id, a.status AS apt_status FROM deposits d JOIN appointments a ON a.id = d.appointment_id WHERE d.id = ?", req.deposit_id);
  if (!dep) throw new SaleError(404, "acompte.introuvable");
  if (dep.status !== "held") {
    // Correctif 3 (relecture) : le rejeu n'est reconnu que si le statut correspond à l'action demandée
    // (un acompte déduit n'est jamais le rejeu d'un remboursement ou d'une garde, même avec le même settle_request_id).
    const expected = req.action === "refund" ? "refunded" : "kept";
    if (dep.status === expected && dep.settle_request_id === req.request_id) return { id: req.deposit_id, replay: true };
    throw new SaleError(409, "acompte.deja_solde");
  }
  if (!(SETTLEABLE as readonly string[]).includes(String(dep.apt_status))) throw new SaleError(409, "acompte.rdv_actif");
  // Avenant (relecture du correctif 1, vague 3b) : préfixe réservé au settle_request_id qu'applyDeposit
  // pose quand la vente déduit l'acompte ; l'accepter ici laisserait une gérante l'occuper d'avance et
  // heurterait le déclencheur d'immuabilité en erreur SQL brute.
  if (req.request_id.startsWith("facture-")) throw new SaleError(400, "vente.requete");
  // Correctif 2 (relecture) : un settle_request_id déjà pris par un autre acompte est refusé proprement,
  // jamais par l'erreur UNIQUE brute de la base (ni, pire, par le déclencheur d'immuabilité).
  const other = one(db, "SELECT id FROM deposits WHERE settle_request_id = ?", req.request_id);
  if (other && Number(other.id) !== req.deposit_id) throw new SaleError(409, "vente.requete");
  if (req.action === "refund") checkDepositPayments(req.refunds, Number(dep.amount), PAYMENT_METHODS, "acompte.remboursement");
  db.prepare("UPDATE deposits SET status = ?, settled_at = ?, settled_by = ?, settle_reason = ?, settle_request_id = ? WHERE id = ?")
    .run(req.action === "refund" ? "refunded" : "kept", ctx.now, ctx.accountId, req.reason, req.request_id, req.deposit_id);
  const add = db.prepare("INSERT INTO payments (deposit_id, method, amount, reference, cash_given, change_given) VALUES (?, ?, ?, ?, NULL, 0)");
  for (const p of req.refunds) add.run(req.deposit_id, p.method, -p.amount, p.reference);
  return { id: req.deposit_id, replay: false };
}

/** Acompte en attente d'un rendez-vous (`null` s'il n'y en a pas) : ce que la vente déduit. */
export function heldDeposit(db: Database, appointmentId: number): { id: number; number: string; amount: number; client_id: number | null } | null {
  const row = one(db, "SELECT id, number, amount, client_id FROM deposits WHERE appointment_id = ? AND status = 'held'", appointmentId);
  return row ? { id: Number(row.id), number: String(row.number), amount: Number(row.amount), client_id: (row.client_id as number | null) ?? null } : null;
}

/**
 * Acompte choisi pour une vente au comptoir de produits seuls (V1-78), lu dans
 * la transaction de la vente : il existe, attend encore, appartient à la
 * cliente de la vente (jamais à une vente sans cliente) et son rendez-vous
 * n'aura pas lieu (annulé, cliente absente). Un rendez-vous encore à venir,
 * commencé ou terminé garde son acompte.
 */
export function counterDeposit(db: Database, depositId: number, clientId: number | null): { id: number; number: string; amount: number; client_id: number | null } {
  const row = one(db, "SELECT d.id, d.number, d.amount, d.client_id, d.status, a.status AS apt_status FROM deposits d JOIN appointments a ON a.id = d.appointment_id WHERE d.id = ?", depositId);
  if (!row) throw new SaleError(404, "acompte.introuvable");
  if (row.status !== "held") throw new SaleError(409, "acompte.deja_solde", {}, { code: "acompte" });
  const number = String(row.number);
  const owner = (row.client_id as number | null) ?? null;
  if (clientId === null || owner !== clientId) throw new SaleError(409, "acompte.autre_cliente", { numero: number }, { code: "acompte" });
  if (!(SETTLEABLE as readonly string[]).includes(String(row.apt_status))) throw new SaleError(409, "acompte.rdv_attache", { numero: number }, { code: "acompte" });
  return { id: Number(row.id), number, amount: Number(row.amount), client_id: owner };
}

/**
 * Déduit l'acompte de la facture du rendez-vous (§ 6.2), dans la transaction
 * de la vente, après l'écriture de la facture : l'acompte passe à `applied`.
 */
export function applyDeposit(db: Database, depositId: number, invoiceId: number, ctx: { now: number; accountId: number; requestId: string }): void {
  const info = db.prepare("UPDATE deposits SET status = 'applied', applied_invoice_id = ?, settled_at = ?, settled_by = ?, settle_request_id = ? WHERE id = ?")
    .run(invoiceId, ctx.now, ctx.accountId, `facture-${ctx.requestId}`, depositId);
  // Correctif 4 (relecture) : un identifiant d'acompte inconnu ne doit jamais passer inaperçu.
  if (Number(info.changes) !== 1) throw new SaleError(404, "acompte.introuvable");
}

export interface DepositRecord {
  id: number;
  number: string;
  appointment_id: number;
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
  lang: "fr" | "en";
  fiscal: Record<string, unknown>;
  /** Rendez-vous cité par le reçu. */
  appointment: { identifier: string; date: string; time: string; status: string };
  /** Versements reçus (positifs) puis remboursements (négatifs). */
  payments: { method: PaymentMethod; amount: number; reference: string; cash_given: number | null; change_given: number }[];
}

const DEPOSIT_SQL = `SELECT d.*, c.name AS client_name, a.display_name AS account_name, s.display_name AS settled_by_name, i.number AS applied_invoice_number,
       ap.identifier, ap.scheduled_date, ap.start_time, ap.status AS appointment_status
  FROM deposits d
  JOIN appointments ap ON ap.id = d.appointment_id
  LEFT JOIN clients c ON c.id = d.client_id
  LEFT JOIN accounts a ON a.id = d.account_id
  LEFT JOIN accounts s ON s.id = d.settled_by
  LEFT JOIN invoices i ON i.id = d.applied_invoice_id`;

function recordOf(db: Database, row: Row): DepositRecord {
  const id = Number(row.id);
  return {
    id, number: String(row.number), appointment_id: Number(row.appointment_id), client_id: (row.client_id as number | null) ?? null,
    client_name: (row.client_name as string | null) ?? null, amount: Number(row.amount), issued_at: Number(row.issued_at),
    account_name: (row.account_name as string | null) ?? null, status: row.status as DepositStatus,
    applied_invoice_id: (row.applied_invoice_id as number | null) ?? null, applied_invoice_number: (row.applied_invoice_number as string | null) ?? null,
    settled_at: (row.settled_at as number | null) ?? null, settled_by_name: (row.settled_by_name as string | null) ?? null,
    settle_reason: String(row.settle_reason ?? ""), lang: row.lang === "en" ? "en" : "fr", fiscal: JSON.parse(String(row.fiscal)) as Record<string, unknown>,
    appointment: { identifier: String(row.identifier ?? ""), date: String(row.scheduled_date ?? ""), time: String(row.start_time ?? ""), status: String(row.appointment_status ?? "") },
    payments: (db.prepare("SELECT method, amount, reference, cash_given, change_given FROM payments WHERE deposit_id = ? ORDER BY id").all(id) as Row[])
      .map((p) => ({ method: p.method as PaymentMethod, amount: Number(p.amount), reference: String(p.reference ?? ""), cash_given: (p.cash_given as number | null) ?? null, change_given: Number(p.change_given) })),
  };
}

/** Un reçu d'acompte complet (cliente, personnes, rendez-vous, versements) ; `null` s'il n'existe pas. */
export function readDeposit(db: Database, id: number): DepositRecord | null {
  const row = one(db, `${DEPOSIT_SQL} WHERE d.id = ?`, id);
  return row ? recordOf(db, row) : null;
}

/** Acomptes d'un rendez-vous, du plus ancien au plus récent. */
export function depositsOf(db: Database, appointmentId: number): DepositRecord[] {
  return (db.prepare(`${DEPOSIT_SQL} WHERE d.appointment_id = ? ORDER BY d.id`).all(appointmentId) as Row[]).map((row) => recordOf(db, row));
}

/** Acomptes qu'une vente au comptoir peut déduire (V1-78) : en attente, de cette cliente, rendez-vous annulé ou manqué ; du plus ancien au plus récent. */
export function counterDeposits(db: Database, clientId: number): DepositRecord[] {
  return (db.prepare(`${DEPOSIT_SQL} WHERE d.client_id = ? AND d.status = 'held' AND ap.status IN ('cancelled', 'no_show') ORDER BY d.id`).all(clientId) as Row[])
    .map((row) => recordOf(db, row));
}
