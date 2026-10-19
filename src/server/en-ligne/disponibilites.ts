import type { Database } from "../storage.ts";
import { doualaDay } from "../../shared/caisse.ts";
import { enHeure, type Intervalle } from "../../shared/horaires.ts";
import { busyOn } from "../transferts.ts";
import type { ConfigEnLigne } from "./config.ts";
import { catalogueEnLigne, idPraticienne } from "./offre.ts";
import { plagesLibres } from "./plages.ts";

/**
 * Plages libres publiées (contrat v1, `PUT /disponibilites`, spec § 2 et § 4.2) : pour chaque praticienne
 * ouverte en ligne et chaque jour de l'horizon, ses heures de travail privées des rendez-vous, des créneaux
 * bloqués et des demandes à confirmer (`busyOn`). Sans version ni date de génération : la boucle les ajoute.
 */
export const PAS_MINUTES = 15;
/** Au plus 10 plages par jour et par praticienne (contrat) : au-delà, toute la publication serait refusée. */
export const PLAGES_PAR_JOUR = 10;

export type CorpsPlages = { du: string; au: string; pas: number; delai_minimal: number; plages: Record<string, Record<string, [string, string][]>> };

/** `date` décalée de `n` jours, calculée à midi UTC (aucun effet de fuseau). */
export function ajouterJours(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Plages d'un jour gardées : assez longues pour la plus courte prestation de la praticienne, les dix premières. */
export function plagesPubliables(libres: Intervalle[], dureeMin: number): [string, string][] {
  return libres.filter((i) => i.end - i.start >= dureeMin).slice(0, PLAGES_PAR_JOUR).map((i): [string, string] => [enHeure(i.start), enHeure(i.end)]);
}

export function construirePlages(db: Database, cfg: ConfigEnLigne, maintenant: number): CorpsPlages {
  const c = catalogueEnLigne(db);
  const duree = new Map(c.prestations.map((s) => [s.id, s.duration]));
  const du = doualaDay(maintenant);
  const au = ajouterJours(du, Math.max(1, cfg.horizonJours) - 1);
  const plages: CorpsPlages["plages"] = {};
  for (const p of c.praticiennes) {
    const durees = p.services.map((id) => duree.get(id)).filter((d): d is number => d !== undefined);
    if (!durees.length) continue;
    const dureeMin = Math.min(...durees);
    const jours: Record<string, [string, string][]> = {};
    for (let date = du; date <= au; date = ajouterJours(date, 1)) {
      const gardees = plagesPubliables(plagesLibres(p.horaires, cfg.institut.horaires, busyOn(db, p.id, date), date), dureeMin);
      if (gardees.length) jours[date] = gardees;
    }
    if (Object.keys(jours).length) plages[idPraticienne(p.id)] = jours;
  }
  return { du, au, pas: PAS_MINUTES, delai_minimal: cfg.delaiHeures * 60, plages };
}
