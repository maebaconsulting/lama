/**
 * Remise à zéro de chaque nuit de la démonstration publique (démo publique
 * DP-05). À 3 h, heure de Douala, le serveur dépose la demande de remise de la
 * base de formation, annonce la maintenance à tous les écrans et s'arrête ;
 * Docker le relance (`restart: always`) et la remise s'applique au démarrage,
 * avec ses garanties (base neuve bâtie à côté, panne sans perte).
 */
import { setMaintenance } from "../auth/middleware.ts";
import { langFromEnv, message } from "../messages.ts";
import { publishMaintenance } from "../realtime.ts";
import { demanderRemiseAZero } from "./remise-a-zero.ts";

/** Heure de la remise, à Douala. */
export const HEURE_REMISE = 3;
/** Douala : UTC+1 toute l'année, sans heure d'été. */
const DECALAGE_DOUALA_MS = 3_600_000;
const JOUR_MS = 86_400_000;

/** Prochain 3 h de Douala strictement après `now` (millisecondes depuis 1970, UTC). */
export function prochaineRemise(now: number): number {
  const local = now + DECALAGE_DOUALA_MS;
  let cible = Math.floor(local / JOUR_MS) * JOUR_MS + HEURE_REMISE * 3_600_000;
  if (cible <= local) cible += JOUR_MS;
  return cible - DECALAGE_DOUALA_MS;
}

/** Minuterie remplaçable dans les essais : pose `fn` dans `ms` millisecondes, rend de quoi l'annuler. */
export interface Minuterie {
  poser(fn: () => void, ms: number): () => void;
}

/** Minuterie du processus, qui ne le retient pas en vie à elle seule. */
const MINUTERIE: Minuterie = {
  poser(fn, ms) {
    const minuteur = setTimeout(fn, ms);
    minuteur.unref();
    return () => clearTimeout(minuteur);
  },
};

/**
 * Programme la prochaine remise de la nuit ; rend son échéance et de quoi l'annuler (arrêt du serveur).
 * Au déclenchement, l'échéance est revérifiée : une minuterie partie en avance est reposée pour le reste,
 * jamais de remise avant 3 h.
 */
export function programmerRemiseNocturne(o: { now: () => number; remettre: () => void; minuterie?: Minuterie }): { echeance: number; arreter: () => void } {
  const minuterie = o.minuterie ?? MINUTERIE;
  const echeance = prochaineRemise(o.now());
  let annuler = () => {};
  const declencher = () => {
    const reste = echeance - o.now();
    if (reste > 0) {
      annuler = minuterie.poser(declencher, reste);
      return;
    }
    o.remettre();
  };
  annuler = minuterie.poser(declencher, echeance - o.now());
  return { echeance, arreter: () => annuler() };
}

/**
 * Le geste de 3 h : demande de remise déposée dans `dataDir`, maintenance annoncée,
 * puis arrêt demandé (`requestRestart` ferme la base et sort ; Docker relance).
 * Une demande impossible à déposer est écrite au journal : ni maintenance ni arrêt,
 * la démonstration continue telle quelle.
 */
export function remettreCetteNuit(dataDir: string, requestRestart: () => void): void {
  const lang = langFromEnv(process.env);
  try {
    demanderRemiseAZero(dataDir);
  } catch (error) {
    console.error(message(lang, "demo.remise_nocturne_echec", { detail: error instanceof Error ? error.message : String(error) }));
    return;
  }
  console.log(message(lang, "demo.remise_nocturne"));
  setMaintenance(true);
  publishMaintenance();
  requestRestart();
}
