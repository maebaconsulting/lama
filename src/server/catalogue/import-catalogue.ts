/**
 * Catalogue des prestations depuis un fichier CSV : rubrique « Import » des Réglages et `cli importer-catalogue`,
 * même lecture (spec du 18/10/2026 § 2.1 et § 2.2). Le fichier est contrôlé en entier avant toute écriture :
 * une seule ligne fautive et rien n'est écrit. Une prestation est reconnue par son univers et son nom
 * (`category`, `name`), sans tenir compte des accents ni des majuscules : un second chargement met à jour
 * au lieu de doubler, et la fiche garde son nom et son univers. Les montants sont en unités
 * mineures de la devise déclarée par la colonne `devise` (XAF sans cette colonne, format historique),
 * qui doit être celle de la base. Les colonnes facultatives `supplement_seulement` et `supplements_possibles`
 * règlent la case et la liste des suppléments ; absentes, le réglage existant est gardé (`import-supplements.ts`).
 */
import type { DatabaseSync } from "node:sqlite";
import { DEVISE_DEFAUT, DEVISES, type CodeDevise } from "../../shared/devises.ts";
import { lireTableau, type Colonnes, type Refus, type Tableau } from "../import/csv.ts";
import { analyseVide, cle, controlerDevise, enCentimes, lireDevises, lireEntier, ouiNon, type Analyse } from "../import/commun.ts";
import { ecrireListes, type ListeImportee } from "./import-supplements.ts";

/** Colonnes historiques, toutes obligatoires dans l'en-tête. */
export const COLONNES = [
  "categorie", "categorie_en", "groupe", "groupe_en", "nom", "nom_en",
  "duree_min", "prix", "prix_max", "couleur", "remarque", "remarque_en",
] as const;

/** Colonnes facultatives (§ 2.2) : suppléments et devise des montants. */
export const COLONNES_FACULTATIVES = ["supplement_seulement", "supplements_possibles", "devise"] as const;

export const COLONNES_CATALOGUE: Colonnes = { obligatoires: COLONNES, facultatives: COLONNES_FACULTATIVES };

/** Durée enregistrée quand le catalogue n'en donne pas (une heure, durée la plus courante d'un soin). */
export const DUREE_PAR_DEFAUT = 60;

export interface LigneCatalogue {
  /** Numéro de la ligne dans le fichier (1 pour l'en-tête). */
  ligne: number;
  categorie: string; categorieEn: string; groupe: string; groupeEn: string;
  nom: string; nomEn: string; duree: number; prix: number; prixMax: number | null;
  couleur: string; remarque: string; remarqueEn: string;
  /** `null` : colonne absente du fichier ; vide vaut `non`. */
  supplementSeulement: boolean | null;
  /** `null` : colonne absente ; noms tels qu'écrits (`Nom` ou `Univers > Nom`), reconnus à l'écriture (`ecrireListes`). */
  supplementsPossibles: string[] | null;
}

/** Ligne refusée, motif en clé de message (`catalogue.*` ou `import.*`). */
export type ErreurLigne = Refus;

export interface LectureCatalogue { lignes: LigneCatalogue[]; erreurs: ErreurLigne[]; devise: CodeDevise }

export interface BilanImport { ajoutees: number; misesAJour: number; desactivees: number }

/** Catalogue refusé à l'écriture (durée selon la case de la base, suppléments possibles) : lignes et motifs ; la transaction est à annuler. */
export class CatalogueRefuse extends Error {
  readonly refus: ErreurLigne[];

  constructor(refus: ErreurLigne[]) {
    super("catalogue refusé");
    this.name = "CatalogueRefuse";
    this.refus = refus;
  }
}

/** Clé d'une prestation : univers et nom, sans accents, majuscules ni espaces en trop (`cle`). */
const clePrestation = (categorie: string, nom: string) => `${cle(categorie)}\n${cle(nom)}`;

