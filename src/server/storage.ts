import { DatabaseSync } from "node:sqlite";
import { fold } from "./fold.ts";

/** Base ouverte, pour les modules qui travaillent dans une transaction (`StorageBinding.transaction`). */
export type Database = DatabaseSync;

/** Contrat attendu par @clawnify/db sous `env.STORAGE`. */
export interface StorageBinding {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; meta?: { changes: number; last_row_id: number } }>;
  /**
   * Exécute `work` dans une transaction SQLite, d'un seul tenant et sans
   * attente (aucune autre requête ne peut s'y glisser) : tout est validé, ou
   * tout est annulé si `work` lève (émission d'une facture, sous-projet 5 § 3.2).
   */
  transaction?: <T>(work: (db: Database) => T) => T;
}

/** Fonctions SQL propres à l'institut : `fold(texte)` pour les recherches insensibles aux accents. */
export function registerFunctions(db: DatabaseSync): void {
  db.function("fold", { deterministic: true }, (text: unknown) => (typeof text === "string" ? fold(text) : null));
}

/** Ouvre la base : journal WAL, clés étrangères, attente en cas de verrou, fonctions SQL. */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  registerFunctions(db);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function sqliteStorage(db: DatabaseSync): StorageBinding {
  return {
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      const args = params as (string | number | bigint | null | Uint8Array)[];
      if (stmt.columns().length) {
        const rows = stmt.all(...args) as Record<string, unknown>[];
        return { rows: rows.map((row) => Object.assign({}, row)) };
      }
      const result = stmt.run(...args);
      return { rows: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    },
    transaction(work) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = work(db);
        if (result !== null && typeof result === "object" && typeof (result as { then?: unknown }).then === "function") {
          throw new Error("StorageBinding.transaction attend un work synchrone\u00a0: une promesse a été rendue.");
        }
        db.exec("COMMIT");
        return result;
      } catch (error) {
        // Une erreur SQLite peut avoir déjà mis fin à la transaction (RAISE ROLLBACK) :
        // ne rien annuler dans ce cas, pour ne pas remplacer l'erreur d'origine.
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
