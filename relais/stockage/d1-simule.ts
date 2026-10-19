import type { DatabaseSync } from "node:sqlite";
import type { Valeur } from "./base.ts";
import type { D1Like, D1StatementLike } from "./d1.ts";

/**
 * D1 simulée sur node:sqlite, pour les essais seulement : même forme d'appel que D1
 * (`prepare(sql).bind(...).all()`, `first()`, `run()`), qui fait passer `baseD1` par le même SQL.
 * Elle exécute chaque requête de façon synchrone : elle ne prouve rien sur la concurrence ni l'atomicité de la vraie D1.
 */
export function d1Simule(db: DatabaseSync): D1Like {
  return {
    prepare(sql: string): D1StatementLike {
      const lie = (valeurs: Valeur[]): D1StatementLike => ({
        bind: (...v: Valeur[]) => lie(v),
        all: async <T>() => ({ results: db.prepare(sql).all(...valeurs) as T[] }),
        first: async <T>() => ((db.prepare(sql).get(...valeurs) as T | undefined) ?? null),
        run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...valeurs).changes) } }),
      });
      return lie([]);
    },
  };
}