/** Prestations de la base par `clePrestation` ; à clé égale, la plus ancienne. */
function prestationsParCle(db: DatabaseSync): Map<string, number> {
  const fiches = db.prepare("SELECT id, name, COALESCE(category, '') AS category FROM services ORDER BY id").all() as { id: number; name: string; category: string }[];
  const m = new Map<string, number>();
  for (const f of fiches) {
    const k = clePrestation(f.category, f.name);
    if (!m.has(k)) m.set(k, f.id);
  }
  return m;
}

/**
 * Durée de moins de 5 minutes sans la colonne `supplement_seulement` : permise seulement si la prestation
 * existe déjà « supplément seulement » (la case est gardée) ; un ajout vaut `non`, la ligne est refusée.
 */
function refusDuree(db: DatabaseSync, lignes: LigneCatalogue[], existantes: Map<string, number>): ErreurLigne[] {
  const caseDe = db.prepare("SELECT supplement_seulement FROM services WHERE id = ?");
  return lignes.filter((l) => {
    if (l.duree >= 5 || l.supplementSeulement !== null) return false;
    const id = existantes.get(clePrestation(l.categorie, l.nom));
    return id === undefined || (caseDe.get(id) as { supplement_seulement: number }).supplement_seulement !== 1;
  }).map((l) => ({ ligne: l.ligne, motif: "catalogue.duree" }));
}

/**
 * Case « supplément seulement » cochée par le fichier sans la colonne `supplements_possibles` (liste
 * gardée) : refusée si la prestation existante garde une liste non vide (une liste du fichier est
 * contrôlée à son écriture, `writeList`).
 */
function refusSeulementListe(db: DatabaseSync, lignes: LigneCatalogue[], existantes: Map<string, number>): ErreurLigne[] {
  const aUneListe = db.prepare("SELECT 1 AS x FROM service_supplements WHERE service_id = ?");
  return lignes.filter((l) => {
    if (l.supplementSeulement !== true || l.supplementsPossibles !== null) return false;
    const id = existantes.get(clePrestation(l.categorie, l.nom));
    return id !== undefined && aUneListe.get(id) !== undefined;
  }).map((l) => ({ ligne: l.ligne, motif: "catalogue.supplement_seulement_liste" }));
}

/** Refus connus avant toute écriture (durée, case et liste gardée), un au plus par ligne, dans l'ordre du fichier. */
function refusPrealables(db: DatabaseSync, lignes: LigneCatalogue[], existantes: Map<string, number>): ErreurLigne[] {
  const durees = refusDuree(db, lignes, existantes);
  const listes = refusSeulementListe(db, lignes, existantes).filter((r) => !durees.some((d) => d.ligne === r.ligne));
  return [...durees, ...listes].sort((a, b) => a.ligne - b.ligne);
}

/** Noms séparés par `|`, chacun non vide, `Nom` ou `Univers > Nom` ; `null` si la forme est fausse. */
function lireSupplements(texte: string): string[] | null {
  if (texte === "") return [];
  const noms = texte.split("|").map((n) => n.trim());
  const valide = (n: string) => n !== "" && n.split(">").length <= 2 && n.split(">").every((m) => m.trim() !== "");
  return noms.every(valide) ? noms.map((n) => n.split(">").map((m) => m.trim()).join(" > ")) : null;
}

