/**
 * Remise à zéro de la base de formation (distribution D-19). Les factures et
 * leurs numéros ne se suppriment jamais (déclencheurs de la migration 005) :
 * la base n'est pas vidée, elle est refaite. La demande est un fichier déposé
 * dans le dossier des données (par Réglages > Formation, ou par `sudo
 * lama-formation --remettre-a-zero`), appliquée au démarrage suivant, comme la
 * restauration d'une sauvegarde : aucune écriture pendant que la base sert.
 */
import { existsSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { langFromEnv, message } from "../messages.ts";
import { runMigrations } from "../migrations.ts";
import { openDatabase } from "../storage.ts";
import { COMPTES_FORMATION } from "./comptes.ts";
import { ADMIN_DEMO, COMPTES_DEMO } from "./demo.ts";
import { estDemoPublique, garderContreVraieBase } from "./mode.ts";

/** Fichier de la demande, à côté de `lama.db` ; même nom dans `deploy/lama-formation.sh`. */
export const DEMANDE_REMISE_A_ZERO = "remise-a-zero.demandee";

/** Dépose la demande ; elle est appliquée au prochain démarrage du service de formation. Refuse la vraie base. */
export function demanderRemiseAZero(dataDir: string): void {
  garderContreVraieBase(dataDir, dataDir);
  writeFileSync(join(dataDir, DEMANDE_REMISE_A_ZERO), "", { mode: 0o600 });
}

type Ligne = Record<string, string | number | bigint | null | Uint8Array>;

/** Recopie des lignes dans une table de la base neuve, colonnes telles qu'elles sont lues. */
function recopier(db: DatabaseSync, table: string, lignes: Ligne[]): void {
  for (const ligne of lignes) {
    const colonnes = Object.keys(ligne);
    db.prepare(`INSERT INTO ${table} (${colonnes.join(", ")}) VALUES (${colonnes.map(() => "?").join(", ")})`).run(...colonnes.map((c) => ligne[c]));
  }
}

/** Base réellement illisible (fichier qui n'en est pas une, ou corrompu) : SQLITE_NOTADB (26) ou SQLITE_CORRUPT (11). */
function estIllisible(error: unknown): boolean {
  const code = (error as { errcode?: unknown })?.errcode;
  return typeof code === "number" && [11, 26].includes(code & 0xff);
}

/**
 * Au démarrage de la base de formation : si une remise à zéro est demandée,
 * refait la base. Gardés : les quatre comptes de formation (mêmes numéros, mots
 * de passe et codes PIN) et les postes déclarés (les tablettes restent
 * déclarées), sauf en démonstration publique, où aucun poste n'est gardé. Tout le reste repart de zéro (sessions, comptes créés en séance,
 * fiches, rendez-vous, caisse, réglages, journal) ; la démonstration est semée
 * de nouveau par le démarrage, qui rétablit alors les comptes (`retablirComptesFormation` :
 * rôle, fiche liée, nom affiché).
 *
 * Remplacement atomique : la base neuve est bâtie dans `lama.db.remise` (migrations,
 * puis copie des comptes et des postes en une transaction), fermée, puis renommée sur
 * `lama.db` ; la demande n'est supprimée qu'après. Une panne ou une erreur en chemin
 * laisse l'ancienne base et la demande intactes (reprise au démarrage suivant).
 * Une base réellement illisible est refaite sans compte, et le journal le dit ; toute
 * autre erreur de lecture remonte sans rien toucher. Refuse la vraie base avant tout accès.
 * Rend vrai si la remise a été faite.
 */
export function appliquerRemiseAZero(dataDir: string): boolean {
  garderContreVraieBase(dataDir, dataDir);
  const demande = join(dataDir, DEMANDE_REMISE_A_ZERO);
  if (!existsSync(demande)) return false;
  const chemin = join(dataDir, "lama.db");
  const temporaire = `${chemin}.remise`;
  let comptes: Ligne[] = [];
  let postes: Ligne[] = [];
  // Un fichier vide est une base neuve : rien à garder, rien d'illisible.
  if (existsSync(chemin) && statSync(chemin).size > 0) {
    try {
      const ancienne = new DatabaseSync(chemin);
      try {
        // Démonstration publique : ses trois comptes publics et son administration (rétablis ensuite par le démarrage).
        const logins = estDemoPublique() ? [...COMPTES_DEMO.map((c) => c.login), ADMIN_DEMO.login] : COMPTES_FORMATION.map((c) => c.login);
        comptes = ancienne.prepare(`SELECT * FROM accounts WHERE login IN (${logins.map(() => "?").join(", ")}) ORDER BY id`).all(...logins) as Ligne[];
        // Démonstration publique : aucun poste gardé (ceux des visiteurs, noms compris, repartent avec la nuit).
        postes = estDemoPublique() ? [] : (ancienne.prepare("SELECT * FROM devices ORDER BY id").all() as Ligne[]);
      } finally {
        ancienne.close();
      }
    } catch (error) {
      // Autre erreur qu'une base illisible : rien n'est touché, la demande reste pour le démarrage suivant.
      if (!estIllisible(error)) throw error;
      // Base illisible : refaite sans compte, et le dit (le technicien relance `sudo lama-formation --comptes`).
      comptes = [];
      postes = [];
      console.log(message(langFromEnv(process.env), "formation.remise_illisible"));
    }
  }
  // Temporaire d'une panne précédente effacé, puis base neuve bâtie à part.
  for (const suffixe of ["", "-wal", "-shm"]) rmSync(temporaire + suffixe, { force: true });
  const neuve = openDatabase(temporaire);
  try {
    runMigrations(neuve);
    // La fiche n° 1 de la praticienne revient avec la démonstration, semée juste après par le démarrage.
    neuve.exec("PRAGMA foreign_keys = OFF");
    neuve.exec("BEGIN");
    recopier(neuve, "accounts", comptes);
    recopier(neuve, "devices", postes.map((p) => ({ ...p, created_by: null })));
    neuve.exec("COMMIT");
  } catch (error) {
    neuve.close();
    for (const suffixe of ["", "-wal", "-shm"]) rmSync(temporaire + suffixe, { force: true });
    throw error;
  }
  neuve.close();
  // Bascule : le renommage remplace l'ancienne base d'un coup ; la demande n'est consommée qu'après.
  for (const suffixe of ["-wal", "-shm"]) rmSync(chemin + suffixe, { force: true });
  renameSync(temporaire, chemin);
  rmSync(demande, { force: true });
  return true;
}
