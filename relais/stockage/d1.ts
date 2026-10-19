import type { Base, Valeur } from "./base.ts";

/** Ce que le relais utilise de D1 (Cloudflare), déclaré ici pour ne dépendre d'aucun paquet de Cloudflare. */
export interface D1StatementLike {
  bind(...valeurs: Valeur[]): D1StatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
}

/** Base du relais sur D1. */
export function baseD1(d1: D1Like): Base {
  const lier = (sql: string, params: Valeur[]) => d1.prepare(sql).bind(...params);
  return {
    async tous<T>(sql: string, params: Valeur[] = []) {
      return (await lier(sql, params).all<T>()).results;
    },
    async premier<T>(sql: string, params: Valeur[] = []) {
      return await lier(sql, params).first<T>();
    },
    async executer(sql: string, params: Valeur[] = []) {
      return { changements: (await lier(sql, params).run()).meta.changes };
    },
  };
}
