/**
 * Suppléments (spec du 18/10/2026 § 3), règles communes à l'écran et au serveur : bornes
 * du supplément libre et contrôle de sa saisie, limites des listes, ordre d'affichage des
 * lignes d'un document (chaque supplément sous sa prestation). Aucune dépendance, testé sous Node.
 */

export type SupplementKind = "service" | "product" | "libre";

/** Libellé d'un supplément libre : 80 caractères au plus, espaces de bord retirées, sans caractère de contrôle. */
export const LIBRE_LIBELLE_MAX = 80;
/** Minutes ajoutées par un supplément libre : de 0 à 240. */
export const LIBRE_MINUTES_MAX = 240;
/** Prix d'un supplément libre : entier, de 0 à cette borne (la même que les montants de la caisse). */
export const LIBRE_PRIX_MAX = 1_000_000_000;
/** Suppléments posés sous une même prestation d'un rendez-vous. */
export const SUPPLEMENTS_PAR_PRESTATION = 20;
/** Articles d'une liste de suppléments possibles. */
export const LISTE_MAX = 30;
/** Quantité d'un produit en supplément. */
export const QUANTITE_MAX = 99;

/** Suppléments au plus dans une seule modification d'un rendez-vous (toutes prestations confondues). */
export const SUPPLEMENTS_PAR_RENDEZ_VOUS = 200;

export type LibreProblem = "supplement.libre_libelle" | "supplement.libre_prix" | "supplement.libre_minutes";

const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/;
const entierEntre = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Problème d'un supplément libre saisi, ou `null` s'il est valable. */
export function libreProblem(input: { label: unknown; price: unknown; minutes: unknown }): LibreProblem | null {
  const label = typeof input.label === "string" ? input.label.trim() : "";
  // Une seule ligne imprimable : aucun caractère de contrôle (retour à la ligne, tabulation…), qui casserait ticket et journal.
  if (label === "" || [...label].length > LIBRE_LIBELLE_MAX || CONTROLE.test(label)) return "supplement.libre_libelle";
  if (!entierEntre(input.price, 0, LIBRE_PRIX_MAX)) return "supplement.libre_prix";
  if (!entierEntre(input.minutes, 0, LIBRE_MINUTES_MAX)) return "supplement.libre_minutes";
  return null;
}

/**
 * Lignes d'un document dans l'ordre d'affichage : chaque ligne seule, suivie de ses
 * suppléments (`supplement: true`) dans leur ordre d'origine. Un supplément dont la
 * prestation n'est pas sur le document (avoir qui ne reprend que lui) reste à sa place,
 * sans retrait.
 */
export function orderedLines<T extends { id: number; parent_line_id?: number | null }>(lines: T[]): (T & { supplement: boolean })[] {
  const ids = new Set(lines.map((l) => l.id));
  const rattachee = (l: T) => l.parent_line_id != null && ids.has(l.parent_line_id);
  const out: (T & { supplement: boolean })[] = [];
  for (const line of lines) {
    if (rattachee(line)) continue;
    out.push({ ...line, supplement: false });
    for (const child of lines) if (child.parent_line_id === line.id) out.push({ ...child, supplement: true });
  }
  return out;
}
