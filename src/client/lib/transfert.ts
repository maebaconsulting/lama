/**
 * Fenêtre « Transférer des rendez-vous » (spec du 04/10/2026, § 2) : logique
 * pure, testée sous Node. La proposition vient du serveur ; la réception
 * change un choix ligne par ligne ; une collègue choisie pour un rendez-vous
 * est « occupée » pour un autre qui le chevauche. Le serveur revérifie tout.
 */
import { shiftDay } from "./calendrier.ts";

/** Plus longue période permise par le serveur (jours, bornes comprises). */
export const MAX_PERIOD_DAYS = 31;

export interface ProposalStaff { id: number; name: string; color: string }
export interface ProposalRow {
  id: number;
  identifier: string;
  date: string;
  start_time: string;
  end_time: string;
  client_name: string;
  services: { name: string; name_en: string }[];
  proposed_staff_id: number | null;
  free_staff_ids: number[];
}
export interface Proposal { from: { id: number; name: string }; appointments: ProposalRow[]; staff: ProposalStaff[] }
/** Choix de chaque ligne : la collègue, ou `null` pour laisser le rendez-vous à la praticienne absente (« à replacer »). */
export type Choices = Record<number, number | null>;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Même jour et créneaux qui se recouvrent (intervalles semi-ouverts : 10:00-11:00 et 11:00-12:00 se suivent). */
function overlap(a: ProposalRow, b: ProposalRow): boolean {
  return a.date === b.date && minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time);
}

const choiceOf = (choices: Choices, id: number): number | null => choices[id] ?? null;

/** Choix de départ : la collègue proposée par le serveur. */
export function initialChoices(rows: ProposalRow[]): Choices {
  return Object.fromEntries(rows.map((r) => [r.id, r.proposed_staff_id]));
}

/** Menu d'une ligne : libres d'abord (d'après la base et les autres choix), puis les autres, « occupée » ; ordre de l'équipe gardé. */
export function staffOptions(row: ProposalRow, rows: ProposalRow[], choices: Choices, staff: ProposalStaff[]): { free: ProposalStaff[]; busy: ProposalStaff[] } {
  const taken = new Set(rows.filter((r) => r.id !== row.id && overlap(r, row)).map((r) => choiceOf(choices, r.id)).filter((c): c is number => c !== null));
  const isFree = (s: ProposalStaff) => row.free_staff_ids.includes(s.id) && !taken.has(s.id);
  return { free: staff.filter(isFree), busy: staff.filter((s) => !isFree(s)) };
}

/** Lignes dont la collègue choisie n'est pas libre : la validation est refusée tant qu'il en reste. */
export function busyChoices(rows: ProposalRow[], choices: Choices, staff: ProposalStaff[]): ProposalRow[] {
  return rows.filter((r) => {
    const chosen = choiceOf(choices, r.id);
    return chosen !== null && !staffOptions(r, rows, choices, staff).free.some((s) => s.id === chosen);
  });
}

/** Lignes laissées à la praticienne absente : « à replacer ». */
export function toReplace(rows: ProposalRow[], choices: Choices): ProposalRow[] {
  return rows.filter((r) => choiceOf(choices, r.id) === null);
}

/** Nombre de rendez-vous qui changeront de praticienne. */
export function transferCount(rows: ProposalRow[], choices: Choices): number {
  return rows.length - toReplace(rows, choices).length;
}

/** Corps de `POST /api/transfers` : seulement les lignes confiées à une collègue. */
export function transferBody(fromStaffId: number, rows: ProposalRow[], choices: Choices, notify: boolean) {
  return {
    from_staff_id: fromStaffId,
    notify,
    moves: rows.flatMap((r) => {
      const chosen = choiceOf(choices, r.id);
      return chosen === null ? [] : [{ appointment_id: r.id, staff_id: chosen }];
    }),
  };
}

/** Premier jour de la période : le jour demandé s'il est à venir, sinon aujourd'hui (un jour passé n'a plus rien à transférer). */
export function startDay(day: string | null, today: string): string {
  return day && day > today ? day : today;
}

/** Dernier jour permis pour « Au » quand « Du » est `from`. */
export function lastDay(from: string): string {
  return shiftDay(from, MAX_PERIOD_DAYS - 1);
}

/** « Au » ramené dans [from, lastDay(from)] : jamais avant « Du », jamais plus de 31 jours. */
export function clampTo(from: string, to: string): string {
  if (to < from) return from;
  const last = lastDay(from);
  return to > last ? last : to;
}
