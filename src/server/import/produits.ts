/**
 * Import des produits et du stock (spec du 18/10/2026 § 2.4). Un produit est reconnu par sa référence
 * (`sku`) si elle est renseignée, sinon par son nom (sans accents ni majuscules) ; une référence encore
 * inconnue est posée sur l'unique fiche du même nom qui n'en a pas. Produit existant :
 * une cellule renseignée remplace la valeur (le nom et la référence seulement s'ils diffèrent autrement que par la
 * casse ou les accents), une cellule vide la laisse ; chaque changement de stock est
 * noté au journal avec l'ancienne et la nouvelle valeur. Montants dans la devise déclarée, celle de la base.
 */
import type { Database } from "../storage.ts";
import { MAX_TARGET_LENGTH } from "../audit.ts";
import { analyseVide, cle, controlerDevise, enCentimes, lireDevises, lireEntier, nomPropre, type Analyse, type Contexte } from "./commun.ts";
import type { Colonnes, Refus, Tableau } from "./csv.ts";

export const COLONNES_PRODUITS: Colonnes = {
  obligatoires: ["nom", "prix"],
  facultatives: ["nom_en", "marque", "categorie", "categorie_en", "reference", "cout", "stock", "seuil_alerte", "devise"],
};

interface Fiche { id: number; name: string; name_en: string; brand: string; category: string; category_en: string; sku: string; price: number; cost: number; stock: number; low_stock_alert: number }
type Valeurs = Omit<Fiche, "id">;

export type OperationProduit =
  | { type: "ajout"; valeurs: Valeurs }
  | { type: "maj"; id: number; changements: Partial<Valeurs> };

const TEXTES = [["nom", "name"], ["nom_en", "name_en"], ["marque", "brand"], ["categorie", "category"], ["categorie_en", "category_en"], ["reference", "sku"]] as const;
const NOMBRES = [["prix", "price"], ["cout", "cost"], ["stock", "stock"], ["seuil_alerte", "low_stock_alert"]] as const;

/** Cible du journal d'un stock changé : Huile de coco, 12 → 8, nom raccourci pour que les valeurs tiennent (64 caractères). */
export function cibleStock(nom: string, avant: number, apres: number): string {
  const suffixe = `\u00a0: ${avant} → ${apres}`;
  const place = MAX_TARGET_LENGTH - [...suffixe].length;
  const lettres = [...nom];
  return `${lettres.length <= place ? nom : `${lettres.slice(0, Math.max(place - 1, 0)).join("")}…`}${suffixe}`;
}

function grouper(fiches: Fiche[], cleDe: (f: Fiche) => string): Map<string, Fiche[]> {
  const m = new Map<string, Fiche[]>();
  for (const f of fiches) {
    const k = cleDe(f);
    if (k === "") continue;
    m.set(k, [...(m.get(k) ?? []), f]);
  }
  return m;
}

