/** Statuts d'un rendez-vous (valeurs stockées, inchangées) et leur libellé dans chaque langue. */
import { translate, type Key, type Lang } from "../i18n/translate.ts";
import type { AppointmentStatus } from "../types.ts";

export const STATUSES: AppointmentStatus[] = ["booked", "confirmed", "in_progress", "completed", "cancelled", "no_show"];

const STATUS_KEYS: Record<AppointmentStatus, Key> = {
  booked: "statut.booked",
  confirmed: "statut.confirmed",
  in_progress: "statut.in_progress",
  completed: "statut.completed",
  cancelled: "statut.cancelled",
  no_show: "statut.no_show",
};

/** Libellé d'un statut ; une valeur inconnue est rendue telle quelle. */
export function statusLabel(lang: Lang, status: string): string {
  const key = STATUS_KEYS[status as AppointmentStatus];
  return key ? translate(lang, key) : status;
}
