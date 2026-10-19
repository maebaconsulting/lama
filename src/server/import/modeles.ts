/**
 * Modèles à télécharger (spec du 18/10/2026 § 2.1, étape 1) : CSV UTF-8 avec BOM, séparateur `;`,
 * ligne d'en-tête et une ligne d'exemple neutre, que le tableur ouvre et réenregistre en « CSV UTF-8 ».
 * Les montants d'exemple sont dans la devise de la base (`prixDemo`), la colonne `devise` la déclare.
 * Le téléphone d'exemple est écrit sous sa forme nationale, sans « + » que le tableur prendrait pour une
 * formule. La ligne d'exemple laissée dans un fichier est refusée (`retirerExemples`). Le catalogue porte
 * ses colonnes de suppléments, à `non` et vide dans l'exemple.
 */
import { prixDemo, type CodeDevise } from "../../shared/devises.ts";
import { doualaDay } from "../../shared/caisse.ts";
import type { TypeImport } from "../../shared/import.ts";
import { COLONNES } from "../catalogue/import-catalogue.ts";
import { normalizePhone } from "../whatsapp/numeros.ts";
import { cle } from "./commun.ts";
import type { Refus, Tableau } from "./csv.ts";

/** Téléphone des lignes d'exemple, forme nationale que `normalizePhone` complète avec l'indicatif. */
export const TELEPHONE_EXEMPLE = "6 00 00 00 00";

/** Champ écrit selon la RFC 4180 : entre guillemets s'il contient `;`, un guillemet ou un retour à la ligne. */
export function champCsv(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const ligne = (champs: string[]) => champs.map(champCsv).join(";");
const JOUR_MS = 24 * 60 * 60 * 1000;

type Parametres = { devise: CodeDevise; indicatif: string; maintenant: number };

const LIGNES: Record<TypeImport, (p: Parametres) => [string[], string[]]> = {
  catalogue: (p) => [
    [...COLONNES, "supplement_seulement", "supplements_possibles", "devise"],
    ["Soins du visage", "Facials", "Soins", "Treatments", "Soin hydratant", "Moisturising facial", "60", String(prixDemo(15000, p.devise)), "", "#4A5D73", "", "", "non", "", p.devise],
  ],
  clientes: (p) => [
    ["nom", "telephone", "langue", "anniversaire", "preferences", "whatsapp", "notes"],
    ["Cliente Exemple", TELEPHONE_EXEMPLE, "fr", "14-02", "Thé sans sucre", "oui", ""],
  ],
  produits: (p) => [
    ["nom", "nom_en", "marque", "categorie", "categorie_en", "reference", "prix", "cout", "stock", "seuil_alerte", "devise"],
    ["Crème hydratante", "Moisturising cream", "Marque exemple", "Soins", "Care", "EX-001", String(prixDemo(8000, p.devise)), String(prixDemo(4000, p.devise)), "10", "3", p.devise],
  ],
  "rendez-vous": (p) => [
    ["date", "heure", "telephone", "nom_cliente", "prestation", "praticienne", "notes"],
    [doualaDay(p.maintenant + 7 * JOUR_MS), "10:00", TELEPHONE_EXEMPLE, "Cliente Exemple", "Soin hydratant", "Praticienne exemple", ""],
  ],
};

/** Texte du modèle d'un import. */
export function modele(type: TypeImport, p: Parametres): string {
  const [entete, exemple] = LIGNES[type](p);
  return `\uFEFF${ligne(entete)}\r\n${ligne(exemple)}\r\n`;
}

/** Colonnes dont la valeur d'exemple dépend de l'institut ou du jour du téléchargement : ignorées pour reconnaître la ligne d'exemple. */
const VARIABLES = new Set(["prix", "cout", "devise", "date", "telephone"]);

/**
 * Lignes d'exemple du modèle laissées dans le fichier, refusées avant l'analyse : la ligne entière
 * (cellules utiles comparées avec `cle`, colonnes absentes du fichier ignorées : un modèle plus ancien
 * en avait moins), et pour les clientes et les rendez-vous tout numéro égal à
 * celui de l'exemple. `indicatif` sert seulement à ces deux imports.
 */
export function retirerExemples(type: TypeImport, tableau: Tableau, indicatif: string): Tableau {
  const [entete, exemple] = LIGNES[type]({ devise: "XAF", indicatif, maintenant: 0 });
  const utiles = entete.map((colonne, i) => [colonne, cle(exemple[i])] as const).filter(([colonne]) => !VARIABLES.has(colonne) && tableau.colonnes.includes(colonne));
  const numero = type === "clientes" || type === "rendez-vous" ? normalizePhone(TELEPHONE_EXEMPLE, indicatif) : null;
  const lignes: Tableau["lignes"] = [];
  const refusees: Refus[] = [...tableau.refusees];
  for (const l of tableau.lignes) {
    const exempleEntier = utiles.every(([colonne, valeur]) => cle(l.champs[colonne] ?? "") === valeur);
    const numeroExemple = numero !== null && normalizePhone(l.champs.telephone, indicatif) === numero;
    if (exempleEntier || numeroExemple) refusees.push({ ligne: l.numero, motif: "import.ligne_exemple" });
    else lignes.push(l);
  }
  return { ...tableau, lignes, refusees };
}
