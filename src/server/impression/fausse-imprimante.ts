/**
 * Fausse imprimante ESC/POS pour les essais (jamais en production) : écoute
 * un port de 127.0.0.1, répond aux demandes d'état `DLE EOT n` avec les
 * octets réglés (ou se tait), et garde ce qu'elle reçoit d'autre, une entrée
 * par connexion.
 */
import { createServer, type Server, type Socket } from "node:net";

export interface FakePrinter {
  /** Adresse à régler dans `caisse.imprimante` (`127.0.0.1:port`). */
  address: string;
  /** Octets reçus, hors demandes d'état, une entrée par connexion fermée. */
  jobs: Buffer[];
  /** Réponses aux états 1, 2 et 4 ; `null` : l'imprimante ne répond pas. */
  status: { 1: number; 2: number; 4: number } | null;
  /** Bloquée : ne répond plus et ne ferme jamais (essai du délai dépassé). */
  hang: boolean;
  /** Ferme chaque connexion dès qu'elle l'accepte (imprimante occupée par un autre poste). */
  refuse: boolean;
  /** Octets de ticket reçus, même sur une connexion jamais terminée proprement. */
  bytes: number;
  close(): Promise<void>;
}

/** États d'une imprimante prête (relevés sur la NETUM : en ligne 0x16, papier 0x12). */
export const READY = { 1: 0x16, 2: 0x12, 4: 0x12 } as const;
/** Papier épuisé : état 4 avec les bits 0x60. */
export const NO_PAPER = { 1: 0x1e, 2: 0x32, 4: 0x72 } as const;
/** Capot ouvert : hors ligne (0x08), cause capot (0x04). */
export const COVER_OPEN = { 1: 0x1e, 2: 0x16, 4: 0x12 } as const;

export async function startFakePrinter(): Promise<FakePrinter> {
  const sockets = new Set<Socket>();
  const fake: FakePrinter = { address: "", jobs: [], status: { ...READY }, hang: false, refuse: false, bytes: 0, close: async () => undefined };
  // Demi-ouverte : la fausse imprimante ne ferme sa part que quand elle le décide (bloquée : jamais).
  const server: Server = createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    if (fake.refuse) { socket.destroy(); return; }
    const kept: number[] = [];
    let pending: number[] = [];
    socket.on("data", (chunk: Buffer) => {
      if (fake.hang) return;
      pending.push(...chunk);
      // Demandes d'état `10 04 n` : réponse immédiate, jamais gardées avec le ticket.
      while (pending.length) {
        if (pending[0] === 0x10) {
          if (pending.length < 3) break;
          const n = pending[2] as 1 | 2 | 4;
          if (pending[1] === 0x04 && fake.status) socket.write(Buffer.from([fake.status[n] ?? 0x12]));
          pending = pending.slice(3);
          continue;
        }
        kept.push(pending.shift()!);
        fake.bytes += 1;
      }
    });
    // Bloquée (`hang`) : ni réponse ni fermeture, le délai de lama doit trancher.
    socket.on("end", () => { if (fake.hang) return; fake.jobs.push(Buffer.from(kept)); socket.end(); });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  fake.address = `127.0.0.1:${port}`;
  fake.close = () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); });
  return fake;
}