/** Lignes valides et refusées d'un tableau déjà lu (route d'import ou ligne de commande). */
export function lireCatalogueTableau(tableau: Tableau): LectureCatalogue {
  const lignes: LigneCatalogue[] = [];
  const devises = lireDevises(tableau);
  const erreurs: ErreurLigne[] = [...tableau.refusees, ...devises.refusees];
  const dejaRefusees = new Set(devises.refusees.map((r) => r.ligne));
  const avecSeulement = tableau.colonnes.includes("supplement_seulement");
  const avecPossibles = tableau.colonnes.includes("supplements_possibles");
  const vues = new Set<string>();
  for (const { numero, champs: c } of tableau.lignes) {
    if (dejaRefusees.has(numero)) continue;
    const duree = c.duree_min === "" ? DUREE_PAR_DEFAUT : lireEntier(c.duree_min);
    const prix = lireEntier(c.prix);
    const prixMax = c.prix_max === "" ? null : lireEntier(c.prix_max);
    const seulement = ouiNon(c.supplement_seulement, false);
    const possibles = lireSupplements(c.supplements_possibles);
    let refus: ErreurLigne | null = null;
    if (!c.nom || !c.categorie) refus = { ligne: numero, motif: "catalogue.nom_vide" };
    // 0 minute permise pour une prestation « supplément seulement » (§ 3.1) ; colonne absente, la case
    // de la base décide (`refusDuree`, à l'aperçu et à l'écriture).
    else if (duree === null || duree > 720 || (duree < 5 && avecSeulement && seulement !== true)) refus = { ligne: numero, motif: "catalogue.duree" };
    else if (prix === null) refus = enCentimes(devises.devise) ? { ligne: numero, motif: "catalogue.prix_centimes", valeurs: { devise: devises.devise } } : { ligne: numero, motif: "catalogue.prix" };
    else if (c.prix_max !== "" && (prixMax === null || prixMax <= prix)) refus = { ligne: numero, motif: "catalogue.prix_max" };
    else if (!/^#[0-9A-Fa-f]{6}$/.test(c.couleur)) refus = { ligne: numero, motif: "catalogue.couleur" };
    else if (seulement === null) refus = { ligne: numero, motif: "import.oui_non", valeurs: { colonne: "supplement_seulement" } };
    else if (possibles === null) refus = { ligne: numero, motif: "catalogue.supplements_possibles" };
    else if (vues.has(clePrestation(c.categorie, c.nom))) refus = { ligne: numero, motif: "catalogue.doublon", doublon: true };
    if (refus) {
      erreurs.push(refus);
      continue;
    }
    vues.add(clePrestation(c.categorie, c.nom));
    lignes.push({
      ligne: numero, categorie: c.categorie, categorieEn: c.categorie_en, groupe: c.groupe, groupeEn: c.groupe_en, nom: c.nom, nomEn: c.nom_en,
      duree: duree!, prix: prix!, prixMax, couleur: c.couleur, remarque: c.remarque, remarqueEn: c.remarque_en,
      supplementSeulement: avecSeulement ? seulement : null,
      supplementsPossibles: avecPossibles ? possibles : null,
    });
  }
  erreurs.sort((a, b) => a.ligne - b.ligne);
  return { lignes, erreurs, devise: devises.devise };
}

/** Lit le texte du fichier ; une erreur de fichier (en-tête, guillemets) est rendue comme une ligne refusée. */
export function lireCatalogue(texte: string): LectureCatalogue {
  const lecture = lireTableau(texte, COLONNES_CATALOGUE);
  if (lecture.ok) return lireCatalogueTableau(lecture.tableau);
  const ligne = Number(lecture.erreur.valeurs?.ligne ?? 1);
  return { lignes: [], erreurs: [{ ligne, ...lecture.erreur }], devise: DEVISE_DEFAUT };
}

/** Montant en unités mineures écrit dans la devise : « 10 000 FCFA », « 15,00 EUR ». */
function montantTexte(n: number, lang: "fr" | "en", devise: CodeDevise): string {
  const d = DEVISES[devise];
  const nombre = (n / 10 ** d.decimales).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { minimumFractionDigits: d.decimales, maximumFractionDigits: d.decimales });
  return `${nombre}${lang === "fr" ? "\u00a0" : " "}${d.libelle}`;
}

