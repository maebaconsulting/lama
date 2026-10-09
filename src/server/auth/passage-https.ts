/**
 * Passage de http à https (distribution D-08, décisions T3-3 et T3-4) : un
 * poste déclaré ou une session ouverte en http garde sa place en https, sans
 * qu'un cookie nu injecté en http (réseau local, port 80 sans chiffrement)
 * puisse être promu sous le nom `__Host-`. Seuls passent les postes et les
 * sessions créés strictement avant le premier service en https, et leur jeton
 * est changé au passage (l'ancien ne vaut plus rien). La reprise n'est
 * offerte que pendant `FENETRE_PASSAGE_HTTPS_MS` après ce premier service
 * (décision T3-5) ; ensuite, aucun cookie nu n'est plus jamais promu.
 */
import type { DatabaseSync } from "node:sqlite";
import { get, run } from "@clawnify/db";
import { hashToken, newToken } from "./crypto.ts";
import { createSession, deleteSession, resolveSession, type Session } from "./sessions.ts";

/** Clé interne (hors `SETTING_DEFS`, jamais exposée ni modifiable par l'API) : instant du premier démarrage en https, en ms. */
export const CLE_HTTPS_DEPUIS = "tls.https_depuis";

/** Durée pendant laquelle un cookie nu d'avant le passage peut encore être promu, à compter du premier service en https : 30 jours. */
export const FENETRE_PASSAGE_HTTPS_MS = 30 * 24 * 60 * 60_000;

/** Vrai si la reprise des cookies nus est encore ouverte à `now` (passage noté depuis au plus `FENETRE_PASSAGE_HTTPS_MS`). */
function fenetreOuverte(depuis: number | null, now: number): depuis is number {
  return depuis !== null && now - depuis <= FENETRE_PASSAGE_HTTPS_MS;
}

/** Note l'instant du premier démarrage en https ; jamais réécrit ensuite. */
export function noterPassageHttps(db: DatabaseSync, now: number): void {
  db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(key) DO NOTHING").run(CLE_HTTPS_DEPUIS, JSON.stringify(now), now);
}

/** Instant du premier démarrage en https, `null` si lama n'a jamais servi en https (aucune promotion alors). */
export async function passageHttps(): Promise<number | null> {
  const row = await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [CLE_HTTPS_DEPUIS]);
  const value = row ? Number(JSON.parse(row.value)) : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * Poste désigné par un cookie nu reçu en https : s'il existe, n'est pas
 * révoqué et a été déclaré avant `depuis`, son jeton est changé ; rend le
 * nouveau, sinon `null` (cookie ignoré). Toujours `null` hors de la fenêtre
 * de passage.
 */
export async function tournerPoste(token: string, depuis: number | null, now: number): Promise<string | null> {
  if (!fenetreOuverte(depuis, now)) return null;
  const device = await get<{ id: number }>("SELECT id FROM devices WHERE token_hash = ? AND revoked = 0 AND created_at < ?", [hashToken(token), depuis]);
  if (!device) return null;
  const neuf = newToken();
  await run("UPDATE devices SET token_hash = ? WHERE id = ?", [hashToken(neuf), device.id]);
  return neuf;
}

/**
 * Session désignée par un cookie nu reçu en https : si elle a été ouverte
 * avant `depuis` et vaut encore (mêmes contrôles qu'à chaque requête), une
 * nouvelle session de même compte, même sorte et même poste la remplace ;
 * rend son jeton et sa sorte, sinon `null` (cookie ignoré). Toujours
 * `null` hors de la fenêtre de passage.
 */
export async function tournerSession(token: string, depuis: number | null, now: number): Promise<{ token: string; kind: Session["kind"] } | null> {
  if (!fenetreOuverte(depuis, now)) return null;
  const row = await get<{ id: number }>("SELECT id FROM sessions WHERE token_hash = ? AND created_at < ?", [hashToken(token), depuis]);
  if (!row) return null;
  const resolved = await resolveSession(token, now);
  if (!resolved || !("session" in resolved)) return null;
  const { session } = resolved;
  const neuve = await createSession(session.account_id, session.kind, session.device_id, now);
  await deleteSession(token);
  return { token: neuve.token, kind: session.kind };
}
