/**
 * Lecture des fichiers d'import (spec du 18/10/2026 § 2.1), sans dépendance : CSV selon la RFC 4180
 * (champ entre guillemets avec séparateur, retour à la ligne ou guillemet doublé), séparateur `;` ou `,`
 * reconnu sur la ligne d'en-tête, BOM toléré, fins de ligne Windows, Unix ou Mac. Les colonnes sont
 * reconnues par leur nom. Partagé par les routes d'import et par `cli importer-catalogue`.
 */
import type { MessageKey, Values } from "../messages.ts";
import { IMPORT_MAX_LIGNES } from "../../shared/import.ts";
import { cle } from "./commun.ts";

/** Enregistrements bruts lus au plus, lignes vides comprises : un fichier de lignes vides ne fait pas tourner la lecture sans fin. */
export const MAX_ENREGISTREMENTS = 200_000;

/** Refus d'un fichier ou d'une ligne : clé de message et ses variables. */
export interface Motif { motif: MessageKey; valeurs?: Values }
/** Ligne refusée : numéro de l'enregistrement (1 pour l'en-tête, comme le tableur) ; `doublon` : doublon du fichier ou de la base. */
export interface Refus extends Motif { ligne: number; doublon?: true }

/** Colonnes d'un import : celles qui doivent figurer dans l'en-tête, et celles qui peuvent y figurer. */
export interface Colonnes { obligatoires: readonly string[]; facultatives: readonly string[] }
/** Ligne lue : chaque colonne connue a sa valeur, espaces retirés, vide si la colonne est absente. */
export interface LigneCsv { numero: number; champs: Record<string, string> }
export interface Tableau { colonnes: string[]; lignes: LigneCsv[]; refusees: Refus[] }

/** Texte UTF-8 du fichier (BOM retiré), ou `null` si les octets ne sont pas de l'UTF-8 (fichier réenregistré en Windows-1252). */
export function decoderFichier(octets: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    return null;
  }
}

/** `;` si la ligne d'en-tête en contient un hors guillemets, sinon `,` si elle en contient une, sinon `;`. */
export function detecterSeparateur(texte: string): ";" | "," {
  let guillemets = false;
  let virgule = false;
  for (const c of texte) {
    if (c === '"') guillemets = !guillemets;
    else if (guillemets) continue;
    else if (c === "\n" || c === "\r") break;
    else if (c === ";") return ";";
    else if (c === ",") virgule = true;
  }
  return virgule ? "," : ";";
}

/** Enregistrements du fichier, champs bruts ; refus si un guillemet n'est pas fermé ou si du texte suit le guillemet fermant. */
export function lireCsv(source: string): { ok: true; enregistrements: string[][] } | { ok: false; erreur: Motif } {
  const texte = source.replace(/^\uFEFF/, "");
  const separateur = detecterSeparateur(texte);
  const enregistrements: string[][] = [];
  let champs: string[] = [];
  let champ = "";
  let guillemets = false;
  let apresGuillemets = false;
  let debutChamp = true;
  const refus = (): { ok: false; erreur: Motif } => ({ ok: false, erreur: { motif: "import.guillemets", valeurs: { ligne: enregistrements.length + 1 } } });
  const tropLong = (): { ok: false; erreur: Motif } => ({ ok: false, erreur: { motif: "import.trop_de_lignes" } });
  const finirChamp = () => {
    champs.push(champ);
    champ = "";
    debutChamp = true;
    apresGuillemets = false;
  };
  const finirEnregistrement = () => {
    finirChamp();
    enregistrements.push(champs);
    champs = [];
  };
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c !== '"') champ += c;
      else if (texte[i + 1] === '"') {
        champ += '"';
        i++;
      } else {
        guillemets = false;
        apresGuillemets = true;
      }
      continue;
    }
    if (c === separateur) {
      finirChamp();
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && texte[i + 1] === "\n") i++;
      finirEnregistrement();
      if (enregistrements.length > MAX_ENREGISTREMENTS) return tropLong();
      continue;
    }
    if (apresGuillemets) return refus();
    if (c === '"' && debutChamp) {
      guillemets = true;
      debutChamp = false;
      continue;
    }
    champ += c;
    debutChamp = false;
  }
  if (guillemets) return refus();
  if (champ !== "" || champs.length > 0 || apresGuillemets) finirEnregistrement();
  if (enregistrements.length > MAX_ENREGISTREMENTS) return tropLong();
  return { ok: true, enregistrements };
}

