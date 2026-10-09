/**
 * Règles de l'accueil selon le rôle (sous-projet 4 § 5), sans dépendance au
 * navigateur pour être testées sous Node : semaine de l'institut, chiffres du
 * jour et de la semaine, lignes de « Ma journée » et de « Aujourd'hui ». Le
 * jour et l'heure viennent toujours de Douala (`todayAt`, `timeAt`), jamais de
 * l'appareil.
 */
import type { Appointment } from "../types.ts";
import { shiftDay } from "./calendrier.ts";
import { nextAppointment } from "./cadre.ts";
import { awaitingArrival, newestFirst } from "./fiche-rdv.ts";

/** Semaine de l'institut, du lundi au dimanche, qui contient `day` (`aaaa-mm-jj`). */
export function weekBounds(day: string): { start: string; end: string } {
  const [y, m, d] = day.split("-").map(Number);
  const monday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // lundi = 0
  const start = shiftDay(day, -monday);
  return { start, end: shiftDay(start, 6) };
}

/**
 * Somme des montants ; `null` si un seul manque (montants retirés pour la
 * praticienne) : jamais un total faux affiché comme vrai.
 */
function sum(list: Appointment[]): number | null {
  let total = 0;
  for (const a of list) {
    if (typeof a.total_price !== "number") return null;
    total += a.total_price;
  }
  return total;
}

export interface DayFigures {
  /** Rendez-vous du jour, annulés exclus (absentes comprises). */
  total: number;
  /** Réservés ou confirmés dont l'heure n'est pas encore venue. */
  remaining: number;
  /** Clientes attendues au comptoir (règle `awaitingArrival`, comme « En retard » dans l'agenda). */
  waiting: number;
  /** Chiffre d'affaires prévu : rendez-vous ni annulés ni absentes ; `null` si des montants manquent. */
  plannedRevenue: number | null;
}

/** Chiffres clés du jour `today` à l'heure `now` (Douala). */
export function dayFigures(appointments: Appointment[], today: string, now: string): DayFigures {
  const day = appointments.filter((a) => a.scheduled_date === today && a.status !== "cancelled");
  return {
    total: day.length,
    remaining: day.filter((a) => (a.status === "booked" || a.status === "confirmed") && a.start_time.slice(0, 5) > now).length,
    waiting: day.filter((a) => awaitingArrival(a, today, now)).length,
    plannedRevenue: sum(day.filter((a) => a.status !== "no_show")),
  };
}

export interface WeekFigures {
  total: number;
  completed: number;
  noShow: number;
  /** Chiffre d'affaires réalisé (rendez-vous terminés) ; `null` si des montants manquent. */
  revenue: number | null;
}

/** Chiffres de la semaine, calculés à l'écran sur les rendez-vous de la semaine (aucun calcul serveur nouveau). */
export function weekFigures(appointments: Appointment[]): WeekFigures {
  const kept = appointments.filter((a) => a.status !== "cancelled");
  const completed = kept.filter((a) => a.status === "completed");
  return {
    total: kept.length,
    completed: completed.length,
    noShow: kept.filter((a) => a.status === "no_show").length,
    revenue: sum(completed),
  };
}

/** État d'une ligne de « Ma journée » : terminé et absente marqués, passé grisé, en cours, à venir. */
export type EtatJournee = "termine" | "absente" | "passe" | "en-cours" | "a-venir";

function etatOf(apt: Appointment, now: string): EtatJournee {
  if (apt.status === "completed") return "termine";
  if (apt.status === "no_show") return "absente";
  if (apt.status === "in_progress") return "en-cours";
  return apt.end_time.slice(0, 5) <= now ? "passe" : "a-venir";
}

const byStart = (a: Appointment, b: Appointment) => a.start_time.localeCompare(b.start_time);

