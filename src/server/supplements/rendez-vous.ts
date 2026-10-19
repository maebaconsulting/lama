/**
 * Suppléments d'un rendez-vous (spec du 18/10/2026 § 3.3) : forme des suppléments reçus,
 * résolution d'après le catalogue (libellés, prix et minutes figés sur le rendez-vous ;
 * saisie gardée pour un supplément libre), écriture, totaux et lecture. Fonctions
 * synchrones sur la base, dans la transaction de l'appelant (sauf `attachSupplements`) ;
 * un refus lève une `SupplementError` et l'appelant annule tout.
 */
import { query } from "@clawnify/db";
import type { Database } from "../storage.ts";
import { entierMineur } from "../../shared/montants.ts";
import { montant } from "../messages.ts";
import { libreProblem, QUANTITE_MAX, SUPPLEMENTS_PAR_PRESTATION, type SupplementKind } from "../../shared/supplements.ts";
import { SupplementError } from "./catalogue.ts";
import { addMinutes } from "../rendez-vous-commun.ts";
import { CLOSE_TIME, DAY_CLOSE, findConflicts, toMinutes, type Busy } from "../scheduling.ts";
import { busyOn } from "../transferts.ts";

/** Supplément envoyé par l'écran ; `label`, `price` et `minutes` ne valent que pour un supplément libre. */
export interface SupplementInput {
  kind: SupplementKind;
  ref_id: number | null;
  quantity: number;
  label: string;
  price: number;
  minutes: number;
}

/** Supplément prêt à écrire : libellés, prix unitaire et minutes figés. */
export interface StoredSupplement {
  kind: SupplementKind;
  ref_id: number | null;
  label_fr: string;
  label_en: string;
  quantity: number;
  price: number;
  minutes: number;
}

type Row = Record<string, unknown>;
const isId = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** Forme d'un supplément reçu ; lève une `SupplementError` 400 sinon. */
export function parseSupplement(raw: unknown): SupplementInput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.kind === "libre") {
    const minutes = r.minutes === undefined || r.minutes === null ? 0 : r.minutes;
    const problem = libreProblem({ label: r.label, price: r.price, minutes });
    if (problem) throw new SupplementError(400, problem);
    return { kind: "libre", ref_id: null, quantity: 1, label: (r.label as string).trim(), price: r.price as number, minutes: minutes as number };
  }
  if ((r.kind !== "service" && r.kind !== "product") || !isId(r.ref_id)) throw new SupplementError(400, "supplement.invalide");
  const quantity = r.quantity === undefined || r.quantity === null ? 1 : r.quantity;
  if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > QUANTITE_MAX || (r.kind === "service" && quantity !== 1)) {
    throw new SupplementError(400, "supplement.quantite");
  }
  return { kind: r.kind, ref_id: r.ref_id, quantity: quantity as number, label: "", price: 0, minutes: 0 };
}

/**
 * Supplément résolu sous la prestation `parentServiceId` : une prestation qui existe (même
 * désactivée depuis : un rendez-vous garde ses suppléments, l'écran ne la propose plus), jamais
 * elle-même ni une prestation qui a sa propre liste (durée de sa fiche) ; un produit existant
 * (0 minute) ; un supplément libre tel que saisi. La liste des suppléments possibles reste une
 * proposition de l'écran (décision du plan).
 */
