/**
 * Clôture de caisse (sous-projet 5 § 6.3) : ce que la caisse d'un jour a vu
 * passer, par moyen de paiement (factures moins remboursements), nombre de
 * factures et d'avoirs, acomptes reçus et remboursés (vague 3b), pourboires
 * dus par praticienne ; clôture avec les
 * espèces comptées et l'écart ; ticket de clôture de 80 mm. Une clôture
 * couvre les documents émis dans son jour depuis la clôture précédente du
 * même jour ; ce qui suit la dernière est « après clôture » et une seconde
 * clôture le couvre. Fonctions synchrones sur la base (`Database`),
 * appelées dans `StorageBinding.transaction`.
 */
import type { Database } from "../storage.ts";
import { message, type Lang, type MessageKey } from "../messages.ts";
import { CLOSING_WINDOW_DAYS, PAYMENT_METHODS, dayBounds, doualaDay, type PaymentMethod } from "../../shared/caisse.ts";
import { formatMontantDocument } from "../../shared/montants.ts";
import { calendarDate, methodText, printable, ticketTime, type TicketRow, type TicketStyle } from "./ticket.ts";
import { SaleError } from "./vente.ts";
import { marquerFormation } from "../formation/marque.ts";

export interface MethodTotal {
  method: PaymentMethod;
  /** Versements des factures. */
  received: number;
  /** Remboursements des avoirs, en positif. */
  refunded: number;
  net: number;
}

export interface ClosingSummary {
  /** Les quatre moyens, dans l'ordre d'affichage, même sans mouvement. */
  methods: MethodTotal[];
  invoices: { count: number; total: number };
  credit_notes: { count: number; total: number };
  /**
   * Acomptes (vague 3b) : reçus et remboursés pendant la période (nombre
   * d'acomptes, montant) ; leurs versements sont aussi dans `methods`. Absent
   * d'une clôture enregistrée avant la vague 3b : lu comme zéro.
   */
  deposits: { received: { count: number; total: number }; refunded: { count: number; total: number } };
  /** Pourboires dus, par praticienne, dans l'ordre alphabétique. */
  tips: { staff_id: number; staff_name: string; amount: number }[];
  /** Espèces nettes : ce que le tiroir doit contenir de plus qu'à l'ouverture de la période. */
  cash_expected: number;
}

interface PeriodRows {
  documents: { kind: string; total_ttc: number }[];
  payments: { method: string; amount: number }[];
  /** Versements d'acompte (positifs) et remboursements d'acompte (négatifs) de la période. */
  deposits: { deposit_id: number; method: string; amount: number }[];
  tips: { staff_id: number; staff_name: string; amount: number }[];
}

/** Résumé d'une période à partir de ses documents, versements (négatifs pour un remboursement) et pourboires. */
export function summarize(rows: PeriodRows): ClosingSummary {
  const all = [...rows.payments, ...rows.deposits];
  const methods = PAYMENT_METHODS.map((method): MethodTotal => {
    const own = all.filter((p) => p.method === method);
    const received = own.filter((p) => p.amount > 0).reduce((sum, p) => sum + p.amount, 0);
    const refunded = own.filter((p) => p.amount < 0).reduce((sum, p) => sum - p.amount, 0);
    return { method, received, refunded, net: received - refunded };
  });
  const count = (kind: string) => {
    const docs = rows.documents.filter((d) => d.kind === kind);
    return { count: docs.length, total: docs.reduce((sum, d) => sum + d.total_ttc, 0) };
  };
  const byStaff = new Map<number, { staff_id: number; staff_name: string; amount: number }>();
  for (const tip of rows.tips) {
    const seen = byStaff.get(tip.staff_id);
    if (seen) seen.amount += tip.amount;
    else byStaff.set(tip.staff_id, { ...tip });
  }
  const tips = [...byStaff.values()].sort((a, b) => a.staff_name.localeCompare(b.staff_name, "fr"));
  const moves = (sign: 1 | -1) => {
    const own = rows.deposits.filter((d) => Math.sign(d.amount) === sign);
    return { count: new Set(own.map((d) => d.deposit_id)).size, total: own.reduce((sum, d) => sum + sign * d.amount, 0) };
  };
  return {
    methods, invoices: count("invoice"), credit_notes: count("credit_note"), deposits: { received: moves(1), refunded: moves(-1) }, tips, cash_expected: methods[0].net,
  };
}