/** Description affichée avec la prestation : groupe, fourchette de prix dans la devise du fichier, remarque. */
export function description(l: LigneCatalogue, lang: "fr" | "en", devise: CodeDevise = "XAF"): string {
  const fourchette = l.prixMax === null ? "" : lang === "fr"
    ? `De ${montantTexte(l.prix, "fr", devise)} à ${montantTexte(l.prixMax, "fr", devise)}`
    : `From ${montantTexte(l.prix, "en", devise)} to ${montantTexte(l.prixMax, "en", devise)}`;
  const morceaux = lang === "fr" ? [l.groupe, fourchette, l.remarque] : [l.groupeEn, fourchette, l.remarqueEn];
  return morceaux.filter(Boolean).map((m) => (/[.!?]$/.test(m) ? m : `${m}.`)).join(" ");
}

/** Devise de l'institut (`institut.devise`), XAF par défaut. */
export function deviseDeLaBase(db: DatabaseSync): string {
  const ligne = db.prepare("SELECT value FROM settings WHERE key = 'institut.devise'").get() as { value: string } | undefined;
  if (!ligne) return DEVISE_DEFAUT;
  try {
    return String(JSON.parse(ligne.value));
  } catch {
    return DEVISE_DEFAUT;
  }
}

/**
 * Aperçu (§ 2.1, étape 3), sans rien écrire : prestations à ajouter, à mettre à jour, à désactiver si
 * la case est cochée ; devise du fichier comparée à celle de la base. La durée est contrôlée avec la case
 * de la base comme à l'écriture (`refusDuree`) ; les suppléments possibles le sont par l'écriture
 * elle-même, faite puis annulée (point de sauvegarde) : l'aperçu refuse exactement les lignes que
 * l'import refuserait.
 */
export function analyserCatalogue(db: DatabaseSync, lecture: LectureCatalogue, options: { base: CodeDevise; desactiverAbsentes: boolean }): Analyse<LigneCatalogue> {
  const a = analyseVide<LigneCatalogue>(lecture.lignes.length + lecture.erreurs.length, lecture.erreurs);
  a.erreurFichier = controlerDevise(lecture.devise, options.base);
  const existantes = prestationsParCle(db);
  const durees = refusPrealables(db, lecture.lignes, existantes);
  a.refusees.push(...durees);
  const gardees = new Set<number>();
  for (const l of lecture.lignes) {
    const existante = existantes.get(clePrestation(l.categorie, l.nom));
    if (existante !== undefined) {
      gardees.add(existante);
      a.misesAJour++;
    } else a.ajouts++;
  }
  if (options.desactiverAbsentes) {
    const actives = db.prepare("SELECT id FROM services WHERE active = 1").all() as { id: number }[];
    a.desactivees = actives.filter((s) => !gardees.has(s.id)).length;
  }
  // Lignes déjà refusées (durée, case et liste gardée) : écartées de l'écriture d'essai, qui n'en montre que les autres refus.
  const ecrites = lecture.lignes.filter((l) => !durees.some((r) => r.ligne === l.ligne));
  if (ecrites.some((l) => l.supplementsPossibles !== null)) {
    db.exec("SAVEPOINT apercu_catalogue");
    try {
      ecrireCatalogue(db, ecrites, { desactiverAbsentes: options.desactiverAbsentes, devise: lecture.devise });
    } catch (erreur) {
      if (!(erreur instanceof CatalogueRefuse)) throw erreur;
      a.refusees.push(...erreur.refus);
    } finally {
      db.exec("ROLLBACK TO apercu_catalogue");
      db.exec("RELEASE apercu_catalogue");
    }
  }
  a.refusees.sort((x, y) => x.ligne - y.ligne);
  a.operations = lecture.lignes;
  a.premierPrix = lecture.lignes[0]?.prix ?? null;
  return a;
}