export function resolveSupplement(db: Database, parentServiceId: number, input: SupplementInput): StoredSupplement {
  if (input.kind === "libre") {
    return { kind: "libre", ref_id: null, label_fr: input.label, label_en: "", quantity: 1, price: input.price, minutes: input.minutes };
  }
  const id = input.ref_id as number;
  if (input.kind === "service") {
    if (id === parentServiceId) throw new SupplementError(400, "supplement.lui_meme");
    const s = db.prepare("SELECT name, name_en, price, duration FROM services WHERE id = ?").get(id) as Row | undefined;
    if (!s) throw new SupplementError(404, "supplement.introuvable", { id });
    if (db.prepare("SELECT 1 AS x FROM service_supplements WHERE service_id = ?").get(id)) {
      throw new SupplementError(409, "supplement.a_une_liste", { nom: String(s.name) });
    }
    return { kind: "service", ref_id: id, label_fr: String(s.name), label_en: String(s.name_en ?? ""), quantity: 1, price: entierMineur(s.price as number), minutes: Number(s.duration) };
  }
  const p = db.prepare("SELECT name, name_en, price FROM products WHERE id = ?").get(id) as Row | undefined;
  if (!p) throw new SupplementError(404, "supplement.introuvable", { id });
  return { kind: "product", ref_id: id, label_fr: String(p.name), label_en: String(p.name_en ?? ""), quantity: input.quantity, price: entierMineur(p.price as number), minutes: 0 };
}

