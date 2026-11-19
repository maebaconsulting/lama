/**
 * Fichier d'import reçu, quel que soit son format : classeur Excel (.xlsx, reconnu à sa signature zip,
 * pas à son nom) ou CSV UTF-8. Les deux aboutissent au même tableau et aux mêmes contrôles. Partagé par
 * les routes d'import et par `cli importer-catalogue`.
 */
import { decoderFichier, lireTableau, tableauDepuis, type Colonnes, type Motif, type Tableau } from "./csv.ts";
import { estXlsAncien, estZip, lireXlsx } from "./xlsx.ts";

export function lireFichier(octets: Uint8Array, colonnes: Colonnes): { ok: true; tableau: Tableau } | { ok: false; erreur: Motif } {
  if (estZip(octets)) {
    const classeur = lireXlsx(octets);
    return classeur.ok ? tableauDepuis(classeur.enregistrements, colonnes) : classeur;
  }
  if (estXlsAncien(octets)) return { ok: false, erreur: { motif: "import.xls" } };
  const texte = decoderFichier(octets);
  if (texte === null) return { ok: false, erreur: { motif: "import.encodage" } };
  return lireTableau(texte, colonnes);
}