/**
 * Écrit le catalogue dans la transaction de l'appelant. Une prestation déjà connue (même univers, même nom, à la casse et aux accents près)
 * reprend durée, prix, couleur, textes et redevient active ; son réglage « en ligne » est gardé, sauf
 * pour une prestation « supplément seulement », jamais publiée. Avec `desactiverAbsentes`, les prestations
 * actives absentes du fichier sont désactivées (jamais supprimées : rendez-vous et factures passés les citent).
 * Enfin les listes de suppléments du fichier remplacent les leurs. Un refus (durée de moins de 5 minutes
 * hors « supplément seulement », case cochée sur une liste gardée, liste) lève `CatalogueRefuse`.
 */
export function ecrireCatalogue(db: DatabaseSync, lignes: LigneCatalogue[], options: { desactiverAbsentes: boolean; devise: CodeDevise }): BilanImport {
  const bilan: BilanImport = { ajoutees: 0, misesAJour: 0, desactivees: 0 };
  const existantes = prestationsParCle(db);
  const durees = refusPrealables(db, lignes, existantes);
  if (durees.length > 0) throw new CatalogueRefuse(durees);
  const ajouter = db.prepare(
    "INSERT INTO services (name, description, duration, price, color, category, name_en, description_en, category_en, supplement_seulement, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
  );
  // Case absente du fichier (`null`) : réglage gardé ; cochée : retirée de l'offre en ligne.
  const mettreAJour = db.prepare(
    `UPDATE services SET description = ?, duration = ?, price = ?, color = ?, name_en = ?, description_en = ?, category_en = ?, active = 1,
       supplement_seulement = COALESCE(?, supplement_seulement), en_ligne = CASE WHEN COALESCE(?, supplement_seulement) = 1 THEN 0 ELSE en_ligne END WHERE id = ?`,
  );
  const gardees: number[] = [];
  const listes: ListeImportee[] = [];
  for (const l of lignes) {
    const existante = existantes.get(clePrestation(l.categorie, l.nom));
    const textes = [description(l, "fr", options.devise), l.duree, l.prix, l.couleur] as const;
    const seulement = l.supplementSeulement === null ? null : l.supplementSeulement ? 1 : 0;
    let id: number;
    if (existante !== undefined) {
      mettreAJour.run(...textes, l.nomEn, description(l, "en", options.devise), l.categorieEn, seulement, seulement, existante);
      id = existante;
      bilan.misesAJour++;
    } else {
      const r = ajouter.run(l.nom, ...textes, l.categorie, l.nomEn, description(l, "en", options.devise), l.categorieEn, seulement ?? 0);
      id = Number(r.lastInsertRowid);
      bilan.ajoutees++;
    }
    gardees.push(id);
    if (l.supplementsPossibles !== null) listes.push({ ligne: l.ligne, serviceId: id, noms: l.supplementsPossibles });
  }
  if (options.desactiverAbsentes) {
    const actives = db.prepare("SELECT id FROM services WHERE active = 1").all() as { id: number }[];
    const desactiver = db.prepare("UPDATE services SET active = 0 WHERE id = ?");
    const dansLeFichier = new Set(gardees);
    for (const { id } of actives) {
      if (dansLeFichier.has(id)) continue;
      desactiver.run(id);
      bilan.desactivees++;
    }
  }
  // Après les désactivations : un nom n'est reconnu que parmi les prestations qui restent actives.
  const refus = ecrireListes(db, listes);
  if (refus.length > 0) throw new CatalogueRefuse(refus);
  return bilan;
}

/** `ecrireCatalogue` dans sa propre transaction (`cli importer-catalogue`). */
export function importerCatalogue(db: DatabaseSync, lignes: LigneCatalogue[], options: { desactiverAbsentes: boolean; devise: CodeDevise }): BilanImport {
  db.exec("BEGIN IMMEDIATE");
  try {
    const bilan = ecrireCatalogue(db, lignes, options);
    db.exec("COMMIT");
    return bilan;
  } catch (erreur) {
    db.exec("ROLLBACK");
    throw erreur;
  }
}
