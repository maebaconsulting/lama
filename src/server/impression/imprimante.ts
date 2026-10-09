/**
 * Envoi à l'imprimante de tickets (impression directe, spec § 2) : connexion
 * TCP au port 9100 de l'adresse réglée, état demandé avant chaque ticket
 * (en ligne, capot, papier), un envoi à la fois, délai de 5 s. Aucune file
 * durable : un ticket qui n'a pas pu sortir n'est jamais réimprimé sans geste.
 */
import { connect, type Socket } from "node:net";
import { parseLocalAddress } from "../reseau-local.ts";

export type PrintFailure = "injoignable" | "papier" | "capot";
export type PrintOutcome = { ok: true } | { ok: false; reason: PrintFailure };

/** Délai de connexion, de réponse à l'état et d'envoi. */
export const PRINT_TIMEOUT_MS = 5000;
/** Plafond de tout l'envoi : connexion, trois demandes d'état et envoi ne dépassent jamais ce délai. */
export const PRINT_DEADLINE_MS = 12_000;
/** Attente de la réponse à une demande d'état : une imprimante muette reçoit quand même le ticket. */
const STATUS_WAIT_MS = 1500;
const DEFAULT_PORT = 9100;

/**
 * Adresse réglée de l'imprimante, validée par `parseLocalAddress` (réseau
 * local seulement). Seuls les essais (fausse imprimante sur 127.0.0.1) lèvent
 * la règle de la machine elle-même, par `LAMA_IMPRESSION_ESSAI=1`, jamais
 * posé en service.
 */
export function parseAddress(text: string): { host: string; port: number } | null {
  return parseLocalAddress(text, DEFAULT_PORT, process.env.LAMA_IMPRESSION_ESSAI === "1");
}

// Un seul envoi à la fois dans le processus : deux ventes simultanées ne se
// mélangent pas sur le papier, et le compteur d'impressions est lu puis
// incrémenté sans course (`documents.ts`).
let queue: Promise<unknown> = Promise.resolve();

/** Exécute `task` quand les envois précédents sont terminés, réussis ou non. */
export function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Connexion ouverte : lecture octet par octet des réponses d'état ; `closed` dit si l'imprimante a déjà fermé. */
interface Connection {
  socket: Socket;
  /** Prochain octet reçu, ou `null` après `ms` sans réponse ou si la connexion se ferme entre-temps. */
  next(ms: number): Promise<number | null>;
  /** Oublie les octets déjà reçus (réponse tardive à une demande précédente). */
  drain(): void;
  closed(): boolean;
}

function open(host: string, port: number): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const received: number[] = [];
    let waiter: ((b: number | null) => void) | null = null;
    let isClosed = false;
    socket.on("data", (chunk: Buffer) => {
      received.push(...chunk);
      if (waiter && received.length) { const w = waiter; waiter = null; w(received.shift()!); }
    });
    // Fermeture pendant la demande d'état : l'attente s'arrête tout de suite.
    socket.on("close", () => { isClosed = true; if (waiter) { const w = waiter; waiter = null; w(null); } });
    socket.setTimeout(PRINT_TIMEOUT_MS, () => socket.destroy(new Error("délai dépassé")));
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.off("error", reject);
      socket.on("error", () => undefined);
      const next = (ms: number) => new Promise<number | null>((done) => {
        if (received.length) return done(received.shift()!);
        if (isClosed) return done(null);
        const timer = setTimeout(() => { waiter = null; done(null); }, ms);
        waiter = (b) => { clearTimeout(timer); done(b); };
      });
      resolve({ socket, next, drain: () => { received.length = 0; }, closed: () => isClosed });
    });
  });
}

/**
 * Écrit puis ferme proprement : réussi quand l'imprimante ferme à son tour
 * (comportement relevé sur la NETUM). Une connexion déjà fermée par
 * l'imprimante est un échec immédiat, jamais une attente sans fin.
 */
function writeAndClose(conn: Connection, data: Buffer): Promise<void> {
  if (conn.closed() || conn.socket.destroyed) return Promise.reject(new Error("connexion fermée par l'imprimante"));
  return new Promise((resolve, reject) => {
    conn.socket.once("error", reject);
    conn.socket.once("close", (hadError) => (hadError ? reject(new Error("connexion coupée")) : resolve()));
    conn.socket.end(data);
  });
}

/**
 * État de l'imprimante (`DLE EOT 1`, `2`, `4`) : hors ligne à cause du capot
 * (bit 0x04 de l'état 2) ou papier épuisé (bits 0x60 de l'état 4). Une
 * imprimante qui ne répond pas est supposée prête.
 */
async function status(conn: Connection): Promise<PrintFailure | null> {
  const ask = async (n: number) => {
    if (conn.closed()) return null;
    conn.drain();
    conn.socket.write(Buffer.from([0x10, 0x04, n]));
    return conn.next(STATUS_WAIT_MS);
  };
  const online = await ask(1);
  if (online === null) return null;
  if (online & 0x08) {
    const cause = await ask(2);
    if (cause !== null && cause & 0x04) return "capot";
  }
  const paper = await ask(4);
  if (paper !== null && (paper & 0x60) === 0x60) return "papier";
  return null;
}

/**
 * Envoie `data` à l'imprimante de `address`, après avoir vérifié son état si
 * `checkStatus` (tickets) ; jamais deux envois en même temps. Ne lève jamais :
 * rend la raison de l'échec.
 */
export async function sendToPrinter(address: string, data: Buffer, options: { checkStatus: boolean }): Promise<PrintOutcome> {
  const target = parseAddress(address);
  if (!target) return { ok: false, reason: "injoignable" };
  let socket: Socket | null = null;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  // Plafond de l'ensemble (connexion, état, envoi) : quoi que fasse l'imprimante, la réponse arrive.
  const ceiling = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error("délai total dépassé")), PRINT_DEADLINE_MS);
  });
  try {
    return await Promise.race([ceiling, (async (): Promise<PrintOutcome> => {
      const conn = await open(target.host, target.port);
      socket = conn.socket;
      if (options.checkStatus) {
        const problem = await status(conn);
        if (problem) { conn.socket.destroy(); return { ok: false, reason: problem }; }
      }
      await writeAndClose(conn, data);
      return { ok: true };
    })()]);
  } catch (error) {
    (socket as Socket | null)?.destroy();
    console.error("Imprimante\u00a0:", error instanceof Error ? error.message : error);
    return { ok: false, reason: "injoignable" };
  } finally {
    clearTimeout(deadline);
  }
}
