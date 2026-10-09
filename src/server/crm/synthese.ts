/**
 * Synthèse de la fiche d'une cliente (mini CRM § 1, décisions 5 à 9) :
 * visites (rendez-vous terminés), absence en jours entiers de Douala,
 * prochain rendez-vous réservé ou confirmé, trois prestations habituelles,
 * praticienne préférée (deux visites au moins, égalité à la plus récente),
 * cinq produits les plus achetés (nets des avoirs), total dépensé (factures
 * moins avoirs, pourboires exclus) et panier moyen (factures non annulées).
 * Les montants ne sont jamais rendus à la praticienne, comme `redactAppointment`.
 * Fonction synchrone sur la base, en lecture seule.
 */
import type { Database } from "../storage.ts";
import type { Role } from "../auth/accounts.ts";
import { doualaDay } from "../../shared/caisse.ts";

export type ClientSummary = {
  visits: number;
  last_visit: string | null;
  days_since: number | null;
  next_appointment: { id: number; date: string; time: string } | null;
  usual_services: { name: string; name_en: string; count: number }[];
  favorite_staff: { id: number; name: string; color: string; count: number } | null;
  products: { label_fr: string; label_en: string; quantity: number; last: number }[];
  total_spent?: number;
  average_basket?: number;
  invoice_count?: number;
  loyalty: { balance: number; next_tier: { points: number; montant: number; missing: number } | null } | null;
};

export interface SummaryOptions {
  now: number;
  role: Role;
  /** Fidélité (vague 2) : solde et prochain palier ; sans elle, `loyalty` vaut null. */
  loyalty?: (db: Database, clientId: number) => ClientSummary["loyalty"];
}

const DAY_MS = 86_400_000;
/** Douala est à UTC+1 toute l'année (pas d'heure d'été), comme `doualaDay`. */
const DOUALA_OFFSET_MS = 60 * 60_000;
/** Rôles à qui aucun montant n'est rendu (sous-projet 4 § 3.4). */
const AMOUNTS_HIDDEN: Role[] = ["practitioner"];

/** Jours entiers de Douala entre la dernière visite (`aaaa-mm-jj`) et `now` ; jamais négatif. */
export function daysSince(lastVisit: string, now: number): number {
  const today = Date.parse(`${doualaDay(now)}T00:00:00Z`);
  const last = Date.parse(`${lastVisit}T00:00:00Z`);
  return Math.max(0, Math.round((today - last) / DAY_MS));
}

/** Heure de Douala `hh:mm` d'un instant. */
function doualaTime(now: number): string {
  return new Date(now + DOUALA_OFFSET_MS).toISOString().slice(11, 16);
}

type Param = string | number;

export function clientSummary(db: Database, clientId: number, opts: SummaryOptions): ClientSummary {
  const one = <T>(sql: string, ...params: Param[]) => db.prepare(sql).get(...params) as T;
  const all = <T>(sql: string, ...params: Param[]) => db.prepare(sql).all(...params) as T[];

  const visits = one<{ n: number; last: string | null }>(
    "SELECT COUNT(*) AS n, MAX(scheduled_date) AS last FROM appointments WHERE client_id = ? AND status = 'completed'",
    clientId,
  );
  const today = doualaDay(opts.now);
  const next = one<{ id: number; date: string; time: string } | undefined>(
    `SELECT id, scheduled_date AS date, start_time AS time FROM appointments
      WHERE client_id = ? AND status IN ('booked', 'confirmed')
        AND (scheduled_date > ? OR (scheduled_date = ? AND start_time >= ?))
      ORDER BY scheduled_date, start_time LIMIT 1`,
    clientId, today, today, doualaTime(opts.now),
  );
  const usual = all<{ name: string; name_en: string | null; count: number }>(
    `SELECT s.name AS name, s.name_en AS name_en, COUNT(*) AS count
       FROM appointment_services aps
       JOIN appointments a ON a.id = aps.appointment_id
       JOIN services s ON s.id = aps.service_id
      WHERE a.client_id = ? AND a.status = 'completed'
      GROUP BY aps.service_id ORDER BY count DESC, s.name ASC LIMIT 3`,
    clientId,
  );
  const favorite = one<{ id: number; name: string; color: string; count: number } | undefined>(
    `SELECT s.id AS id, s.name AS name, s.color AS color, COUNT(*) AS count, MAX(a.scheduled_date || ' ' || a.start_time) AS latest
       FROM appointments a JOIN staff s ON s.id = a.staff_id
      WHERE a.client_id = ? AND a.status = 'completed'
      GROUP BY s.id ORDER BY count DESC, latest DESC LIMIT 1`,
    clientId,
  );
  // Quantités nettes des avoirs ; date du dernier achat sur une facture non annulée.
  const bought = all<{ ref_id: number; quantity: number; last: number | null }>(
    `SELECT l.ref_id AS ref_id,
            SUM(CASE WHEN i.kind = 'invoice' THEN l.quantity ELSE -l.quantity END) AS quantity,
            MAX(CASE WHEN i.kind = 'invoice' AND b.cancelled = 0 THEN i.issued_at END) AS last
       FROM invoice_lines l
       JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN invoice_balance b ON b.invoice_id = i.id
      WHERE i.client_id = ? AND l.kind = 'product'
      GROUP BY l.ref_id HAVING quantity > 0
      ORDER BY quantity DESC, last DESC LIMIT 5`,
    clientId,
  );
  // Désignation de la facture la plus récente (le catalogue a pu changer depuis).
  const label = db.prepare(
    `SELECT l.label_fr AS label_fr, l.label_en AS label_en FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE i.client_id = ? AND i.kind = 'invoice' AND l.kind = 'product' AND l.ref_id = ?
      ORDER BY i.issued_at DESC, l.id DESC LIMIT 1`,
  );

  const summary: ClientSummary = {
    visits: Number(visits.n),
    last_visit: visits.last,
    days_since: visits.last ? daysSince(visits.last, opts.now) : null,
    next_appointment: next ? { id: Number(next.id), date: next.date, time: next.time } : null,
    usual_services: usual.map((u) => ({ name: u.name, name_en: u.name_en ?? "", count: Number(u.count) })),
    favorite_staff: favorite && Number(favorite.count) >= 2
      ? { id: Number(favorite.id), name: favorite.name, color: favorite.color, count: Number(favorite.count) }
      : null,
    products: bought.map((p) => {
      const l = label.get(clientId, p.ref_id) as { label_fr: string; label_en: string };
      return { label_fr: l.label_fr, label_en: l.label_en, quantity: Number(p.quantity), last: Number(p.last ?? 0) };
    }),
    loyalty: null,
  };
  if (AMOUNTS_HIDDEN.includes(opts.role)) return summary;

  const spent = one<{ total: number }>(
    "SELECT COALESCE(SUM(CASE WHEN kind = 'invoice' THEN total_ttc ELSE -total_ttc END), 0) AS total FROM invoices WHERE client_id = ?",
    clientId,
  );
  const count = one<{ n: number }>("SELECT COUNT(*) AS n FROM invoice_balance WHERE client_id = ? AND cancelled = 0", clientId);
  summary.total_spent = Number(spent.total);
  summary.invoice_count = Number(count.n);
  summary.average_basket = summary.invoice_count > 0 ? Math.round(summary.total_spent / summary.invoice_count) : 0;
  summary.loyalty = opts.loyalty ? opts.loyalty(db, clientId) : null;
  return summary;
}