/**
 * Tableau d'un import : en-tête contrôlé (colonnes connues, chacune une fois, obligatoires présentes),
 * lignes vides ignorées, ligne au mauvais nombre de champs refusée (séparateurs en trop tolérés en fin,
 * ligne courte complétée quand seules des colonnes facultatives manquent).
 * Refus du fichier entier : guillemets, en-tête, aucune ligne, plus de 20 000 lignes.
 */
export function lireTableau(source: string, colonnes: Colonnes): { ok: true; tableau: Tableau } | { ok: false; erreur: Motif } {
  const csv = lireCsv(source);
  if (!csv.ok) return csv;
  const [entete, ...donnees] = csv.enregistrements;
  if (!entete || entete.every((c) => c.trim() === "")) return { ok: false, erreur: { motif: "import.vide" } };
  // Noms comparés sans accents ni majuscules : « Téléphone » ou « Référence » écrits par la personne sont reconnus.
  const noms = entete.map((c) => cle(c));
  while (noms.length > 0 && noms[noms.length - 1] === "") noms.pop();
  const connues = [...colonnes.obligatoires, ...colonnes.facultatives];
  for (const [i, nom] of noms.entries()) {
    if (nom === "") return { ok: false, erreur: { motif: "import.entete_vide", valeurs: { position: i + 1 } } };
    if (!connues.includes(nom)) return { ok: false, erreur: { motif: "import.entete_inconnue", valeurs: { colonne: nom, colonnes: connues.join(", ") } } };
    if (noms.indexOf(nom) !== i) return { ok: false, erreur: { motif: "import.entete_double", valeurs: { colonne: nom } } };
  }
  const manquantes = colonnes.obligatoires.filter((c) => !noms.includes(c));
  if (manquantes.length > 0) return { ok: false, erreur: { motif: "import.entete_manque", valeurs: { colonnes: manquantes.join(", ") } } };
  const lignes: LigneCsv[] = [];
  const refusees: Refus[] = [];
  let lues = 0;
  donnees.forEach((brut, i) => {
    const numero = i + 2;
    if (brut.every((v) => v.trim() === "")) return;
    lues++;
    const utiles = [...brut];
    while (utiles.length > noms.length && utiles[utiles.length - 1].trim() === "") utiles.pop();
    // Ligne courte (le tableur coupe les dernières cellules vides) : complétée si seules des colonnes facultatives manquent.
    if (utiles.length < noms.length && noms.slice(utiles.length).every((nom) => !colonnes.obligatoires.includes(nom))) {
      while (utiles.length < noms.length) utiles.push("");
    }
    if (utiles.length !== noms.length) {
      refusees.push({ ligne: numero, motif: "import.colonnes", valeurs: { attendu: noms.length, lu: utiles.length } });
      return;
    }
    const champs: Record<string, string> = Object.fromEntries(connues.map((c) => [c, ""]));
    noms.forEach((nom, j) => {
      champs[nom] = utiles[j].trim();
    });
    lignes.push({ numero, champs });
  });
  if (lues > IMPORT_MAX_LIGNES) return { ok: false, erreur: { motif: "import.trop_de_lignes" } };
  if (lues === 0) return { ok: false, erreur: { motif: "import.aucune_ligne" } };
  return { ok: true, tableau: { colonnes: noms, lignes, refusees } };
}
