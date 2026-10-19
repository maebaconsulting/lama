/**
 * Outils communs aux quatre imports (spec du 18/10/2026 § 2) : analyse rendue par l'aperçu, saisies du
 * tableur (oui ou non, entier), devise déclarée par un fichier de montants, reconnaissance des
 * prestations (nom, ou « Univers > Nom ») et des praticiennes par leur nom, parmi les fiches actives.
 */
import type { Database } from "../storage.ts";
import { fold } from "../fold.ts";
import { DEVISES, estCodeDevise, type CodeDevise } from "../../shared/devises.ts";
import type { Motif, Refus, Tableau } from "./csv.ts";

/** Ligne acceptée mais à vérifier (nom différent pour un même numéro, colonnes lues mais pas encore appliquées). */
export interface Avertissement extends Motif { ligne: number }

/** Ce que l'aperçu montre, et ce que l'import écrit si aucune ligne n'est refusée. */
export interface Analyse<Op> {
  lignes: number;
  ajouts: number;
  misesAJour: number;
  inchangees: number;
  desactivees: number;
  clientesCreees: number;
  refusees: Refus[];
  avertissements: Avertissement[];
  /** Refus du fichier entier découvert à l'analyse (devise). */
  erreurFichier: Motif | null;
  operations: Op[];
  /** Lignes du journal d'audit à écrire après la transaction (changements de stock). */
  journal: { action: string; cible: string }[];
  /** Catalogue et produits : prix de la première ligne acceptée, en unités mineures, montré par l'aperçu pour vérifier l'unité. */
  premierPrix: number | null;
}

/** Ce que les analyses lisent hors du fichier : indicatif de l'institut, instant, devise de la base, option du catalogue. */
export interface Contexte { indicatif: string; maintenant: number; base: CodeDevise; desactiverAbsentes: boolean }

export function analyseVide<Op>(lignes: number, refusees: Refus[] = []): Analyse<Op> {
  return { lignes, ajouts: 0, misesAJour: 0, inchangees: 0, desactivees: 0, clientesCreees: 0, refusees: [...refusees], avertissements: [], erreurFichier: null, operations: [], journal: [], premierPrix: null };
}

/** Vrai si « Importer » peut écrire : au moins une ligne, aucune refusée, pas d'erreur de fichier. */
export function importable(a: Analyse<unknown>): boolean {
  return a.erreurFichier === null && a.refusees.length === 0 && a.lignes > 0;
}

/** Clé de comparaison d'un nom : sans accents, sans majuscules, espaces en trop retirés. */
export function cle(texte: string): string {
  return fold(texte.trim()).replace(/\s+/g, " ");
}

/** Nom écrit dans une fiche : toute suite d'espaces, retours à la ligne compris, ramenée à une espace. */
export function nomPropre(texte: string): string {
  return texte.replace(/\s+/g, " ").trim();
}

/** `oui`, `non` (toute casse) ou vide (valeur par défaut) ; `null` pour toute autre saisie. */
export function ouiNon(v: string, defaut: boolean): boolean | null {
  const x = v.trim().toLowerCase();
  if (x === "") return defaut;
  return x === "oui" ? true : x === "non" ? false : null;
}

/** Entier positif ou nul écrit sans espace ni décimale (espaces autour coupés) ; `null` sinon, vide ou trop grand compris. */
export function lireEntier(v: string): number | null {
  const x = v.trim();
  if (!/^\d+$/.test(x)) return null;
  const n = Number(x);
  return Number.isSafeInteger(n) ? n : null;
}

/** Devise d'un fichier sans colonne `devise` : le format historique de `importer-catalogue`, en FCFA. */
export const DEVISE_SANS_COLONNE: CodeDevise = "XAF";

/**
 * Devise déclarée par un fichier de montants (§ 2.1) : colonne `devise`, un code connu, le même sur toutes
 * les lignes (la première valide fait foi). Sans la colonne : XAF. Une ligne fautive est refusée.
 */
