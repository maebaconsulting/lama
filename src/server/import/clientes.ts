/**
 * Import des clientes (spec du 18/10/2026 § 2.3). Une cliente est reconnue par son téléphone normalisé
 * avec l'indicatif de l'institut : une fiche existante est seulement complétée (un champ vide reçoit la
 * valeur du fichier, un champ rempli n'est jamais écrasé, le canal d'une fiche n'est jamais changé) ;
 * deux lignes du fichier au même numéro : la seconde est refusée.
 */
import type { Database } from "../storage.ts";
import { normalizePhone } from "../whatsapp/numeros.ts";
import { birthdayValid, MAX_PREFERENCES } from "../crm/champs.ts";
import { nomsProches } from "../en-ligne/demandes.ts";
import { analyseVide, nomPropre, ouiNon, type Analyse, type Contexte } from "./commun.ts";
import type { Colonnes, Refus, Tableau } from "./csv.ts";

export const COLONNES_CLIENTES: Colonnes = {
  obligatoires: ["nom", "telephone"],
  facultatives: ["langue", "anniversaire", "preferences", "whatsapp", "notes"],
};

export interface FicheCliente { id: number; name: string; language: string; birthday: string; preferences: string; notes: string }

type Complement = Partial<Record<"language" | "birthday" | "preferences" | "notes", string>>;

export type OperationCliente =
  | { type: "ajout"; nom: string; telephone: string; langue: string; anniversaire: string; preferences: string; canal: "whatsapp" | "none"; notes: string }
  | { type: "complement"; id: number; champs: Complement };

/** Fiches par numéro normalisé (sans `+`) ; à numéro égal, la plus ancienne. Les numéros sont gardés tels que saisis. */
export function fichesParTelephone(db: Database, indicatif: string): Map<string, FicheCliente> {
  const lignes = db.prepare(
    "SELECT id, name, phone, COALESCE(language, '') AS language, COALESCE(birthday, '') AS birthday, COALESCE(preferences, '') AS preferences, COALESCE(notes, '') AS notes FROM clients WHERE TRIM(COALESCE(phone, '')) <> '' ORDER BY id",
  ).all() as unknown as (FicheCliente & { phone: string })[];
  const fiches = new Map<string, FicheCliente>();
  for (const l of lignes) {
    const numero = normalizePhone(l.phone, indicatif);
    if (numero && !fiches.has(numero)) fiches.set(numero, { id: l.id, name: l.name, language: l.language, birthday: l.birthday, preferences: l.preferences, notes: l.notes });
  }
  return fiches;
}

/** `JJ-MM` du fichier (§ 2.3), ou `JJ/MM` qu'écrit le tableur, en `MM-JJ` de la base ; `null` si la forme est fausse ou si le jour n'existe pas. */
export function anniversaireDeFichier(v: string): string | null {
  const m = /^(\d{2})[-/](\d{2})$/.exec(v);
  if (!m) return null;
  const enBase = `${m[2]}-${m[1]}`;
  return birthdayValid(enBase) ? enBase : null;
}

/** Aperçu des clientes, sans rien écrire : fiches à créer, à compléter, inchangées ; noms différents signalés. */
export function analyserClientes(db: Database, tableau: Tableau, ctx: Pick<Contexte, "indicatif">): Analyse<OperationCliente> {
  const a = analyseVide<OperationCliente>(tableau.lignes.length + tableau.refusees.length, tableau.refusees);
  const existantes = fichesParTelephone(db, ctx.indicatif);
  const vus = new Set<string>();
  for (const { numero, champs: brut } of tableau.lignes) {
    const c: Record<string, string> = { ...brut, nom: nomPropre(brut.nom) };
    const refuser = (motif: Refus["motif"], valeurs?: Record<string, string>) =>
      a.refusees.push(valeurs ? { ligne: numero, motif, valeurs } : { ligne: numero, motif });
    if (!c.nom) { refuser("import.nom_vide"); continue; }
    const telephone = normalizePhone(c.telephone, ctx.indicatif);
    if (!telephone) { refuser("import.telephone"); continue; }
    if (vus.has(telephone)) { a.refusees.push({ ligne: numero, motif: "import.doublon_telephone", doublon: true }); continue; }
    const langue = c.langue.toLowerCase();
    const anniversaire = c.anniversaire === "" ? "" : anniversaireDeFichier(c.anniversaire);
    const whatsapp = ouiNon(c.whatsapp, true);
    if (!["", "fr", "en"].includes(langue)) { refuser("import.langue"); continue; }
    if (anniversaire === null) { refuser("import.anniversaire"); continue; }
    if ([...c.preferences].length > MAX_PREFERENCES) { refuser("cliente.preferences_longueur"); continue; }
    if (whatsapp === null) { refuser("import.oui_non", { colonne: "whatsapp" }); continue; }
    // Numéro vu seulement une fois la ligne acceptée : une ligne refusée plus haut ne fait pas refuser sa jumelle valide.
    vus.add(telephone);
    const fiche = existantes.get(telephone);
    if (!fiche) {
      a.ajouts++;
      a.operations.push({ type: "ajout", nom: c.nom, telephone: `+${telephone}`, langue, anniversaire, preferences: c.preferences, canal: whatsapp ? "whatsapp" : "none", notes: c.notes });
      continue;
    }
    if (!nomsProches(fiche.name, c.nom)) a.avertissements.push({ ligne: numero, motif: "import.nom_different", valeurs: { fichier: c.nom, fiche: fiche.name } });
    const champs: Complement = {};
    const vide = (v: string) => v.trim() === "";
    if (langue && vide(fiche.language)) champs.language = langue;
    if (anniversaire && vide(fiche.birthday)) champs.birthday = anniversaire;
    if (c.preferences && vide(fiche.preferences)) champs.preferences = c.preferences;
    if (c.notes && vide(fiche.notes)) champs.notes = c.notes;
    if (Object.keys(champs).length === 0) {
      a.inchangees++;
      continue;
    }
    a.misesAJour++;
    a.operations.push({ type: "complement", id: fiche.id, champs });
  }
  return a;
}

/** Écrit les clientes dans la transaction de l'appelant. Colonnes fixes : aucun nom de colonne ne vient du fichier. */
export function ecrireClientes(db: Database, operations: OperationCliente[]): void {
  const ajouter = db.prepare("INSERT INTO clients (name, phone, language, birthday, preferences, channel, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const op of operations) {
    if (op.type === "ajout") {
      ajouter.run(op.nom, op.telephone, op.langue, op.anniversaire, op.preferences, op.canal, op.notes);
      continue;
    }
    const colonnes = Object.keys(op.champs) as (keyof Complement)[];
    db.prepare(`UPDATE clients SET ${colonnes.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ?`)
      .run(...colonnes.map((k) => op.champs[k] as string), op.id);
  }
}
