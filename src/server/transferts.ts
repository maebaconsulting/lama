/**
 * Transfert des rendez-vous d'une praticienne absente (spec du 04/10/2026) :
 * période, rendez-vous concernés, occupation des collègues, proposition et
 * contrôle d'un envoi. Fonctions synchrones sur la base ouverte dans une
 * transaction (`StorageBinding.transaction`) : le contrôle et l'écriture d'un
 * transfert groupé ne laissent aucune place à un autre envoi entre les deux.
 * Les objets rendus sont des objets ordinaires (pas les lignes de SQLite).
 */
import { doualaDay } from "../shared/caisse.ts";
import { coded, message, type Lang, type MessageKey } from "./messages.ts";
import { queueAppointmentMessage, type MessageSettings } from "./whatsapp/rendez-vous.ts";
import { findConflicts, type Busy } from "./scheduling.ts";
import type { Database } from "./storage.ts";
import { appointmentAt } from "./whatsapp/numeros.ts";

/** Longueur maximale d'une période, premier et dernier jours compris. */
export const MAX_PERIOD_DAYS = 31;
/** Mouvements au plus dans un envoi. */
export const MAX_MOVES = 500;
const DAY_MS = 24 * 60 * 60_000;
/** Statuts qui se transfèrent (décision 7) : en cours, terminés, annulés ou absents ne bougent pas. */
const MOVABLE = ["booked", "confirmed"];

export interface Period { from: string; to: string }
export interface StaffRef { id: number; name: string; color: string }
export interface TransferAppointment {
  id: number;
  identifier: string;
  date: string;
  start_time: string;
  end_time: string;
  client_name: string;
  services: { name: string; name_en: string }[];
}
export interface ProposalRow extends TransferAppointment { proposed_staff_id: number | null; free_staff_ids: number[] }
export interface Proposal { from: { id: number; name: string }; appointments: ProposalRow[]; staff: StaffRef[] }
export interface Move { appointment_id: number; staff_id: number }
export interface TransferInput { from_staff_id: number; moves: Move[]; notify: boolean }
export interface CheckedMove extends Move { identifier: string; date: string; start_time: string; end_time: string; staff_name: string; replay: boolean }
/** Refus d'un mouvement ; `reason` sous forme codée, traduite à la sortie. */
export interface TransferConflict { appointment_id: number; identifier: string; reason: string }

/** Jour `aaaa-mm-jj` qui existe au calendrier (le 31 février est refusé). */
function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}

/** Période demandée : aujourd'hui (Douala) par défaut, « au » égal à « du » s'il manque ; dans l'ordre, 31 jours au plus. */
export function readPeriod(from: string | undefined, to: string | undefined, now: number): Period | { error: MessageKey } {
  const start = from || doualaDay(now);
  const end = to || start;
  if (!validDay(start) || !validDay(end)) return { error: "transfert.periode" };
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS + 1;
  if (days < 1 || days > MAX_PERIOD_DAYS) return { error: "transfert.periode" };
  return { from: start, to: end };
}

/** Fiche de l'équipe, active ou non ; `null` si elle n'existe pas. */
export function staffRow(db: Database, id: number): (StaffRef & { active: number }) | null {
  const row = db.prepare("SELECT id, name, color, active FROM staff WHERE id = ?").get(id) as (StaffRef & { active: number }) | undefined;
  return row ? { id: row.id, name: row.name, color: row.color, active: row.active } : null;
}

/** Collègues qui peuvent recevoir (décision 8) : fiches actives sauf la praticienne absente, dans l'ordre de l'équipe. */
export function colleaguesOf(db: Database, fromStaffId: number): StaffRef[] {
  const rows = db.prepare("SELECT id, name, color FROM staff WHERE active = 1 AND id != ? ORDER BY name ASC, id ASC").all(fromStaffId) as unknown as StaffRef[];
  return rows.map((s) => ({ id: s.id, name: s.name, color: s.color }));
}

/**
 * Occupation d'une praticienne un jour donné : rendez-vous non annulés et
 * créneaux bloqués. `excludeAppointmentId` : le rendez-vous que l'on déplace,
 * qui ne se gêne pas lui-même (V1-01).
 */