/** Bornes d'une période : plus grands identifiants de facture et de versement déjà couverts (ou couverts par la clôture). */
interface Bounds {
  invoice: number;
  payment: number;
}

/**
 * Documents, versements et pourboires d'un jour (civil, Douala) dont
 * l'identifiant de facture est strictement supérieur à `from.invoice`
 * (clôture précédente du même jour, 0 s'il n'y en a pas) et au plus égal à
 * `to.invoice` : délimiter par l'identifiant, jamais par `issued_at`, qui peut
 * être figé avant l'écriture réelle du document (correctif § 6.3, tâche 6).
 * Les mouvements d'acompte (vague 3b), sans facture, se délimitent de même
 * par l'identifiant du versement (`from.payment`, `to.payment`) ; leur jour
 * est celui de l'encaissement de l'acompte pour un versement, celui de son
 * remboursement pour un remboursement.
 */
function periodRows(db: Database, day: string, from: Bounds, to: Bounds): PeriodRows {
  const { start, end } = dayBounds(day);
  const range = "i.issued_at >= ? AND i.issued_at < ? AND i.id > ? AND i.id <= ?";
  const fromId = from.invoice;
  const toId = to.invoice;
  const moved = "CASE WHEN p.amount > 0 THEN d.issued_at ELSE d.settled_at END";
  return {
    deposits: db.prepare(`SELECT p.deposit_id, p.method, p.amount FROM payments p JOIN deposits d ON d.id = p.deposit_id WHERE ${moved} >= ? AND ${moved} < ? AND p.id > ? AND p.id <= ?`)
      .all(start, end, from.payment, to.payment) as PeriodRows["deposits"],
    documents: db.prepare(`SELECT i.kind, i.total_ttc FROM invoices i WHERE ${range}`).all(start, end, fromId, toId) as PeriodRows["documents"],
    payments: db.prepare(`SELECT p.method, p.amount FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE ${range}`).all(start, end, fromId, toId) as PeriodRows["payments"],
    tips: db.prepare(`SELECT t.staff_id, COALESCE(s.name, '') AS staff_name, t.amount FROM tips t JOIN invoices i ON i.id = t.invoice_id LEFT JOIN staff s ON s.id = t.staff_id WHERE ${range}`)
      .all(start, end, fromId, toId) as PeriodRows["tips"],
  };
}

/** Aucune borne haute d'identifiant (période encore ouverte). */
const NO_UPPER_BOUND = Number.MAX_SAFE_INTEGER;

export interface ClosingRecord {
  id: number;
  day: string;
  seq: number;
  closed_at: number;
  period_start: number;
  /** Plus grand identifiant de facture couvert par cette clôture (délimite sa période, voir `periodRows`). */
  last_invoice_id: number;
  /** Plus grand identifiant de versement couvert (mouvements d'acompte, vague 3b ; 0 pour une clôture plus ancienne). */
  last_payment_id: number;
  account_id: number;
  account_name: string | null;
  cash_expected: number;
  cash_counted: number;
  difference: number;
  note: string;
  summary: ClosingSummary;
}

export interface DayDocument {
  id: number;
  kind: "invoice" | "credit_note";
  number: string;
  issued_at: number;
  total_ttc: number;
  client_name: string | null;
  account_name: string | null;
  credited_number: string | null;
  /** Clôture qui couvre ce document ; `null` : pas encore clôturé (« après clôture » s'il y en a déjà une). */
  closing_id: number | null;
}

export interface DayReport {
  day: string;
  closings: ClosingRecord[];
  /** Période encore ouverte : depuis la dernière clôture du jour, ou tout le jour s'il n'y en a pas. */
  open: { period_start: number; count: number; summary: ClosingSummary };
  documents: DayDocument[];
}

type Row = Record<string, unknown>;

/** Acomptes à zéro : résumé d'une clôture enregistrée avant la vague 3b. */
const NO_DEPOSITS: ClosingSummary["deposits"] = { received: { count: 0, total: 0 }, refunded: { count: 0, total: 0 } };