/**
 * « Ma journée » de la praticienne reliée à `staffId` (§ 5.1) : ses rendez-vous
 * du jour dans l'ordre, annulés exclus, avec leur état ; `next` est le prochain
 * (en cours ou à venir), même règle que le « + » (`nextAppointment`). Un soin
 * encore « En cours » après son heure de fin cède la place au rendez-vous
 * suivant (décision 6) ; s'il n'y en a plus, c'est lui qui reste affiché :
 * jamais « journée terminée » tant qu'un soin n'est pas terminé. Sans fiche de
 * l'équipe reliée (`null`) : rien.
 */
export function journee(appointments: Appointment[], staffId: number | null, today: string, now: string): {
  rows: { appointment: Appointment; etat: EtatJournee }[];
  next: Appointment | null;
} {
  if (staffId === null) return { rows: [], next: null };
  const own = appointments
    .filter((a) => a.staff_id === staffId && a.scheduled_date === today && a.status !== "cancelled")
    .sort(byStart);
  const overrun = own.filter((a) => a.status === "in_progress").at(-1) ?? null;
  return { rows: own.map((appointment) => ({ appointment, etat: etatOf(appointment, now) })), next: nextAppointment(own, staffId, today, now) ?? overrun };
}

/** Rendez-vous du jour pour « Aujourd'hui » (§ 5.2) : par heure, puis par praticienne ; annulés exclus. */
export function todayRows(appointments: Appointment[], today: string): Appointment[] {
  return appointments
    .filter((a) => a.scheduled_date === today && a.status !== "cancelled")
    .sort((a, b) => byStart(a, b) || (a.staff_name ?? "").localeCompare(b.staff_name ?? ""));
}

/** Groupes de la liste d'« Aujourd'hui », chacun dans l'ordre de `todayRows`. */
export interface GroupesDuJour {
  /** Soins en cours et clientes attendues (règle `awaitingArrival`, « En retard »). */
  aTraiter: Appointment[];
  /** Soins terminés sans facture (sous-projet 5 § 4.1). */
  aEncaisser: Appointment[];
  /** Réservés ou confirmés dont l'heure n'est pas venue. */
  aVenir: Appointment[];
  /** Terminés et encaissés, et absentes. */
  termines: Appointment[];
}

/**
 * Liste d'« Aujourd'hui » en groupes (décision du 29/09) : ce qu'il faut
 * traiter d'abord, puis les soins terminés à encaisser (sous-projet 5), les
 * rendez-vous à venir, les terminés en bas.
 */
export function todayGroups(appointments: Appointment[], today: string, now: string): GroupesDuJour {
  const groups: GroupesDuJour = { aTraiter: [], aEncaisser: [], aVenir: [], termines: [] };
  for (const a of todayRows(appointments, today)) {
    if (a.status === "completed" && !a.paid) groups.aEncaisser.push(a);
    else if (a.status === "completed" || a.status === "no_show") groups.termines.push(a);
    else if (a.status === "in_progress" || awaitingArrival(a, today, now)) groups.aTraiter.push(a);
    else groups.aVenir.push(a);
  }
  return groups;
}

/** Une note montrée avec le prochain rendez-vous de « Ma journée ». */
export interface NoteDuJour {
  source: "rendez-vous" | "reservation" | "cliente";
  text: string;
  /** Date d'écriture (notes du rendez-vous seulement). */
  at: string | null;
}

/**
 * Notes à lire avant le prochain soin (§ 5.1) : celles du rendez-vous, les
 * plus récentes d'abord, puis la note de réservation, puis la note sur la
 * cliente ; les notes vides sont écartées.
 */
export function prochainesNotes({ notes, bookingNote, clientNotes }: {
  notes: { id: number; content: string; created_at: string }[] | null | undefined;
  bookingNote: string | null | undefined;
  clientNotes: string | null | undefined;
}): NoteDuJour[] {
  const list: NoteDuJour[] = newestFirst(notes)
    .filter((n) => n.content.trim() !== "")
    .map((n) => ({ source: "rendez-vous", text: n.content.trim(), at: n.created_at }));
  if (bookingNote?.trim()) list.push({ source: "reservation", text: bookingNote.trim(), at: null });
  if (clientNotes?.trim()) list.push({ source: "cliente", text: clientNotes.trim(), at: null });
  return list;
}
