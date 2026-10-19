import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Base, Valeur } from "./base.ts";

/** Base du relais sur node:sqlite (serveur loué, essais). */
export function baseSqlite(db: DatabaseSync): Base {
  return {
    async tous<T>(sql: string, params: Valeur[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async premier<T>(sql: string, params: Valeur[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async executer(sql: string, params: Valeur[] = []) {
      return { changements: Number(db.prepare(sql).run(...params).changes) };
    },
  };
}

export const DOSSIER_MIGRATIONS = new URL("./migrations/", import.meta.url);

/** Applique, dans l'ordre des noms, les migrations SQL pas encore faites (les mêmes que celles de D1). */
export function migrerSqlite(db: DatabaseSync, dossier: URL = DOSSIER_MIGRATIONS): void {
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (nom TEXT PRIMARY KEY)");
  const faites = new Set((db.prepare("SELECT nom FROM _migrations").all() as { nom: string }[]).map((l) => l.nom));
  for (const nom of readdirSync(dossier).filter((f) => f.endsWith(".sql")).sort()) {
    if (faites.has(nom)) continue;
    db.exec("BEGIN");
    try {
      db.exec(readFileSync(new URL(nom, dossier), "utf8"));
      db.prepare("INSERT INTO _migrations (nom) VALUES (?)").run(nom);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}