export function busyOn(db: Database, staffId: number, date: string, excludeAppointmentId?: number): Busy[] {
  const appts = db.prepare(
    `SELECT a.start_time, a.end_time, cl.name AS client_name FROM appointments a LEFT JOIN clients cl ON cl.id = a.client_id
      WHERE a.staff_id = ? AND a.scheduled_date = ? AND a.status != 'cancelled' AND a.id != ?`,
  ).all(staffId, date, excludeAppointmentId ?? 0) as { start_time: string; end_time: string; client_name: string | null }[];
  const blocks = db.prepare("SELECT start_time, end_time, reason FROM blocked_slots WHERE staff_id = ? AND blocked_date = ?")
    .all(staffId, date) as { start_time: string; end_time: string; reason: string | null }[];
  return [
    ...appts.map((a): Busy => ({ kind: "appointment", start_time: a.start_time, end_time: a.end_time, label: a.client_name || "" })),
    ...blocks.map((b): Busy => ({ kind: "blocked", start_time: b.start_time, end_time: b.end_time, label: b.reason || "" })),
  ];
}

/** Rendez-vous non annulés d'une praticienne ce jour-là : sa charge, pour la proposition. */
function loadOn(db: Database, staffId: number, date: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM appointments WHERE staff_id = ? AND scheduled_date = ? AND status != 'cancelled'")
    .get(staffId, date) as { n: number }).n;
}

/** Vrai si le rendez-vous n'a pas encore commencé : heure de début strictement après l'instant, à l'heure de Douala. */
export function notStarted(date: string, startTime: string, now: number): boolean {
  const at = appointmentAt(date, startTime.slice(0, 5));
  return Number.isFinite(at) && at > now;
}

/** Rendez-vous concernés (décision 7) : à la praticienne, réservés ou confirmés, dans la période, pas commencés ; dans l'ordre du temps. */
export function movableAppointments(db: Database, staffId: number, period: Period, now: number): TransferAppointment[] {
  const rows = db.prepare(
    `SELECT a.id, a.identifier, a.scheduled_date, a.start_time, a.end_time, COALESCE(cl.name, '') AS client_name
       FROM appointments a LEFT JOIN clients cl ON cl.id = a.client_id
      WHERE a.staff_id = ? AND a.status IN ('booked', 'confirmed') AND a.scheduled_date BETWEEN ? AND ?
      ORDER BY a.scheduled_date, a.start_time, a.id`,
  ).all(staffId, period.from, period.to) as { id: number; identifier: string; scheduled_date: string; start_time: string; end_time: string; client_name: string }[];
  const services = db.prepare(
    "SELECT sv.name, COALESCE(sv.name_en, '') AS name_en FROM appointment_services aps JOIN services sv ON sv.id = aps.service_id WHERE aps.appointment_id = ? ORDER BY aps.id",
  );
  return rows.filter((r) => notStarted(r.scheduled_date, r.start_time, now)).map((r) => ({
    id: r.id,
    identifier: r.identifier,
    date: r.scheduled_date,
    start_time: r.start_time,
    end_time: r.end_time,
    client_name: r.client_name,
    services: (services.all(r.id) as { name: string; name_en: string }[]).map((s) => ({ name: s.name, name_en: s.name_en })),
  }));
}

/**
 * Proposition (décision 8) : pour chaque rendez-vous, dans l'ordre du temps,
 * la collègue libre sur tout le créneau qui a le moins de rendez-vous ce
 * jour-là, à égalité la première dans l'ordre de l'équipe ; les propositions
 * déjà faites dans la même fenêtre occupent la collègue et comptent dans sa
 * charge. `free_staff_ids` : libres d'après la base seule (l'écran recalcule
 * les chevauchements entre ses propres choix). `null` si la praticienne n'existe pas.
 */
