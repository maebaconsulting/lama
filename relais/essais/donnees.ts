import { Disponibilites, Offre } from "../noyau/contrat.ts";

/** Données d'essai partagées par les tests du relais (tâches 2 à 8 et 12) : un institut à Douala, deux prestations, deux praticiennes. */
export const FUSEAU = "Africa/Douala";
/** Mardi 20 octobre 2026, 08:00 à Douala (07:00 UTC). */
export const MAINTENANT = Date.UTC(2026, 9, 20, 7, 0);

const texte = (fr: string, en = fr) => ({ fr, en });

/** `s60` (60 min) pratiquée par p1 et p2 ; `s30` (30 min) pratiquée par p1 seulement. */
export function offreEssai(version = 1): Offre {
  return Offre.parse({
    version,
    institut: {
      nom: "Institut Éclat", fuseau: FUSEAU, telephone: "+237600000000",
      devise: { code: "XAF", decimales: 0, symbole: "F", position: "apres" },
      langues: ["fr", "en"], texte_donnees: texte("Vos données servent à traiter votre demande.", "Your data is used to handle your request."),
    },
    prestations: [
      { id: "s60", nom: texte("Soin visage", "Facial"), categorie: texte("Visage", "Face"), description: texte(""), duree: 60, prix: 25000 },
      { id: "s30", nom: texte("Pose de vernis", "Nail polish"), categorie: texte("Mains", "Hands"), description: texte(""), duree: 30, prix: 10000 },
    ],
    praticiennes: [
      { id: "p1", prenom: "Awa", prestations: ["s60", "s30"] },
      { id: "p2", prenom: "Bella", prestations: ["s60"] },
    ],
  });
}

/** Plages publiées il y a une minute, du 20 au 31 octobre, pas de 15 min, délai minimal de 2 h. */
export function dispoEssai(plages: Record<string, Record<string, [string, string][]>>, extra: Partial<Disponibilites> = {}): Disponibilites {
  return Disponibilites.parse({ version: 1, genere_le: MAINTENANT - 60_000, du: "2026-10-20", au: "2026-10-31", pas: 15, delai_minimal: 120, plages, ...extra });
}
