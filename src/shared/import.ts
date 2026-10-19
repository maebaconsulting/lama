/**
 * Imports de données (spec du 18/10/2026 § 2) : types d'import, limites et forme de l'aperçu,
 * partagés par le serveur et l'écran. Aucune dépendance.
 */

export const TYPES_IMPORT = ["catalogue", "clientes", "produits", "rendez-vous"] as const;
export type TypeImport = (typeof TYPES_IMPORT)[number];

/** Poids maximal d'un fichier (§ 2.1). */
export const IMPORT_MAX_OCTETS = 5 * 1024 * 1024;
/** Lignes au plus sous l'en-tête (§ 2.1). */
export const IMPORT_MAX_LIGNES = 20_000;
/** Lignes refusées et avertissements renvoyés au plus par l'aperçu ; les totaux restent exacts. */
export const IMPORT_MAX_LISTE = 500;

export function estTypeImport(v: unknown): v is TypeImport {
  return typeof v === "string" && (TYPES_IMPORT as readonly string[]).includes(v);
}

/** Réponse de l'aperçu et de l'import : compteurs, lignes refusées (motif traduit), avertissements. */
export interface ApercuImport {
  type: TypeImport;
  /** Lignes non vides sous l'en-tête. */
  lignes: number;
  ajouts: number;
  mises_a_jour: number;
  inchangees: number;
  /** Catalogue, case « désactiver les prestations absentes » cochée. */
  desactivees: number;
  /** Rendez-vous : fiches de clientes inconnues créées. */
  clientes_creees: number;
  /** Produits : stocks qui changent de valeur (une ligne `produit.stock` au journal chacun). */
  stocks_changes: number;
  /** Catalogue et produits : premier prix lu, en unités mineures, à vérifier dans la devise ; `null` sinon. */
  premier_prix: number | null;
  refusees: { ligne: number; motif: string; doublon: boolean }[];
  refusees_total: number;
  doublons: number;
  avertissements: { ligne: number; texte: string }[];
  avertissements_total: number;
  /** Vrai si « Importer » écrirait le fichier : au moins une ligne, aucune refusée. */
  importable: boolean;
}