/** Écrit, dans l'ordre reçu, les suppléments d'une prestation du rendez-vous (20 au plus). */
export function insertSupplements(db: Database, appointmentServiceId: number, list: StoredSupplement[]): void {
  if (list.length > SUPPLEMENTS_PAR_PRESTATION) throw new SupplementError(400, "supplement.trop");
  const add = db.prepare(
    `INSERT INTO appointment_supplements (appointment_service_id, kind, ref_id, label_fr, label_en, quantity, price, minutes, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  list.forEach((s, position) => add.run(appointmentServiceId, s.kind, s.ref_id, s.label_fr, s.label_en, s.quantity, s.price, s.minutes, position));
}

/** Minutes ajoutées et montant (prix unitaire × quantité) d'une liste de suppléments. */
export function supplementTotals(list: { quantity: number; price: number; minutes: number }[]): { minutes: number; price: number } {
  return list.reduce((t, s) => ({ minutes: t.minutes + s.minutes, price: t.price + s.price * s.quantity }), { minutes: 0, price: 0 });
}

/** Range sous chaque prestation lue d'un rendez-vous (`appointment_services`) ses suppléments, dans l'ordre (`supplements`). */
export async function attachSupplements(services: Record<string, unknown>[]): Promise<void> {
  if (services.length === 0) return;
  const ids = services.map((s) => Number(s.id));
  const rows = await query<Record<string, unknown>>(
    `SELECT id, appointment_service_id, kind, ref_id, label_fr, label_en, quantity, price, minutes, position
       FROM appointment_supplements WHERE appointment_service_id IN (${ids.map(() => "?").join(",")}) ORDER BY position, id`,
    ids,
  );
  for (const s of services) s.supplements = rows.filter((r) => Number(r.appointment_service_id) === Number(s.id));
}

export type EditOutcome =
  | { absent: true }
  | { paid: true }
  | { conflicts: Busy[]; staffId: number }
  | { identifier: string; end_time: string; total_price: number; added: StoredSupplement[] };

/** Clé d'un supplément libre : même libellé, même prix, mêmes minutes. */
const cleLibre = (s: { label_fr: unknown; price: unknown; minutes: unknown }) => `${String(s.label_fr)}\n${Number(s.price)}\n${Number(s.minutes)}`;

/**
 * Remplace tous les suppléments d'un rendez-vous (spec § 3.3), dans la transaction de
 * l'appelant. Refusé s'il est encaissé (facture active) ; chaque supplément est résolu sous
 * sa prestation du rendez-vous ; nouvelle fin = ancienne fin + écart des minutes, jamais
 * après la fermeture ; chevauchement contrôlé si la durée s'allonge (sauf `allowConflict`,
 * rendez-vous annulé ou sans praticienne) ; total prévu recalculé, jamais sous l'acompte en attente. Rend aussi les suppléments
 * libres ajoutés (absents avant, à libellé, prix et minutes égaux), pour le journal.
 */
export function editSupplements(
  db: Database,
  appointmentId: number,
  inputs: { serviceRow: number; input: SupplementInput }[],
  allowConflict: boolean,
): EditOutcome {
  const apt = db.prepare("SELECT identifier, staff_id, scheduled_date, start_time, end_time, status FROM appointments WHERE id = ?").get(appointmentId) as Row | undefined;
  if (!apt) return { absent: true };
  const paid = db.prepare("SELECT 1 AS x FROM invoices i JOIN invoice_balance b ON b.invoice_id = i.id WHERE i.appointment_id = ? AND b.cancelled = 0").get(appointmentId);
  if (paid) return { paid: true };
  const services = db.prepare("SELECT id, service_id, price FROM appointment_services WHERE appointment_id = ? ORDER BY id").all(appointmentId) as Row[];
  const byRow = new Map<number, StoredSupplement[]>(services.map((s) => [Number(s.id), []]));
  for (const { serviceRow, input } of inputs) {
    const svc = services.find((s) => Number(s.id) === serviceRow);
    const list = byRow.get(serviceRow);
    if (!svc || !list) throw new SupplementError(400, "rdv.prestation_absente");
    list.push(resolveSupplement(db, Number(svc.service_id), input));
    if (list.length > SUPPLEMENTS_PAR_PRESTATION) throw new SupplementError(400, "supplement.trop");
  }
  const old = db.prepare(
    `SELECT s.kind, s.label_fr, s.quantity, s.price, s.minutes FROM appointment_supplements s
       JOIN appointment_services aps ON aps.id = s.appointment_service_id WHERE aps.appointment_id = ?`,
  ).all(appointmentId) as Row[];
  const next = [...byRow.values()].flat();
  const before = supplementTotals(old.map((o) => ({ quantity: Number(o.quantity), price: Number(o.price), minutes: Number(o.minutes) })));
  const after = supplementTotals(next);

  const startTime = String(apt.start_time);
  const start = toMinutes(startTime);
  const end = toMinutes(String(apt.end_time));
  if (start === null || end === null) throw new SupplementError(400, "rdv.heures_format");
  const newEnd = end + after.minutes - before.minutes;
  if (newEnd <= start) throw new SupplementError(400, "rdv.fin_apres_debut");
  const endTime = addMinutes(startTime, newEnd - start);
  // Retirer ou raccourcir n'est jamais refusé pour la fermeture : seule une fin plus tardive est contrôlée.
  if (newEnd > end && newEnd > DAY_CLOSE) throw new SupplementError(400, "rdv.fin_apres_fermeture", { fin: endTime, fermeture: CLOSE_TIME });
  const staffId = apt.staff_id === null ? null : Number(apt.staff_id);
  if (newEnd > end && staffId !== null && apt.status !== "cancelled" && !allowConflict) {
    const conflicts = findConflicts(startTime, endTime, busyOn(db, staffId, String(apt.scheduled_date), appointmentId));
    if (conflicts.length > 0) return { conflicts, staffId };
  }

  const total = services.reduce((sum, s) => sum + Number(s.price), 0) + after.price;
  // Un acompte en attente ne dépasse jamais le total prévu (plafond de l'encaissement) : il ne le dépasse pas non plus après.
  const held = db.prepare("SELECT amount FROM deposits WHERE appointment_id = ? AND status = 'held'").get(appointmentId) as Row | undefined;
  if (held && total < Number(held.amount)) throw new SupplementError(400, "supplement.sous_acompte", { montant: montant(Number(held.amount)) });

  db.prepare("DELETE FROM appointment_supplements WHERE appointment_service_id IN (SELECT id FROM appointment_services WHERE appointment_id = ?)").run(appointmentId);
  for (const [row, list] of byRow) insertSupplements(db, row, list);
  db.prepare("UPDATE appointments SET end_time = ?, total_price = ?, updated_at = datetime('now') WHERE id = ?").run(endTime, total, appointmentId);

  const pool = old.filter((o) => o.kind === "libre").map((o) => cleLibre({ label_fr: o.label_fr, price: o.price, minutes: o.minutes }));
  const added = next.filter((s) => {
    if (s.kind !== "libre") return false;
    const at = pool.indexOf(cleLibre(s));
    if (at < 0) return true;
    pool.splice(at, 1);
    return false;
  });
  return { identifier: String(apt.identifier), end_time: endTime, total_price: total, added };
}
