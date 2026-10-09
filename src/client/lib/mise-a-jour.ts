/**
 * Service worker vu de l'écran (PWA, P-03, P-05) : enregistrement en contexte
 * sécurisé hors développement, nouvelle version en attente signalée au
 * bandeau « Nouvelle version disponible : Recharger », activation sur appui
 * puis un seul rechargement, et rechargement d'un écran que le serveur
 * n'accepte plus. Le navigateur est passé en paramètre : testé sous Node.
 */
import { DEMANDE_ACTIVATION } from "../../sw/regles.ts";
import { readReloadMark, writeReloadMark, type DeviceStore } from "../i18n/device-lang.ts";

/** Service worker tel que l'écran le voit (`ServiceWorker`). */
export interface TravailleurSW {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", ecouteur: () => void): void;
}
/** Inscription du service worker (`ServiceWorkerRegistration`). */
export interface InscriptionSW {
  waiting: TravailleurSW | null;
  installing: TravailleurSW | null;
  update(): Promise<unknown>;
  addEventListener(type: "updatefound", ecouteur: () => void): void;
}
/** `navigator.serviceWorker`, absent hors contexte sécurisé. */
export interface ConteneurSW {
  controller: unknown;
  register(url: string, options: { scope: string }): Promise<InscriptionSW>;
  addEventListener(type: "controllerchange", ecouteur: () => void): void;
}

/** Enregistré seulement en contexte sécurisé (https ou localhost), hors serveur de développement de Vite, si le navigateur sait faire. */
export function doitEnregistrer(o: { securise: boolean; dev: boolean; disponible: boolean }): boolean {
  return o.securise && !o.dev && o.disponible;
}

/**
 * Nouveau service worker aux commandes. Demandé par l'appui sur « Recharger » :
 * un seul rechargement (jamais de boucle). Non demandé (activé par un autre
 * onglet) alors qu'une version tournait déjà : proposer de recharger. Première
 * installation (aucun contrôleur avant) : rien.
 */
export function surChangementDeControleur(o: { demande: boolean; dejaRecharge: boolean; avaitControleur: boolean }): "recharger" | "proposer" | "rien" {
  if (o.demande) return o.dejaRecharge ? "rien" : "recharger";
  return o.avaitControleur ? "proposer" : "rien";
}

/** Délai sous lequel un écran refusé ne recharge pas une seconde fois : le serveur le refuse encore, l'erreur s'affiche. */
export const DELAI_RECHARGEMENT_MS = 60_000;

export function doitRechargerEcranPerime(dernier: number | null, maintenant: number): boolean {
  return dernier === null || maintenant - dernier >= DELAI_RECHARGEMENT_MS || maintenant < dernier;
}

type Etat = "aucune" | "en-attente" | "active";
let etat: Etat = "aucune";
let enAttente: TravailleurSW | null = null;
let demande = false;
let dejaRecharge = false;
let rechargerPage: () => void = () => globalThis.location?.reload();
const abonnes = new Set<(visible: boolean) => void>();

function poser(suivant: Etat, travailleur: TravailleurSW | null): void {
  etat = suivant;
  enAttente = travailleur;
  for (const abonne of [...abonnes]) abonne(etat !== "aucune");
}

/** Vrai quand une nouvelle version attend l'appui sur « Recharger ». */
export function nouvelleVersionVisible(): boolean {
  return etat !== "aucune";
}

/** Abonne le bandeau ; renvoie le désabonnement. */
export function onNouvelleVersion(ecouteur: (visible: boolean) => void): () => void {
  abonnes.add(ecouteur);
  return () => { abonnes.delete(ecouteur); };
}

/** Appui sur « Recharger » : demande l'activation de la version en attente, qui rechargera l'écran ; sinon recharge tout de suite. */
export function activerNouvelleVersion(): void {
  if (etat === "en-attente" && enAttente) {
    demande = true;
    enAttente.postMessage(DEMANDE_ACTIVATION);
    return;
  }
  rechargerPage();
}

/** Enregistre `/sw.js` (portée « / ») et suit ses versions ; `null` si l'enregistrement n'a pas lieu. */
export async function enregistrerServiceWorker(o: { conteneur: ConteneurSW | undefined; securise: boolean; dev: boolean; recharger: () => void }): Promise<InscriptionSW | null> {
  const conteneur = o.conteneur;
  if (!conteneur || !doitEnregistrer({ securise: o.securise, dev: o.dev, disponible: true })) return null;
  rechargerPage = o.recharger;
  let avaitControleur = Boolean(conteneur.controller);
  conteneur.addEventListener("controllerchange", () => {
    const suite = surChangementDeControleur({ demande, dejaRecharge, avaitControleur });
    avaitControleur = true;
    if (suite === "recharger") {
      dejaRecharge = true;
      o.recharger();
    } else if (suite === "proposer") {
      poser("active", null);
    }
  });
  const inscription = await conteneur.register("/sw.js", { scope: "/" });
  // Version téléchargée lors d'une visite précédente et toujours en attente.
  if (inscription.waiting && conteneur.controller) poser("en-attente", inscription.waiting);
  inscription.addEventListener("updatefound", () => {
    const nouveau = inscription.installing;
    if (!nouveau) return;
    nouveau.addEventListener("statechange", () => {
      // Sans contrôleur, c'est la première installation : rien à proposer.
      if (nouveau.state === "installed" && conteneur.controller) poser("en-attente", nouveau);
    });
  });
  return inscription;
}

/**
 * Écran refusé par le serveur (`ecran_perime`) : recharge pour prendre la
 * nouvelle version, au plus une fois par minute (marque retenue par
 * l'appareil). Sans stockage, pas de rechargement : le message du serveur
 * s'affiche et dit de recharger.
 */
export function rechargerEcranPerime(maintenant: number = Date.now(), store?: DeviceStore | null): boolean {
  if (!doitRechargerEcranPerime(readReloadMark(store), maintenant)) return false;
  if (!writeReloadMark(maintenant, store)) return false;
  activerNouvelleVersion();
  return true;
}

/** Remet l'état à zéro entre deux essais. */
export function oublierPourEssai(): void {
  etat = "aucune";
  enAttente = null;
  demande = false;
  dejaRecharge = false;
  rechargerPage = () => globalThis.location?.reload();
  abonnes.clear();
}
