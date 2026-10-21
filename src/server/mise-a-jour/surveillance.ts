import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setMaintenance } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { publishMaintenance } from "../realtime.ts";
import { getSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { ecrireBase, lireBase } from "./base.ts";
import { ecrireMode, lireEtat, mecanismePose, type EtatOperation } from "./echange.ts";
import type { VersionInstallee } from "./version.ts";

/** Lecture de etat.json (quelques centaines d'octets) toutes les 2 secondes. */
export const INTERVALLE_MS = 2_000;
/** Maintenance levée d'office après 30 minutes sans fin d'opération (service root arrêté net). */
export const MAINTENANCE_MAX_MS = 30 * 60_000;

export type DependancesSurveillance = {
  dossier: string;
  installee: VersionInstallee;
  /** Démarrage de ce processus (ms) : seule une version démarrée avant l'opération se met en maintenance. */
  demarreLe: number;
  storage: StorageBinding;
  maintenant: () => number;
  /** Signal temps réel aux écrans (rubrique et pastille relues). */
  signaler: () => void;
};

/** Recopie le mode réglé dans le fichier lu par le service root, s'il en diffère (mécanisme posé après le choix du mode). */
async function recopierMode(dossier: string): Promise<void> {
  if (!mecanismePose(dossier)) return;
  const voulu = (await getSetting<string>("mise_a_jour.mode")) === "automatique" ? "automatique" : "manuel";
  let present = "";
  try {
    present = readFileSync(join(dossier, "mode"), "utf8").trim();
  } catch {
    present = "";
  }
  if (present !== voulu) ecrireMode(dossier, voulu);
}

/** Inscrit une opération terminée au journal, une seule fois (identifiant noté en base, gardé au redémarrage). */
async function journaliser(o: DependancesSurveillance, etat: EtatOperation): Promise<void> {
  const nouvelle = o.storage.transaction!((db) => {
    if (lireBase(db).operation_journalisee === etat.operation) return false;
    ecrireBase(db, { operation_journalisee: etat.operation });
    return true;
  });
  if (!nouvelle) return;
  const cible = etat.version_cible ?? "?";
  const quand = etat.fin ?? o.maintenant();
  if (etat.resultat === "reussie") {
    await logAudit({ accountId: null, action: "mise_a_jour.reussie", target: `${etat.version_precedente ?? "?"} → ${cible}`, now: quand });
  } else {
    await logAudit({ accountId: null, action: "mise_a_jour.echec", target: `${cible} (${etat.motif ?? "installation"})`, now: quand });
  }
}

/**
 * Suivi de l'opération menée par le service root (spec du 21/10/2026, M-13 à M-15) : mode recopié
 * au premier tour, chaque changement de etat.json signalé aux écrans, opération terminée inscrite
 * au journal (au plus tard au démarrage suivant). L'ancienne version (même numéro que
 * `version_precedente`, démarrée avant l'opération) se met en maintenance dès l'installation de la
 * nouvelle et le diffuse à tous les écrans, jusqu'à la fin de l'opération ou 30 minutes au plus ;
 * jamais une version démarrée après le début (nouvelle version, ou version rendue par le retour
 * arrière), que le contrôle de mettre-a-jour.sh doit pouvoir joindre.
 */
export function creerSurveillance(o: DependancesSurveillance) {
  let premierTour = true;
  let premierVu = true;
  let dernier = "";
  let posee: { operation: string; le: number } | null = null;
  const dejaPosees = new Set<string>();
  return {
    async tour(): Promise<void> {
      if (premierTour) {
        await recopierMode(o.dossier);
        premierTour = false;
      }
      const etat = lireEtat(o.dossier);
      if (premierVu) {
        premierVu = false;
        // Processus démarré en pleine installation ou contrôle : jamais l'ancienne version (indépendant de l'horloge,
        // que l'installation peut corriger). Si l'ancienne a été relancée par systemd, elle n'a pas de maintenance : côté sûr.
        if (etat !== null && etat.fin === null && (etat.etape === "installation" || etat.etape === "controle")) dejaPosees.add(etat.operation);
      }
      const empreinte = JSON.stringify(etat);
      if (empreinte !== dernier) {
        dernier = empreinte;
        o.signaler();
      }
      const maintenant = o.maintenant();
      const installationEnCours = etat !== null && etat.fin === null && (etat.etape === "installation" || etat.etape === "controle")
        && etat.version_precedente === o.installee.numero && o.demarreLe < etat.debut;
      if (installationEnCours && posee === null && !dejaPosees.has(etat!.operation)) {
        posee = { operation: etat!.operation, le: maintenant };
        dejaPosees.add(etat!.operation);
        setMaintenance(true);
        publishMaintenance();
      } else if (posee !== null && (!installationEnCours || maintenant - posee.le > MAINTENANCE_MAX_MS)) {
        posee = null;
        setMaintenance(false);
      }
      // Après la décision de maintenance : une panne du journal ne doit jamais la retenir.
      if (etat !== null && etat.fin !== null) await journaliser(o, etat);
    },
  };
}

/** Lance la surveillance toutes les `intervalleMs` ; rend l'arrêt. */
export function startSurveillanceMiseAJour(o: DependancesSurveillance & { intervalleMs?: number }): () => void {
  const surveillance = creerSurveillance(o);
  let occupe = false;
  const lancer = async () => {
    if (occupe) return;
    occupe = true;
    try {
      await surveillance.tour();
    } catch (e) {
      // Base fermée pendant l'arrêt, ou panne inattendue : jamais un rejet non capturé.
      console.error("Mise à jour par le réseau\u00a0:", e instanceof Error ? e.message : e);
    } finally {
      occupe = false;
    }
  };
  const horloge = setInterval(() => void lancer(), o.intervalleMs ?? INTERVALLE_MS);
  horloge.unref?.();
  void lancer();
  return () => clearInterval(horloge);
}