function closingOf(row: Row): ClosingRecord {
  const summary = JSON.parse(String(row.expected)) as ClosingSummary;
  return {
    id: Number(row.id), day: String(row.day), seq: Number(row.seq), closed_at: Number(row.closed_at), period_start: Number(row.period_start),
    last_invoice_id: Number(row.last_invoice_id), last_payment_id: Number(row.last_payment_id ?? 0), account_id: Number(row.account_id), account_name: (row.account_name as string | null) ?? null,
    cash_expected: Number(row.cash_expected), cash_counted: Number(row.cash_counted), difference: Number(row.difference), note: String(row.note ?? ""),
    summary: { ...summary, deposits: summary.deposits ?? NO_DEPOSITS },
  };
}

/** Une clôture, avec la personne qui l'a faite ; `null` si elle n'existe pas. */
export function readClosing(db: Database, id: number): ClosingRecord | null {
  const row = db.prepare("SELECT c.*, a.display_name AS account_name FROM cash_closings c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = ?").get(id) as Row | undefined;
  return row ? closingOf(row) : null;
}

/**
 * Clôture qui couvre un document, par son identifiant : la première dont le
 * `last_invoice_id` est au moins le sien, en partant du plus bas numéro de
 * séquence (les bornes des clôtures d'un même jour ne se chevauchent pas,
 * `last_invoice_id` croît avec `seq`). `null` : pas encore clôturé.
 */
function closingFor(id: number, closings: ClosingRecord[]): number | null {
  let floor = 0;
  for (const c of closings) {
    if (id > floor && id <= c.last_invoice_id) return c.id;
    floor = c.last_invoice_id;
  }
  return null;
}

/** Caisse d'un jour : ses clôtures, la période encore ouverte, et chaque document avec la clôture qui le couvre. */
export function dayReport(db: Database, day: string, now: number): DayReport {
  void now; // la période ouverte va jusqu'au dernier document existant, plus besoin de l'heure courante (correctif § 6.3)
  const { start, end } = dayBounds(day);
  const closings = (db.prepare("SELECT c.*, a.display_name AS account_name FROM cash_closings c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.day = ? ORDER BY c.seq").all(day) as Row[]).map(closingOf);
  const documents = (db.prepare(
    `SELECT i.id, i.kind, i.number, i.issued_at, i.total_ttc, c.name AS client_name, a.display_name AS account_name, ci.number AS credited_number
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id LEFT JOIN accounts a ON a.id = i.account_id LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id
      WHERE i.issued_at >= ? AND i.issued_at < ? ORDER BY i.issued_at, i.id`,
  ).all(start, end) as Row[]).map((d): DayDocument => ({
    id: Number(d.id), kind: d.kind as DayDocument["kind"], number: String(d.number), issued_at: Number(d.issued_at), total_ttc: Number(d.total_ttc),
    client_name: (d.client_name as string | null) ?? null, account_name: (d.account_name as string | null) ?? null, credited_number: (d.credited_number as string | null) ?? null,
    closing_id: closingFor(Number(d.id), closings),
  }));
  const last = closings.at(-1);
  const periodStart = last ? last.closed_at + 1 : start;
  const from = { invoice: last ? last.last_invoice_id : 0, payment: last ? last.last_payment_id : 0 };
  const rows = periodRows(db, day, from, { invoice: NO_UPPER_BOUND, payment: NO_UPPER_BOUND });
  return {
    day,
    closings,
    // `count` : documents et mouvements d'acompte pas encore clôturés (« Après clôture », clôture possible).
    open: { period_start: periodStart, count: documents.filter((d) => d.closing_id === null).length + rows.deposits.length, summary: summarize(rows) },
    documents,
  };
}

export interface ClosingRequest {
  request_id: string;
  day: string;
  cash_counted: number;
  note: string;
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Jour `aaaa-mm-jj` qui existe au calendrier (le 31 février, rendu au 3 mars par `Date.UTC`, est refusé). */
export function validDay(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && doualaDay(dayBounds(day).start) === day;
}

/** Lit et vérifie la forme de la demande (`POST /api/cash/closings`) ; lève une `SaleError` 400 sinon. */
export function parseClosingRequest(input: unknown): ClosingRequest {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)) throw new SaleError(400, "vente.requete");
  if (!validDay(body.day)) throw new SaleError(400, "cloture.jour");
  const counted = body.cash_counted;
  if (!Number.isInteger(counted) || (counted as number) < 0 || (counted as number) > 1_000_000_000) throw new SaleError(400, "cloture.especes");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 500) throw new SaleError(400, "cloture.note");
  return { request_id: body.request_id, day: body.day, cash_counted: counted as number, note };
}

