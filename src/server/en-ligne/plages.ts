import { dateValide, heuresTravail, soustraire, type Intervalle, type Semaine } from "../../shared/horaires.ts";
import { toMinutes, type Busy } from "../scheduling.ts";

/**
 * Plages libres d'une praticienne un jour donné (réservation en ligne, spec § 4.2) :
 * ses heures de travail (semaine type tronquée aux horaires de l'institut, `heuresTravail`)
 * privées de ses occupations (rendez-vous non annulés, créneaux bloqués et demandes à
 * confirmer, toutes lues par `busyOn`). Une date qui n'existe pas n'a aucune plage.
 * Module pur : ni base ni réseau.
 */
export function plagesLibres(semaine: Semaine | null, institut: Semaine, occupations: Busy[], date: string): Intervalle[] {
  if (!dateValide(date)) return [];
  const prises = occupations
    .map((o) => ({ start: toMinutes(o.start_time.slice(0, 5)), end: toMinutes(o.end_time.slice(0, 5)) }))
    .filter((i): i is Intervalle => i.start !== null && i.end !== null && i.end > i.start);
  return soustraire(heuresTravail(semaine, institut, date), prises);
}
