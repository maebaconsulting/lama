import { get, run } from "@clawnify/db";
import { getAccount, type Account } from "./accounts.ts";
import { hashToken, newToken } from "./crypto.ts";

export const PERSONAL_TTL_MS = 14 * 24 * 60 * 60_000;
export const CONFIRM_TTL_MS = 5 * 60_000;
const DEFAULT_POSTE_IDLE_MIN = 5;

export interface Session {
  id: number;
  account_id: number;
  kind: "personnel" | "poste";
  device_id: number | null;
  expires_at: number;
  confirmed_until: number;
}

/** Délai de verrouillage des postes partagés, lu dans les réglages (1 à 30 minutes). */
export async function posteIdleMs(): Promise<number> {
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'postes.verrouillage_minutes'");
  const minutes = row ? Number(JSON.parse(row.value)) : DEFAULT_POSTE_IDLE_MIN;
  return Math.min(Math.max(Number.isFinite(minutes) ? minutes : DEFAULT_POSTE_IDLE_MIN, 1), 30) * 60_000;
}

export async function createSession(accountId: number, kind: Session["kind"], deviceId: number | null, now: number) {
  const token = newToken();
  const expires = now + (kind === "personnel" ? PERSONAL_TTL_MS : await posteIdleMs());
  const result = await run(
    "INSERT INTO sessions (token_hash, account_id, kind, device_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [hashToken(token), accountId, kind, deviceId, now, now, expires],
  );
  const id = Number(result.lastInsertRowid);
  const session: Session = { id, account_id: accountId, kind, device_id: deviceId, expires_at: expires, confirmed_until: 0 };
  return { token, session };
}

export async function resolveSession(token: string, now: number): Promise<{ session: Session; account: Account } | { locked: true } | null> {
  const row = await get<Session & { revoked: number | null }>(
    `SELECT s.id, s.account_id, s.kind, s.device_id, s.expires_at, s.confirmed_until, d.revoked
       FROM sessions s LEFT JOIN devices d ON d.id = s.device_id WHERE s.token_hash = ?`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (row.kind === "poste" && (row.device_id === null || row.revoked)) {
    await run("DELETE FROM sessions WHERE id = ?", [row.id]);
    return null;
  }
  if (row.expires_at <= now) {
    await run("DELETE FROM sessions WHERE id = ?", [row.id]);
    return row.kind === "poste" ? { locked: true } : null;
  }
  const account = await getAccount(row.account_id);
  if (!account || !account.active) {
    await run("DELETE FROM sessions WHERE id = ?", [row.id]);
    return null;
  }
  const expires = now + (row.kind === "personnel" ? PERSONAL_TTL_MS : await posteIdleMs());
  await run("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?", [now, expires, row.id]);
  if (row.device_id) await run("UPDATE devices SET last_seen_at = ? WHERE id = ?", [now, row.device_id]);
  const { revoked: _revoked, ...session } = row;
  return { session: { ...session, expires_at: expires }, account };
}

export async function deleteSession(token: string): Promise<void> {
  await run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
}

export async function deleteSessionsOf(accountId: number): Promise<void> {
  await run("DELETE FROM sessions WHERE account_id = ?", [accountId]);
}

export async function deleteSessionsOfDevice(deviceId: number): Promise<void> {
  await run("DELETE FROM sessions WHERE device_id = ?", [deviceId]);
}

export async function confirmSession(sessionId: number, now: number): Promise<number> {
  const until = now + CONFIRM_TTL_MS;
  await run("UPDATE sessions SET confirmed_until = ? WHERE id = ?", [until, sessionId]);
  return until;
}

export function isConfirmed(session: Session, now: number): boolean {
  return session.confirmed_until > now;
}