/**
 * Clôture la période ouverte d'un jour (aujourd'hui ou un jour passé), dans
 * la transaction ouverte par l'appelant : même `request_id` pour le même
 * jour, la clôture existante (`replay`) ; pour un autre jour, refusée (409,
 * identifiant d'envoi déjà pris). Sinon le résumé est recalculé ici, jamais
 * repris de l'écran, borné par `last_invoice_id` (plus grand identifiant de
 * facture existant à cet instant, dans cette transaction), jamais par
 * `issued_at` (correctif § 6.3). Refusée si rien n'a été émis depuis la
 * clôture précédente du même jour (double appui, clôture en trop).
 */
export function closeTill(db: Database, req: ClosingRequest, ctx: { now: number; accountId: number }): { id: number; replay: boolean } {
  const existing = db.prepare("SELECT id, day FROM cash_closings WHERE request_id = ?").get(req.request_id) as Row | undefined;
  if (existing) {
    if (String(existing.day) !== req.day) throw new SaleError(409, "cloture.requete_jour");
    return { id: Number(existing.id), replay: true };
  }
  if (req.day > doualaDay(ctx.now)) throw new SaleError(400, "cloture.jour");
  if (req.day < doualaDay(ctx.now - CLOSING_WINDOW_DAYS * 86_400_000)) throw new SaleError(400, "cloture.trop_ancien", { jours: CLOSING_WINDOW_DAYS });
  const { start } = dayBounds(req.day);
  const last = db.prepare("SELECT seq, closed_at, last_invoice_id, last_payment_id FROM cash_closings WHERE day = ? ORDER BY seq DESC LIMIT 1").get(req.day) as Row | undefined;
  const periodStart = last ? Number(last.closed_at) + 1 : start;
  const from = { invoice: last ? Number(last.last_invoice_id) : 0, payment: last ? Number(last.last_payment_id) : 0 };
  const lastInvoiceId = Number((db.prepare("SELECT MAX(id) AS max FROM invoices").get() as Row).max ?? 0);
  const lastPaymentId = Number((db.prepare("SELECT MAX(id) AS max FROM payments").get() as Row).max ?? 0);
  const rows = periodRows(db, req.day, from, { invoice: lastInvoiceId, payment: lastPaymentId });
  if (last && rows.documents.length === 0 && rows.deposits.length === 0) throw new SaleError(409, "cloture.rien");
  const summary = summarize(rows);
  const info = db.prepare(
    `INSERT INTO cash_closings (day, seq, closed_at, period_start, last_invoice_id, last_payment_id, account_id, expected, cash_expected, cash_counted, difference, note, request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    req.day, last ? Number(last.seq) + 1 : 1, ctx.now, periodStart, lastInvoiceId, lastPaymentId, ctx.accountId, JSON.stringify(summary),
    summary.cash_expected, req.cash_counted, req.cash_counted - summary.cash_expected, req.note, req.request_id,
  );
  return { id: Number(info.lastInsertRowid), replay: false };
}

/** Montant signé du ticket : « −15 000 FCFA » ; `plus` : « +15 000 FCFA » pour un écart positif. */
function signed(amount: number, lang: Lang, plus = false): string {
  if (amount < 0) return `\u2212${formatMontantDocument(-amount, lang)}`;
  return plus && amount > 0 ? `+${formatMontantDocument(amount, lang)}` : formatMontantDocument(amount, lang);
}

/** Ticket de clôture de 80 mm : institut, période, personne, documents, net par moyen, espèces, écart, note, pourboires dus, signature de lama. */
export function closingRows(closing: ClosingRecord, identity: { nom?: unknown; adresse?: unknown; marque_documents?: unknown }, lang: Lang, options: { logo?: boolean } = {}): TicketRow[] {
  const t = (key: MessageKey, values?: Record<string, string | number>) => message(lang, key, values);
  const money = (n: number) => formatMontantDocument(n, lang);
  const rows: TicketRow[] = [];
  const text = (value: string, style: TicketStyle, align: "left" | "center" = "left") => {
    if (value.trim()) rows.push({ type: "text", text: value, style, align });
  };
  const pair = (left: string, right: string, style: TicketStyle = "corps") => rows.push({ type: "pair", left, right, style });
  const plural = (n: number, one: MessageKey, many: MessageKey) => t((lang === "fr" ? n < 2 : n === 1) ? one : many, { nombre: n });
  const s = closing.summary;
  const { end } = dayBounds(closing.day);

  // Même règle que le ticket : logo en tête s'il est fourni ; « Logo seul » : le nom passe en petit au pied.
  const name = typeof identity.nom === "string" ? identity.nom : "";
  const logoAlone = options.logo === true && identity.marque_documents === "logo";
  if (options.logo) rows.push({ type: "logo" });
  if (!logoAlone) text(name, "nom", "center");
  text(typeof identity.adresse === "string" ? identity.adresse : "", "entete", "center");
  rows.push({ type: "rule" });
  text(t("ticket.cloture"), "titre", "center");
  text(t("ticket.cloture_numero", { date: calendarDate(closing.day), numero: closing.seq }), "numero", "center");
  const fin = ticketTime(Math.min(closing.closed_at, end - 60_000));
  // Seconde clôture (report de la vague 3a) : sa période se délimite par les documents, pas par l'heure ; une vente
  // écrite en retard peut porter une heure d'avant la clôture précédente. Le ticket dit donc « après la clôture n° … ».
  if (closing.seq > 1) text(t("ticket.cloture_suite", { numero: closing.seq - 1, fin }), "detail", "center");
  else text(t("ticket.cloture_periode", { debut: ticketTime(closing.period_start), fin }), "detail", "center");
  if (closing.account_name) text(t("ticket.cloture_par", { nom: closing.account_name }), "detail", "center");
  if (closing.closed_at >= end) text(t("ticket.cloturee_le", { date: calendarDate(doualaDay(closing.closed_at)), heure: ticketTime(closing.closed_at) }), "detail", "center");
  rows.push({ type: "rule" });
  pair(plural(s.invoices.count, "ticket.factures_une", "ticket.factures"), money(s.invoices.total));
  pair(plural(s.credit_notes.count, "ticket.avoirs_un", "ticket.avoirs"), s.credit_notes.total > 0 ? signed(-s.credit_notes.total, lang) : money(0));
  // Acomptes (vague 3b) : seulement s'il y en a eu, leurs versements sont déjà dans les moyens ci-dessous.
  const dep = s.deposits;
  if (dep.received.count > 0) pair(plural(dep.received.count, "ticket.acomptes_un", "ticket.acomptes"), money(dep.received.total));
  if (dep.refunded.count > 0) pair(plural(dep.refunded.count, "ticket.acomptes_rembourses_un", "ticket.acomptes_rembourses"), signed(-dep.refunded.total, lang));
  rows.push({ type: "rule" });
  for (const m of s.methods.filter((x) => x.received > 0 || x.refunded > 0)) {
    pair(methodText(m.method, lang), signed(m.net, lang));
    if (m.refunded > 0) text(t("ticket.recu_rembourse", { recu: money(m.received), rembourse: money(m.refunded) }), "detail");
  }
  rows.push({ type: "rule" });
  pair(t("ticket.especes_attendues"), signed(closing.cash_expected, lang));
  pair(t("ticket.especes_comptees"), money(closing.cash_counted));
  pair(t("ticket.ecart"), signed(closing.difference, lang, true), "total");
  if (closing.note) text(t("ticket.note", { note: closing.note }), "detail");
  if (s.tips.length) {
    rows.push({ type: "rule" });
    text(t("ticket.pourboires_dus"), "detail");
    for (const tip of s.tips) pair(tip.staff_name, money(tip.amount));
  }
  rows.push({ type: "rule" });
  if (logoAlone) text(name, "mention", "center");
  text(t("ticket.propulse"), "mention", "center");
  // Base de formation (D-18) : « FORMATION » en tête et au pied du ticket de clôture.
  return marquerFormation(rows.map((row) => {
    if (row.type === "text") return { ...row, text: printable(row.text) };
    if (row.type === "pair") return { ...row, left: printable(row.left), right: printable(row.right) };
    return row;
  }), lang);
}
