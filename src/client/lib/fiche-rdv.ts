/**
 * Règles de la fiche d'un rendez-vous (sous-projet 4 § 4.3), sans dépendance
 * au navigateur pour être testées sous Node : geste suivant du statut, autres
 * statuts proposés, confirmation, lien d'appel et ordre des notes.
 */
import type { Key } from "../i18n/translate.ts";
import type { AppointmentStatus } from "../types.ts";
import { STATUSES } from "./statuses.ts";

/** Geste mis en avant : libellé du gros bouton et statut obtenu. */
export interface StatusStep {
  to: AppointmentStatus;
  labelKey: Key;
}

const NEXT: Partial<Record<string, StatusStep>> = {
  booked: { to: "confirmed", labelKey: "rdv.geste.confirmer" },
  confirmed: { to: "in_progress", labelKey: "rdv.geste.arrivee" },
  in_progress: { to: "completed", labelKey: "rdv.geste.terminer" },
};

/**
 * Geste suivant selon le tableau du § 4.3 : Réservé → Confirmer, Confirmé →
 * Arrivée, En cours → Terminé ; aucun pour Terminé, Annulé, Absente ou un
 * statut inconnu.
 */
export function nextStep(status: string): StatusStep | null {
  return NEXT[status] ?? null;
}

/**
 * Statuts proposés sous « Autre statut » : tous les statuts permis, sauf le
 * statut actuel et celui du geste mis en avant (déjà sur le gros bouton).
 */
export function otherStatuses(status: string): AppointmentStatus[] {
  const next = nextStep(status)?.to;
  return STATUSES.filter((s) => s !== status && s !== next);
}

/** Annulé et Absente demandent une confirmation avant d'être appliqués. */
export function needsConfirmation(status: string): boolean {
  return status === "cancelled" || status === "no_show";
}

/**
 * Lien `tel:` vers le téléphone de la cliente : chiffres et « + » initial
 * seulement ; `null` sans numéro utilisable (le bouton Appeler n'est pas montré).
 */
export function telHref(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${raw.startsWith("+") ? "+" : ""}${digits}`;
}

/** Notes les plus récentes d'abord (date d'écriture, puis numéro à date égale), sans modifier la liste reçue. */
export function newestFirst<T extends { id: number; created_at: string }>(notes: T[] | null | undefined): T[] {
  return [...(notes ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
}

/** Champs modifiés par « Déplacer ». */
export interface ReschedulePatch {
  scheduled_date?: string;
  start_time?: string;
  staff_id?: number | null;
}

/**
 * Déplacement (date, heure, praticienne) : seuls les champs changés sont
 * envoyés ; `null` si rien n'a changé (bouton « Enregistrer » inactif).
 */
export function reschedulePatch(
  current: { scheduled_date: string; start_time: string; staff_id: number | null },
  wanted: { date: string; time: string; staffId: number | null },
): ReschedulePatch | null {
  const patch: ReschedulePatch = {};
  if (wanted.date !== current.scheduled_date) patch.scheduled_date = wanted.date;
  if (wanted.time !== current.start_time) patch.start_time = wanted.time;
  if (wanted.staffId !== (current.staff_id ?? null)) patch.staff_id = wanted.staffId;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Case « Prévenir la cliente » de « Déplacer » (spec du 04/10/2026,
 * décision 5) : proposée, cochée par défaut, quand le rendez-vous va à une
 * autre praticienne ; jamais vers « Non attribué » (décision 14).
 */
export function offersTransferNotice(currentStaffId: number | null, wantedStaffId: number | null): boolean {
  return wantedStaffId !== null && wantedStaffId !== currentStaffId;
}

/** Brouillon de note d'un rendez-vous (chaîne vide s'il n'y en a pas). */
export function draftFor(drafts: Map<number, string>, id: number): string {
  return drafts.get(id) ?? "";
}

/**
 * Garde en mémoire le brouillon de note d'un rendez-vous, tel quel ; un texte
 * vide l'oublie (après un envoi réussi). Mémoire seulement : jamais de stockage
 * dans le navigateur.
 */
export function keepDraft(drafts: Map<number, string>, id: number, text: string): void {
  if (text === "") drafts.delete(id);
  else drafts.set(id, text);
}

/**
 * Cliente attendue au comptoir : rendez-vous réservé ou confirmé du jour, dont
 * l'heure de début (heure de Douala, `now` en HH:MM) est passée. Règle unique
 * pour le repère « En retard » de l'agenda et les arrivées en attente de
 * l'écran « Aujourd'hui » (vague 3) : les deux ne peuvent pas se contredire.
 */
export function awaitingArrival(apt: { status: string; scheduled_date: string; start_time: string }, today: string, now: string): boolean {
  if (apt.status !== "booked" && apt.status !== "confirmed") return false;
  if (apt.scheduled_date !== today || !/^\d{2}:\d{2}$/.test(now)) return false;
  return apt.start_time.slice(0, 5) <= now;
}
