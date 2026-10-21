/**
 * Dossier d'échange avec le service root de mise à jour (spec du 21/10/2026, M-8) :
 * /var/lib/lama/mise-a-jour, au compte lama. lama y écrit sa demande (`demande.json`) et le mode
 * (`mode`), et y lit l'état de l'opération (`etat.json`) écrit par le service root. Rien de ce
 * qui est lu n'est cru sur parole : fichier ordinaire seulement, taille plafonnée, format contrôlé.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION_DEVELOPPEMENT, VERSION_PUBLIEE } from "./version.ts";

export const ETAPES = ["telechargement", "verification", "sauvegarde", "installation", "controle", "termine"] as const;
export const MOTIFS = ["demande_invalide", "version_non_recente", "telechargement", "signature", "empreinte", "version_incoherente", "sauvegarde", "installation", "demarrage"] as const;
export type Etape = (typeof ETAPES)[number];
export type Motif = (typeof MOTIFS)[number];

/** État de la dernière opération (etat.json). Dates en millisecondes ; `fin` vaut null tant qu'elle dure. */
export type EtatOperation = {
  operation: string;
  version_cible: string | null;
  etape: Etape;
  resultat: "reussie" | "echec" | null;
  motif: Motif | null;
  debut: number;
  fin: number | null;
  version_precedente: string | null;
};

/** etat.json fait une ligne d'environ 250 octets ; au-delà de 4 Kio, il n'est pas lu. */
const TAILLE_MAX_ETAT = 4096;

/** Contenu d'un petit fichier ordinaire (jamais un lien : O_NOFOLLOW), au plus `max` octets ; null sinon. */
function lirePetit(fichier: string, max: number): string | null {
  let fd: number;
  try {
    fd = openSync(fichier, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!fstatSync(fd).isFile()) return null;
    const tampon = Buffer.alloc(max + 1);
    const lus = readSync(fd, tampon, 0, max + 1, 0);
    return lus > max ? null : tampon.subarray(0, lus).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

const versionLue = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === "string" && (VERSION_PUBLIEE.test(v) || VERSION_DEVELOPPEMENT.test(v)) ? v : undefined;
const instantLu = (v: unknown): number | null | undefined => (v === null ? null : Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : undefined);

/** État écrit par le service root ; null s'il manque, est un lien, trop gros ou hors format (rien ne casse). */
export function lireEtat(dossier: string): EtatOperation | null {
  const texte = lirePetit(join(dossier, "etat.json"), TAILLE_MAX_ETAT);
  if (texte === null) return null;
  let brut: unknown;
  try {
    brut = JSON.parse(texte);
  } catch {
    return null;
  }
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const e = brut as Record<string, unknown>;
  const cible = versionLue(e.version_cible);
  const precedente = versionLue(e.version_precedente);
  const debut = instantLu(e.debut);
  const fin = instantLu(e.fin);
  if (typeof e.operation !== "string" || !/^\d{1,20}-\d{1,10}$/.test(e.operation)) return null;
  if (!(ETAPES as readonly unknown[]).includes(e.etape)) return null;
  if (e.resultat !== null && e.resultat !== "reussie" && e.resultat !== "echec") return null;
  if (e.motif !== null && !(MOTIFS as readonly unknown[]).includes(e.motif)) return null;
  if (cible === undefined || precedente === undefined || debut === undefined || debut === null || fin === undefined) return null;
  return {
    operation: e.operation, version_cible: cible, etape: e.etape as Etape, resultat: e.resultat as EtatOperation["resultat"],
    motif: e.motif as Motif | null, debut, fin, version_precedente: precedente,
  };
}

/** Mécanisme posé (M-11) : le dossier d'échange existe et n'est pas un lien. */
export function mecanismePose(dossier: string): boolean {
  try {
    return lstatSync(dossier).isDirectory();
  } catch {
    return false;
  }
}

/** Demande déposée, pas encore effacée par le service root (demande.json présent, quel qu'il soit). */
export function demandeEnAttente(dossier: string): boolean {
  try {
    lstatSync(join(dossier, "demande.json"));
    return true;
  } catch {
    return false;
  }
}

let compteur = 0;
/** Écrit un fichier du dossier d'échange d'un seul geste : fichier temporaire, puis renommage. */
function ecrireAtomique(fichier: string, contenu: string): void {
  const temporaire = `${fichier}.${process.pid}-${++compteur}.tmp`;
  writeFileSync(temporaire, contenu, { mode: 0o600, flag: "wx" });
  renameSync(temporaire, fichier);
}

/** Dépose la demande lue par le service root : exactement {"version":"X.Y.Z"} (M-8). */
export function ecrireDemande(dossier: string, version: string): void {
  if (!VERSION_PUBLIEE.test(version)) throw new Error(`Version invalide\u00a0: ${version}`);
  ecrireAtomique(join(dossier, "demande.json"), `${JSON.stringify({ version })}\n`);
}

/** Recopie le mode réglé par l'administrateur, lu la nuit par le service root (M-13). */
export function ecrireMode(dossier: string, mode: "manuel" | "automatique"): void {
  ecrireAtomique(join(dossier, "mode"), `${mode}\n`);
}