export function transferProposal(db: Database, fromStaffId: number, period: Period, now: number): Proposal | null {
  const from = staffRow(db, fromStaffId);
  if (!from) return null;
  const staff = colleaguesOf(db, fromStaffId);
  const busy = new Map<string, Busy[]>();
  const planned = new Map<string, Busy[]>();
  const load = new Map<string, number>();
  const key = (id: number, date: string) => `${id}:${date}`;
  const busyOf = (id: number, date: string): Busy[] => {
    const k = key(id, date);
    if (!busy.has(k)) busy.set(k, busyOn(db, id, date));
    return busy.get(k)!;
  };
  const plannedOf = (id: number, date: string): Busy[] => {
    const k = key(id, date);
    if (!planned.has(k)) planned.set(k, []);
    return planned.get(k)!;
  };
  const loadOf = (id: number, date: string): number => {
    const k = key(id, date);
    if (!load.has(k)) load.set(k, loadOn(db, id, date));
    return load.get(k)!;
  };
  const appointments = movableAppointments(db, fromStaffId, period, now).map((apt): ProposalRow => {
    const free = staff.filter((s) => findConflicts(apt.start_time, apt.end_time, busyOf(s.id, apt.date)).length === 0);
    const open = free.filter((s) => findConflicts(apt.start_time, apt.end_time, plannedOf(s.id, apt.date)).length === 0);
    // Tri stable : à charge égale, l'ordre de l'équipe est gardé.
    const chosen = [...open].sort((a, b) => loadOf(a.id, apt.date) - loadOf(b.id, apt.date))[0] ?? null;
    if (chosen) {
      plannedOf(chosen.id, apt.date).push({ kind: "appointment", start_time: apt.start_time, end_time: apt.end_time, label: apt.client_name });
      load.set(key(chosen.id, apt.date), loadOf(chosen.id, apt.date) + 1);
    }
    return { ...apt, proposed_staff_id: chosen ? chosen.id : null, free_staff_ids: free.map((s) => s.id) };
  });
  return { from: { id: from.id, name: from.name }, appointments, staff };
}

const positiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;

/** Corps de `POST /api/transfers` contrôlé ; un problème est rendu sous forme codée. */
export function transferInput(body: Record<string, unknown>): TransferInput | { error: string } {
  const { from_staff_id: from, moves, notify } = body;
  if (!positiveInt(from) || !Array.isArray(moves) || moves.length === 0 || moves.length > MAX_MOVES || typeof notify !== "boolean") {
    return { error: coded("transfert.corps") };
  }
  const seen = new Set<number>();
  const out: Move[] = [];
  for (const raw of moves) {
    const move = raw as Record<string, unknown> | null;
    if (!move || typeof move !== "object" || !positiveInt(move.appointment_id) || !positiveInt(move.staff_id)) return { error: coded("transfert.corps") };
    if (move.staff_id === from) return { error: coded("transfert.meme_praticienne") };
    if (seen.has(move.appointment_id)) return { error: coded("transfert.doublon") };
    seen.add(move.appointment_id);
    out.push({ appointment_id: move.appointment_id, staff_id: move.staff_id });
  }
  return { from_staff_id: from, moves: out, notify };
}

/**
 * Contrôle d'un envoi (décision 6), dans la transaction de l'écriture :
 * chaque rendez-vous encore à la praticienne de départ, réservé ou confirmé,
 * pas commencé ; chaque collègue active et libre, en comptant les autres
 * mouvements du même envoi. Un mouvement déjà fait (rendez-vous déjà à la
 * collègue demandée) est un rejeu : accepté, rien n'est réécrit. Tout ou
 * rien : la liste des refus, ou les mouvements contrôlés.
 */
