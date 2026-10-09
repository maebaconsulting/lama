import { api } from "../api";
import { DEFAULT_ABSENCE_DAYS } from "../lib/crm";
import { absenceThreshold } from "../lib/relances";
import { useLoad } from "./use-load";

/**
 * Seuil d'absence (`relances.absence_jours`) pour la ligne d'état de la fiche ;
 * relu à chaque changement de réglage. `null` tant qu'il n'est pas connu (la
 * fiche n'affiche alors aucune mise en avant), 60 jours si la lecture échoue.
 */
export function useAbsenceDays(): number | null {
  const { data, error } = useLoad(() => api<{ absence_days: number }>("GET", "/api/relances/seuil"), ["settings"]);
  if (data) return absenceThreshold(data);
  return error ? DEFAULT_ABSENCE_DAYS : null;
}
