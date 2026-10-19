import { Disponibilites, Offre } from "../noyau/contrat.ts";
import type { Contexte, DemandeActive } from "../noyau/creneaux.ts";
import { ajouterJours } from "../noyau/temps.ts";
import { dispoEssai, MAINTENANT, offreEssai } from "./donnees.ts";

/**
 * Salon chargé (mesure du temps de calcul de `resume`, derrière GET /jours) : 8 praticiennes qui pratiquent
 * toutes `s60`, 30 jours de plages de 08:00 à 18:00, et 60 demandes « sans préférence » en attente (deux par jour).
 */
export function contexteCharge(): Contexte {
  const base = offreEssai();
  const ids = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  const offre = Offre.parse({ ...base, praticiennes: ids.map((id, i) => ({ id, prenom: `Praticienne ${i + 1}`, prestations: i === 0 ? ["s60", "s30"] : ["s60"] })) });
  const plages: Record<string, Record<string, [string, string][]>> = {};
  const du = "2026-10-20";
  const au = ajouterJours(du, 29);
  for (const id of ids) {
    plages[id] = {};
    for (let d = du; d <= au; d = ajouterJours(d, 1)) plages[id][d] = [["08:00", "18:00"]];
  }
  const dispo: Disponibilites = dispoEssai(plages, { au });
  const demandes: DemandeActive[] = [];
  for (let i = 0; i < 60; i++) {
    const debut = i % 2 === 0 ? 10 * 60 : 14 * 60 + 30;
    demandes.push({
      id: `d_${i}`, type: "creneau", prestation: "s60", praticienne: null, date: ajouterJours(du, Math.floor(i / 2)),
      debut, fin: debut + 60, accusee_le: null, decision: null, decidee_le: null,
    });
  }
  return { offre, dispo, demandes, maintenant: MAINTENANT };
}
