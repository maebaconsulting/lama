/**
 * Rubrique « Mise à jour » des Réglages (spec du 21/10/2026, M-13 à M-16), règles pures : le
 * bouton, la pastille du menu, l'opération en cours ou terminée. Distinct de `mise-a-jour.ts`
 * (nouvelle version de l'écran par le service worker, bandeau « Recharger »).
 */
import type { Key } from "../i18n/translate.ts";

export type EtapeOperation = "telechargement" | "verification" | "sauvegarde" | "installation" | "controle" | "termine";

/** Opération lue dans etat.json par le serveur ; `motif_texte` traduit dans la langue de l'écran. */
export interface OperationMiseAJour {
  operation: string;
  version_cible: string | null;
  etape: EtapeOperation;
  resultat: "reussie" | "echec" | null;
  motif: string | null;
  motif_texte: string | null;
  debut: number;
  fin: number | null;
  version_precedente: string | null;
}

/** Réponse de GET /api/mise-a-jour ; les quatre derniers champs à l'administrateur seulement. */
export interface EtatMiseAJour {
  installee: { version: string; developpement: boolean; installee_le: number | null };
  disponible: { version: string; publiee_le: number | null; note: string } | null;
  verifie_le: number | null;
  erreur: string | null;
  aucune_publiee: boolean;
  mecanisme?: boolean;
  mode?: "manuel" | "automatique";
  en_cours?: boolean;
  operation?: OperationMiseAJour | null;
}

export const ETAPE_KEYS: Record<EtapeOperation, Key> = {
  telechargement: "mise_a_jour.etape.telechargement",
  verification: "mise_a_jour.etape.verification",
  sauvegarde: "mise_a_jour.etape.sauvegarde",
  installation: "mise_a_jour.etape.installation",
  controle: "mise_a_jour.etape.controle",
  termine: "mise_a_jour.etape.termine",
};

/**
 * Ligne « Version disponible » sans version annoncée : « lama est à jour » seulement après une
 * vérification réussie d'une version publiée ; « aucune version publiée » si le dépôt n'en a pas ;
 * rien (tiret) avant toute vérification, après un échec ou pour une version de développement.
 */
export function texteSansVersion(e: EtatMiseAJour): Key | null {
  if (e.installee.developpement || e.verifie_le === null || e.erreur !== null) return null;
  return e.aucune_publiee ? "mise_a_jour.aucune_publiee" : "mise_a_jour.a_jour";
}

/** Bouton « Mettre à jour vers X.Y.Z » : mécanisme posé, version publiée installée, version plus récente annoncée, rien en cours. */
export function peutMettreAJour(e: EtatMiseAJour): boolean {
  return e.mecanisme === true && !e.installee.developpement && e.disponible !== null && e.en_cours !== true;
}

/** Pastille sur Réglages (M-15) : administrateur, mode manuel, et le bouton serait proposé. */
export function pastilleMiseAJour(e: EtatMiseAJour | null): boolean {
  return e !== null && e.mode === "manuel" && peutMettreAJour(e);
}

/** Étape non terminée et sans résultat ni fin : seule combinaison tenue pour « en cours » (champs absents = null). */
function estEnCours(o: OperationMiseAJour): boolean {
  return o.fin == null && o.resultat == null && o.etape !== "termine";
}

/** Opération en cours : celle de etat.json si elle l'est vraiment ; une demande pas encore prise : « préparation ». */
export function operationEnCours(e: EtatMiseAJour): OperationMiseAJour | "preparation" | null {
  if (e.en_cours !== true) return null;
  return e.operation && estEnCours(e.operation) ? e.operation : "preparation";
}

/** Dernière opération terminée (ligne « Dernière opération ») : fin et résultat présents, sinon rien. */
export function derniereOperation(e: EtatMiseAJour): OperationMiseAJour | null {
  return e.operation && e.operation.fin != null && e.operation.resultat != null ? e.operation : null;
}

/** Clé du texte d'une étape ; une étape inconnue retombe sur « préparation » (défense en profondeur). */
export function etapeKey(etape: string): Key {
  return Object.hasOwn(ETAPE_KEYS, etape) ? ETAPE_KEYS[etape as EtapeOperation] : "mise_a_jour.preparation";
}
