/**
 * Accès à la base du relais, le même pour D1 (Cloudflare) et node:sqlite : quelques requêtes SQL, rien de plus.
 * Le SQL et les migrations sont communs aux deux réalisations.
 */
export type Valeur = string | number | null;

export interface Base {
  tous<T>(sql: string, params?: Valeur[]): Promise<T[]>;
  premier<T>(sql: string, params?: Valeur[]): Promise<T | null>;
  executer(sql: string, params?: Valeur[]): Promise<{ changements: number }>;
}
