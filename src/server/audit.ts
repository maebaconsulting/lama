import { query, run } from "@clawnify/db";

export interface AuditEntry { id: number; at: number; account_id: number | null; account_name: string | null; action: string; target: string; ip: string }

const YEAR_MS = 365 * 24 * 60 * 60_000;
/** Longueur maximale d'une cible inscrite (en caractères) : le journal ne grossit jamais au gré d'une saisie. */
export const MAX_TARGET_LENGTH = 64;

export async function logAudit(entry: { accountId: number | null; action: string; target?: string; ip?: string; now: number }): Promise<void> {
  const target = [...(entry.target ?? "")].slice(0, MAX_TARGET_LENGTH).join("");
  await run("INSERT INTO audit_log (at, account_id, action, target, ip) VALUES (?, ?, ?, ?, ?)",
    [entry.now, entry.accountId, entry.action, target, (entry.ip ?? "").slice(0, MAX_TARGET_LENGTH)]);
}

export async function listAudit(filter: { accountId?: number; from?: number; to?: number; limit?: number }): Promise<AuditEntry[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.accountId !== undefined) { where.push("l.account_id = ?"); params.push(filter.accountId); }
  if (filter.from !== undefined) { where.push("l.at >= ?"); params.push(filter.from); }
  if (filter.to !== undefined) { where.push("l.at <= ?"); params.push(filter.to); }
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);
  return query<AuditEntry>(
    `SELECT l.id, l.at, l.account_id, a.display_name AS account_name, l.action, l.target, l.ip
       FROM audit_log l LEFT JOIN accounts a ON a.id = l.account_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.at DESC, l.id DESC LIMIT ${limit}`,
    params,
  );
}

export async function purgeAudit(now: number): Promise<number> {
  const result = await run("DELETE FROM audit_log WHERE at < ?", [now - YEAR_MS]);
  return Number(result.changes);
}
