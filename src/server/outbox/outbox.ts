import { get, query, run } from "@clawnify/db";
import { coded, decode } from "../messages.ts";
import type { Database } from "../storage.ts";

/**
 * Erreur passagère : la file relance. `retryAt` (facultatif) : relancer au
 * plus tard à cet instant, même si le délai habituel est plus long (échéance
 * d'un SMS de secours, retour d'internet attendu).
 */
export class TemporaryError extends Error {
  readonly retryAt?: number;
  constructor(message?: string, opts: { retryAt?: number } = {}) {
    super(message);
    this.retryAt = opts.retryAt;
  }
}
export class PermanentError extends Error {}

export interface OutboxItem {
  id: number; kind: string; payload: string; dedupe_key: string; status: "pending" | "sending" | "sent" | "failed"; manual: "" | "sent" | "ignored";
  attempts: number; next_attempt_at: number; last_error: string; created_by: number | null; created_at: number; sent_at: number | null;
}

/** `createdAt` : création de l'envoi (échéances) ; `online` : faux pendant une coupure d'internet (types qui tournent hors ligne). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (payload: any, ctx: { id: number; dedupeKey: string; now: number; createdAt: number; online: boolean }) => Promise<void>;
/** Rappelé quand un envoi passe définitivement en échec, pour que le domaine l'enregistre et fasse le ménage. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GiveUp = (payload: any, message: string) => Promise<void>;
/**
 * Débit d'un type d'envoi (WhatsApp, sous-projet 7 § 3) : tant que `ready`
 * est faux, ses envois attendent leur tour sans être réservés ni compter
 * d'essai, et les autres types passent quand même.
 */
export interface Throttle { ready(now: number): boolean }
const handlers = new Map<string, Handler>();
const giveUps = new Map<string, GiveUp>();
const throttles = new Map<string, Throttle>();
const offlines = new Map<string, () => Promise<boolean>>();

export function registerHandler(kind: string, fn: Handler, onGiveUp?: GiveUp, throttle?: Throttle, options: { offline?: () => Promise<boolean> } = {}): void {
  handlers.set(kind, fn);
  if (onGiveUp) giveUps.set(kind, onGiveUp);
  else giveUps.delete(kind);
  if (throttle) throttles.set(kind, throttle);
  else throttles.delete(kind);
  if (options.offline) offlines.set(kind, options.offline);
  else offlines.delete(kind);
}
export function clearHandlers(): void {
  handlers.clear();
  giveUps.clear();
  throttles.clear();
  offlines.clear();
}

/** Prévient le domaine d'un abandon ; son échec éventuel n'arrête jamais la file. */
async function notifyGiveUp(item: OutboxItem, message: string): Promise<void> {
  const onGiveUp = giveUps.get(item.kind);
  if (!onGiveUp) return;
  try {
    await onGiveUp(JSON.parse(item.payload), message);
  } catch (error) {
    console.error("File d'envoi\u00a0:", error instanceof Error ? decode("fr", error.message) : error);
  }
}

export const RETRY_DELAYS_MS = [30e3, 60e3, 120e3, 300e3, 900e3, 1800e3, 3600e3];
const GIVE_UP_AFTER_MS = 24 * 3600e3;
const GIVE_UP_MESSAGE = coded("envoi.abandon");
const KEEP_SENT_MS = 90 * 86_400_000;

export function nextDelay(attempts: number): number {
  return RETRY_DELAYS_MS[attempts - 1] ?? 3600e3;
}

export interface EnqueueInput {
  kind: string; payload: unknown; dedupeKey: string; createdBy?: number | null; now: number;
  /** Premier essai pas avant cet instant (fenêtre de silence) ; la fenêtre de 24 h part quand même de `now`. */
  notBefore?: number;
}
const INSERT = "INSERT OR IGNORE INTO outbox (kind, payload, dedupe_key, next_attempt_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)";
const insertValues = (input: EnqueueInput) =>
  [input.kind, JSON.stringify(input.payload), input.dedupeKey, Math.max(input.now, input.notBefore ?? input.now), input.createdBy ?? null, input.now];

export async function enqueue(input: EnqueueInput): Promise<{ id: number; created: boolean }> {
  const result = await run(INSERT, insertValues(input));
  const created = Number(result.changes) > 0;
  const row = await get<{ id: number }>("SELECT id FROM outbox WHERE dedupe_key = ?", [input.dedupeKey]);
  return { id: row!.id, created };
}

/** Même inscription, dans une transaction déjà ouverte (`StorageBinding.transaction`) : annulée avec elle. */
export function enqueueSync(db: Database, input: EnqueueInput): { id: number; created: boolean } {
  const result = db.prepare(INSERT).run(...(insertValues(input) as (string | number | null)[]));
  const row = db.prepare("SELECT id FROM outbox WHERE dedupe_key = ?").get(input.dedupeKey) as { id: number };
  return { id: row.id, created: Number(result.changes) > 0 };
}

/** Au démarrage : un envoi resté « en cours » (coupure pendant l'expédition) repart en attente, jamais perdu. */
export async function recoverInterrupted(): Promise<number> {
  const result = await run("UPDATE outbox SET status = 'pending' WHERE status = 'sending'");
  return Number(result.changes);
}