export function lireDevises(tableau: Tableau): { devise: CodeDevise; refusees: Refus[] } {
  if (!tableau.colonnes.includes("devise")) return { devise: DEVISE_SANS_COLONNE, refusees: [] };
  let devise: CodeDevise | null = null;
  const refusees: Refus[] = [];
  for (const { numero, champs } of tableau.lignes) {
    const code = champs.devise.toUpperCase();
    if (code === "") refusees.push({ ligne: numero, motif: "import.devise_vide" });
    else if (!estCodeDevise(code)) refusees.push({ ligne: numero, motif: "import.devise_code", valeurs: { devise: code } });
    else if (devise === null) devise = code;
    else if (code !== devise) refusees.push({ ligne: numero, motif: "import.devise_melangee", valeurs: { devise: code, premiere: devise } });
  }
  return { devise: devise ?? DEVISE_SANS_COLONNE, refusees };
}

/** Vrai si la devise s'écrit avec des centimes (EUR…) : un montant du fichier est alors en centimes, ce que disent les refus. */
export function enCentimes(devise: CodeDevise): boolean {
  return DEVISES[devise].decimales > 0;
}

/** Même garde que `importer-catalogue` : un fichier déclaré dans une autre devise que celle de la base est refusé en entier. */
export function controlerDevise(declaree: CodeDevise, base: CodeDevise): Motif | null {
  return declaree === base ? null : { motif: "import.devise_base", valeurs: { fichier: declaree, base } };
}

export type Recherche<T> = { trouve: T } | Motif;
export interface Prestation { id: number; name: string; category: string; duration: number; price: number; supplement_seulement: number }
export interface Praticienne { id: number; name: string }

function grouper<T>(liste: T[], cleDe: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of liste) {
    const k = cleDe(x);
    const deja = m.get(k);
    if (deja) deja.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/**
 * Recherche d'une prestation active par son nom, ou par « Univers > Nom » (univers : `services.category`)
 * quand le nom seul n'est pas unique. Index construit une fois par import (20 000 lignes au plus).
 */
export function indexerPrestations(db: Database): (texte: string) => Recherche<Prestation> {
  const fiches = (db.prepare("SELECT id, name, COALESCE(category, '') AS category, duration, price, supplement_seulement FROM services WHERE active = 1 ORDER BY id").all() as unknown as Prestation[])
    .map((p) => ({ id: p.id, name: p.name, category: p.category, duration: p.duration, price: p.price, supplement_seulement: p.supplement_seulement }));
  const parNom = grouper(fiches, (p) => cle(p.name));
  const parUnivers = grouper(fiches, (p) => `${cle(p.category)}>${cle(p.name)}`);
  return (texte) => {
    const morceaux = texte.split(">");
    const liste = morceaux.length === 1 ? parNom.get(cle(texte)) : morceaux.length === 2 ? parUnivers.get(`${cle(morceaux[0])}>${cle(morceaux[1])}`) : undefined;
    if (!liste) return { motif: "import.prestation_introuvable", valeurs: { nom: texte } };
    if (liste.length > 1) return { motif: "import.prestation_ambigue", valeurs: { nom: texte } };
    return { trouve: liste[0] };
  };
}

/** Recherche d'une praticienne active par son nom affiché dans lama. */
export function indexerPraticiennes(db: Database): (texte: string) => Recherche<Praticienne> {
  const fiches = (db.prepare("SELECT id, name FROM staff WHERE active = 1 ORDER BY id").all() as unknown as Praticienne[]).map((s) => ({ id: s.id, name: s.name }));
  const parNom = grouper(fiches, (s) => cle(s.name));
  return (texte) => {
    const liste = parNom.get(cle(texte));
    if (!liste) return { motif: "import.praticienne_introuvable", valeurs: { nom: texte } };
    if (liste.length > 1) return { motif: "import.praticienne_ambigue", valeurs: { nom: texte } };
    return { trouve: liste[0] };
  };
}