/** Aperçu des produits, sans rien écrire : ajouts, mises à jour, inchangés ; stocks changés préparés pour le journal. */
export function analyserProduits(db: Database, tableau: Tableau, ctx: Pick<Contexte, "base">): Analyse<OperationProduit> {
  const a = analyseVide<OperationProduit>(tableau.lignes.length + tableau.refusees.length, tableau.refusees);
  const devises = lireDevises(tableau);
  a.refusees.push(...devises.refusees);
  a.erreurFichier = controlerDevise(devises.devise, ctx.base);
  const dejaRefusees = new Set(devises.refusees.map((r) => r.ligne));
  const fiches = (db.prepare(
    `SELECT id, name, COALESCE(name_en, '') AS name_en, COALESCE(brand, '') AS brand, COALESCE(category, '') AS category,
            COALESCE(category_en, '') AS category_en, COALESCE(sku, '') AS sku, price, cost, stock, low_stock_alert FROM products ORDER BY id`,
  ).all() as unknown as Fiche[]).map((f) => ({ ...f }));
  const parReference = grouper(fiches, (f) => cle(f.sku));
  const parNom = grouper(fiches, (f) => cle(f.name));
  const vus = new Set<string>();
  const fichesVisees = new Set<number>();
  for (const { numero, champs } of tableau.lignes) {
    if (dejaRefusees.has(numero)) continue;
    const c: Record<string, string> = { ...champs, nom: nomPropre(champs.nom), nom_en: nomPropre(champs.nom_en) };
    const refuser = (r: Omit<Refus, "ligne">) => a.refusees.push({ ligne: numero, ...r });
    if (!c.nom) { refuser({ motif: "import.nom_vide" }); continue; }
    const nombres: Partial<Record<(typeof NOMBRES)[number][1], number>> = {};
    let faute: string | null = null;
    for (const [colonne, champ] of NOMBRES) {
      if (c[colonne] === "" && colonne !== "prix") continue;
      const n = lireEntier(c[colonne]);
      if (n === null) { faute = colonne; break; }
      nombres[champ] = n;
    }
    if (faute) {
      // Montant (prix, coût) dans une devise à centimes : le refus dit l'unité attendue.
      const montant = (faute === "prix" || faute === "cout") && enCentimes(devises.devise);
      refuser(montant ? { motif: "import.entier_centimes", valeurs: { colonne: faute, devise: devises.devise } } : { motif: "import.entier", valeurs: { colonne: faute } });
      continue;
    }
    let candidates = (c.reference ? parReference.get(cle(c.reference)) : parNom.get(cle(c.nom))) ?? [];
    // Référence encore inconnue : une seule fiche du même nom, sans référence, la reçoit au lieu d'être doublée.
    if (c.reference && candidates.length === 0) {
      const sansReference = (parNom.get(cle(c.nom)) ?? []).filter((f) => cle(f.sku) === "");
      if (sansReference.length === 1) candidates = sansReference;
    }
    if (candidates.length > 1) { refuser({ motif: c.reference ? "import.reference_ambigue" : "import.nom_ambigu" }); continue; }
    const fiche = candidates[0];
    const doublon = () => refuser({ motif: "import.doublon_produit", doublon: true });
    if (fiche) {
      // Une fiche de la base n'est visée qu'une fois, que ce soit par sa référence ou par son nom.
      if (fichesVisees.has(fiche.id)) { doublon(); continue; }
      fichesVisees.add(fiche.id);
    } else {
      // Un produit neuf prend la référence et le nom de la ligne : une ligne suivante qui reprend l'un des deux est un doublon.
      const cles = [...(c.reference ? [`r:${cle(c.reference)}`] : []), `n:${cle(c.nom)}`];
      if (cles.some((k) => vus.has(k))) { doublon(); continue; }
      cles.forEach((k) => vus.add(k));
    }
    a.premierPrix ??= nombres.price!;
    if (!fiche) {
      a.ajouts++;
      a.operations.push({ type: "ajout", valeurs: {
        name: c.nom, name_en: c.nom_en, brand: c.marque, category: c.categorie, category_en: c.categorie_en, sku: c.reference,
        price: nombres.price!, cost: nombres.cost ?? 0, stock: nombres.stock ?? 0, low_stock_alert: nombres.low_stock_alert ?? 5,
      } });
      continue;
    }
    const changements: Partial<Valeurs> = {};
    const poser = (champ: keyof Valeurs, v: string | number) => { (changements as Record<string, string | number>)[champ] = v; };
    for (const [colonne, champ] of TEXTES) {
      if (c[colonne] === "" || c[colonne] === fiche[champ]) continue;
      // Nom et référence servent à reconnaître la fiche : une autre casse ou d'autres accents ne la renomment pas.
      if ((colonne === "nom" || colonne === "reference") && cle(c[colonne]) === cle(fiche[champ])) continue;
      poser(champ, c[colonne]);
    }
    for (const [, champ] of NOMBRES) {
      const n = nombres[champ];
      if (n !== undefined && n !== fiche[champ]) poser(champ, n);
    }
    if (Object.keys(changements).length === 0) {
      a.inchangees++;
      continue;
    }
    // Nom ou référence changés : une ligne suivante qui les reprend vise ce produit, pas un produit neuf.
    if (changements.name !== undefined) vus.add(`n:${cle(changements.name)}`);
    if (changements.sku !== undefined) vus.add(`r:${cle(changements.sku)}`);
    a.misesAJour++;
    a.operations.push({ type: "maj", id: fiche.id, changements });
    if (changements.stock !== undefined) a.journal.push({ action: "produit.stock", cible: cibleStock(changements.name ?? fiche.name, fiche.stock, changements.stock) });
  }
  return a;
}

/** Écrit les produits dans la transaction de l'appelant ; noms de colonnes fixes (`TEXTES`, `NOMBRES`). */
export function ecrireProduits(db: Database, operations: OperationProduit[]): void {
  const ajouter = db.prepare("INSERT INTO products (name, name_en, brand, category, category_en, sku, price, cost, stock, low_stock_alert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const op of operations) {
    if (op.type === "ajout") {
      const v = op.valeurs;
      ajouter.run(v.name, v.name_en, v.brand, v.category, v.category_en, v.sku, v.price, v.cost, v.stock, v.low_stock_alert);
      continue;
    }
    const colonnes = Object.keys(op.changements) as (keyof Valeurs)[];
    db.prepare(`UPDATE products SET ${colonnes.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .run(...colonnes.map((k) => op.changements[k] as string | number), op.id);
  }
}