export async function processDue(now: number, online: boolean): Promise<number> {
  // Hors ligne, seuls les types qui savent s'en passer (SMS par le réseau mobile) tournent.
  let allowed: string[] | null = null;
  if (!online) {
    allowed = [];
    for (const [kind, offline] of offlines) if (await offline()) allowed.push(kind);
    if (allowed.length === 0) return 0;
  }
  const throttled = [...throttles.keys()];
  const kindFilter = allowed ? ` AND kind IN (${allowed.map(() => "?").join(", ")})` : "";
  // Types freinés (débit WhatsApp) : au plus un envoi chacun par passage, et seulement s'il est prêt ;
  // ils ne prennent jamais les 10 places des autres types.
  const due = await query<OutboxItem>(
    `SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ?${kindFilter}${throttled.length ? ` AND kind NOT IN (${throttled.map(() => "?").join(", ")})` : ""} ORDER BY next_attempt_at, id LIMIT 10`,
    [now, ...(allowed ?? []), ...throttled],
  );
  for (const [kind, throttle] of throttles) {
    if (allowed && !allowed.includes(kind)) continue;
    if (!throttle.ready(now)) continue;
    const first = await get<OutboxItem>("SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? AND kind = ? ORDER BY next_attempt_at, id LIMIT 1", [now, kind]);
    if (first) due.push(first);
  }
  due.sort((a, b) => a.next_attempt_at - b.next_attempt_at || a.id - b.id);
  for (const item of due) {
    // Réservation atomique : une relance manuelle ou un battement concurrent a pu
    // s'emparer de cet envoi entre la sélection ci-dessus et cette mise à jour.
    const reserved = await run("UPDATE outbox SET status = 'sending' WHERE id = ? AND status = 'pending'", [item.id]);
    if (Number(reserved.changes) === 0) continue;

    // Un envoi resté hors ligne plus de 24 h ne doit jamais partir au retour du
    // réseau (le rappel serait périmé) : abandon avant même d'appeler le gestionnaire.
    if (now - item.created_at >= GIVE_UP_AFTER_MS) {
      await run("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?", [GIVE_UP_MESSAGE, item.id]);
      await notifyGiveUp(item, GIVE_UP_MESSAGE);
      continue;
    }

    const handler = handlers.get(item.kind);
    if (!handler) {
      await run("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?", [coded("envoi.sans_gestionnaire"), item.id]);
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(item.payload);
    } catch {
      // Une charge illisible ne redeviendra jamais lisible : échec définitif, pas un essai à reprendre.
      await run("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?", [coded("envoi.charge_invalide"), item.id]);
      continue;
    }

    try {
      await handler(payload, { id: item.id, dedupeKey: item.dedupe_key, now, createdAt: item.created_at, online });
      await run("UPDATE outbox SET status = 'sent', sent_at = ?, last_error = '' WHERE id = ?", [now, item.id]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempts = item.attempts + 1;
      const usual = now + nextDelay(attempts);
      // Heure demandée par le gestionnaire (échéance du SMS de secours) : jamais plus tard qu'elle, jamais dans le passé.
      const next = error instanceof TemporaryError && error.retryAt !== undefined ? Math.min(usual, Math.max(error.retryAt, now)) : usual;
      // Abandon si l'essai suivant tomberait après la fenêtre de 24 h depuis la
      // création, ou immédiatement pour une erreur définitive.
      const givingUp = error instanceof PermanentError || next - item.created_at > GIVE_UP_AFTER_MS;
      await run(
        "UPDATE outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?",
        [givingUp ? "failed" : "pending", attempts, next, message, item.id],
      );
      if (givingUp) {
        await notifyGiveUp(item, error instanceof PermanentError ? message : coded("envoi.abandon_erreur", { erreur: message }));
      }
    }
  }
  return due.length;
}

/**
 * Envoi suspendu parce qu'une personne l'a ouvert pour l'envoyer à la main
 * (WhatsApp, « Ouvrir WhatsApp », sous-projet 7 vague 2) : jamais relancé.
 */
export const OPENED_BY_HAND = coded("whatsapp.ouvert");

/** Relance manuelle : repart comme un envoi neuf (nouvelle fenêtre de 24 h) ; jamais un envoi ouvert à la main. */
export async function retry(id: number, now: number): Promise<boolean> {
  const result = await run(
    "UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = ?, created_at = ? WHERE id = ? AND status IN ('failed', 'pending') AND last_error <> ?",
    [now, now, id, OPENED_BY_HAND],
  );
  return Number(result.changes) > 0;
}

export async function listOutbox(status?: string): Promise<OutboxItem[]> {
  return status
    ? query<OutboxItem>("SELECT * FROM outbox WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT 200", [status])
    : query<OutboxItem>("SELECT * FROM outbox ORDER BY created_at DESC, id DESC LIMIT 200");
}

/** Coupure prolongée : délai après le premier essai prévu au-delà duquel un message en attente se fait à la main. */
export const OFFLINE_DELAY_MS = 30 * 60e3;

/**
 * Messages jamais essayés, en attente depuis plus de `OFFLINE_DELAY_MS` après
 * leur premier essai prévu (hors ceux déjà pris en main) : ceux que la liste
 * « À envoyer à la main » montre pendant une coupure d'internet.
 */
export async function stalledOfflineCount(now: number): Promise<number> {
  return (await get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending' AND attempts = 0 AND manual = '' AND next_attempt_at <= ?",
    [now - OFFLINE_DELAY_MS],
  ))?.n ?? 0;
}

export async function pendingCount(): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status IN ('pending', 'sending')"))?.n ?? 0;
}

/**
 * Purge quotidienne (V1-05, décision 4) : envois partis, envoyés à la main
 * ou ignorés (`sent`, d'après `sent_at`) et échecs définitifs (`failed`,
 * d'après leur dernier essai prévu) de plus de 90 jours. Jamais un envoi en
 * attente ou en cours.
 */
export async function purgeSent(now: number): Promise<number> {
  const cutoff = now - KEEP_SENT_MS;
  const result = await run(
    "DELETE FROM outbox WHERE (status = 'sent' AND sent_at < ?) OR (status = 'failed' AND MAX(created_at, next_attempt_at) < ?)",
    [cutoff, cutoff],
  );
  return Number(result.changes);
}
