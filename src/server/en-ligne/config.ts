import { getSetting } from "../settings.ts";
import { SEMAINE_DEFAUT, type Semaine } from "../../shared/horaires.ts";
import { adresseSansBarre, type ThemeEnLigne } from "../../shared/en-ligne.ts";

/** Fuseau publié avec l'offre : lama compte toutes ses heures à Douala (UTC+1 toute l'année). */
export const FUSEAU = "Africa/Douala";

/** Réglages lus avant un tour de la boucle ou une publication (lecture asynchrone, clé secrète comprise). */
export type ConfigEnLigne = {
  active: boolean;
  adresse: string;
  salon: string;
  /** `null` : pas de clé réglée, ou clé maîtresse non chargée. */
  cle: string | null;
  horizonJours: number;
  delaiHeures: number;
  theme: ThemeEnLigne | null;
  texteDonnees: { fr: string; en: string };
  institut: { nom: string; telephone: string; indicatif: string; horaires: Semaine };
};

export async function lireConfig(): Promise<ConfigEnLigne> {
  let cle: string | null = null;
  try {
    cle = await getSetting<string | null>("en_ligne.cle");
  } catch {
    cle = null;
  }
  return {
    active: (await getSetting<boolean>("en_ligne.active")) === true,
    adresse: adresseSansBarre(await getSetting<string>("en_ligne.adresse")),
    salon: await getSetting<string>("en_ligne.salon"),
    cle,
    horizonJours: await getSetting<number>("en_ligne.horizon_jours"),
    delaiHeures: await getSetting<number>("en_ligne.delai_minimal_heures"),
    theme: await getSetting<ThemeEnLigne | null>("en_ligne.theme"),
    texteDonnees: { fr: await getSetting<string>("en_ligne.texte_donnees.fr"), en: await getSetting<string>("en_ligne.texte_donnees.en") },
    institut: {
      nom: (await getSetting<string>("institut.nom")).trim(),
      telephone: await getSetting<string>("institut.telephone"),
      indicatif: await getSetting<string>("whatsapp.indicatif"),
      horaires: (await getSetting<Semaine | null>("institut.horaires")) ?? SEMAINE_DEFAUT,
    },
  };
}

/** Liaison réglée : adresse du relais, identifiant du salon et clé partagée. */
export function liaisonReglee(c: Pick<ConfigEnLigne, "adresse" | "salon" | "cle">): boolean {
  return c.adresse !== "" && c.salon !== "" && c.cle !== null;
}