export function checkTransfer(db: Database, input: TransferInput, now: number): { moves: CheckedMove[] } | { conflicts: TransferConflict[] } {
  const fromName = staffRow(db, input.from_staff_id)?.name ?? "";
  const conflicts: TransferConflict[] = [];
  const checked: CheckedMove[] = [];
  const refuse = (appointmentId: number, identifier: string, key: MessageKey, values: Record<string, string> = {}) => {
    conflicts.push({ appointment_id: appointmentId, identifier, reason: coded(key, { ref: identifier, ...values }) });
  };
  for (const move of input.moves) {
    const apt = db.prepare("SELECT identifier, staff_id, status, scheduled_date, start_time, end_time FROM appointments WHERE id = ?").get(move.appointment_id) as
      { identifier: string; staff_id: number | null; status: string; scheduled_date: string; start_time: string; end_time: string } | undefined;
    if (!apt) {
      refuse(move.appointment_id, String(move.appointment_id), "transfert.refus.introuvable");
      continue;
    }
    const to = staffRow(db, move.staff_id);
    const found = { ...move, identifier: apt.identifier, date: apt.scheduled_date, start_time: apt.start_time, end_time: apt.end_time, staff_name: to?.name ?? "" };
    // Rejeu (réponse perdue, double appui) : déjà à la collègue demandée.
    if (apt.staff_id === move.staff_id) {
      checked.push({ ...found, replay: true });
      continue;
    }
    if (apt.staff_id !== input.from_staff_id) { refuse(move.appointment_id, apt.identifier, "transfert.refus.plus_a", { de: fromName }); continue; }
    if (!MOVABLE.includes(apt.status)) { refuse(move.appointment_id, apt.identifier, "transfert.refus.statut"); continue; }
    if (!notStarted(apt.scheduled_date, apt.start_time, now)) { refuse(move.appointment_id, apt.identifier, "transfert.refus.commence"); continue; }
    if (!to) { refuse(move.appointment_id, apt.identifier, "transfert.refus.inconnue"); continue; }
    if (!to.active) { refuse(move.appointment_id, apt.identifier, "transfert.refus.inactive", { qui: to.name }); continue; }
    checked.push({ ...found, replay: false });
  }
  // Occupation : la base (rejeux compris, déjà écrits), plus les autres mouvements du même envoi vers la même collègue ce jour-là.
  for (const move of checked) {
    if (move.replay) continue;
    const others = checked
      .filter((o) => o !== move && !o.replay && o.staff_id === move.staff_id && o.date === move.date)
      .map((o): Busy => ({ kind: "appointment", start_time: o.start_time, end_time: o.end_time, label: o.identifier }));
    if (findConflicts(move.start_time, move.end_time, [...busyOn(db, move.staff_id, move.date), ...others]).length > 0) {
      refuse(move.appointment_id, move.identifier, "transfert.refus.occupee", { qui: move.staff_name, debut: move.start_time, fin: move.end_time });
    }
  }
  return conflicts.length > 0 ? { conflicts } : { moves: checked };
}

/** Jour de Douala d'un instant, écrit `jj/mm/aaaa` (même forme dans les deux langues, comme l'écran). */
function shortDay(now: number): string {
  const [y, m, d] = doualaDay(now).split("-");
  return `${d}/${m}/${y}`;
}

/** Note automatique d'un rendez-vous transféré, dans la langue de l'institut (décision 10). */
export function transferNote(lang: Lang, t: { from: string; to: string; by: string; now: number }): string {
  return message(lang, "transfert.note", { de: t.from, vers: t.to, date: shortDay(t.now), par: t.by });
}

/**
 * Écrit les mouvements contrôlés, dans la même transaction que le contrôle :
 * praticienne changée (rien d'autre, décision 9), note sur le rendez-vous,
 * message « transfert » si la case est cochée. Les rejeux ne réécrivent rien.
 * Renvoie le nombre de rendez-vous transférés et le nombre de messages réellement mis en file.
 */
export function writeTransfers(
  db: Database,
  moves: CheckedMove[],
  opts: { fromName: string; by: string; notify: boolean; settings: MessageSettings; now: number },
): { moved: number; queued: number } {
  let moved = 0;
  let queued = 0;
  for (const move of moves) {
    if (move.replay) continue;
    db.prepare("UPDATE appointments SET staff_id = ?, updated_at = datetime('now') WHERE id = ?").run(move.staff_id, move.appointment_id);
    db.prepare("INSERT INTO appointment_notes (appointment_id, content) VALUES (?, ?)")
      .run(move.appointment_id, transferNote(opts.settings.lang, { from: opts.fromName, to: move.staff_name, by: opts.by, now: opts.now }));
    if (opts.notify && queueAppointmentMessage(db, opts.settings, "transfert", move.appointment_id, opts.now)) queued++;
    moved++;
  }
  return { moved, queued };
}
