import type { Context, Next } from "hono";
import { streamSSE } from "hono/streaming";
import type { OpenAPIHono } from "@hono/zod-openapi";

export type Change = { resource: string };
const listeners = new Set<(change: Change) => void>();

export function publish(change: Change): void {
  for (const listener of listeners) listener(change);
}

export function subscribe(fn: (change: Change) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Diffusion à part de `publish`/`subscribe` : la maintenance doit atteindre
// tout de suite chaque écran ouvert (avant l'arrêt du serveur, 500 ms plus
// tard), sans passer par la file d'attente ni le regroupement des `Change`.
const maintenanceListeners = new Set<() => void>();

export function publishMaintenance(): void {
  for (const listener of maintenanceListeners) listener();
}

export function subscribeMaintenance(fn: () => void): () => void {
  maintenanceListeners.add(fn);
  return () => maintenanceListeners.delete(fn);
}

const RESOURCES: Record<string, string> = {
  appointments: "appointments", notes: "appointments", "blocked-slots": "blocked_slots", clients: "clients",
  staff: "staff", services: "services", products: "products", outbox: "outbox", settings: "settings",
  accounts: "accounts", devices: "accounts", sales: "invoices", "credit-notes": "invoices", cash: "invoices", deposits: "invoices",
  whatsapp: "outbox", campaigns: "outbox", transfers: "appointments",
  // Sauvegarde lancée à la main : l'état des sauvegardes (bandeau des 36 h, rubrique Sauvegardes) suit « outbox ».
  backups: "outbox",
};

export function resourceFor(path: string): string | null {
  // Envoi WhatsApp lié à une fiche : il alimente la file, pas la fiche.
  if (/^\/api\/(clients|products)\/[^/]+\/whatsapp\/?$/.test(path)) return "outbox";
  const segment = /^\/api\/([^/]+)/.exec(path)?.[1];
  return segment ? RESOURCES[segment] ?? null : null;
}

const HEARTBEAT_MS = 25_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installRealtime(app: OpenAPIHono<any>): void {
  app.use("/api/*", async (c: Context, next: Next) => {
    await next();
    if (c.req.method === "GET" || c.res.status >= 400) return;
    const resource = resourceFor(c.req.path);
    if (resource) publish({ resource });
  });

  app.get("/api/events", (c) => streamSSE(c, async (stream) => {
    const queue: Change[] = [];
    let wake: (() => void) | null = null;
    // Minuterie du signal de vie : toujours annulée dès que l'attente se termine
    // (changement ou expiration), pour qu'aucune minuterie de 25 s ne reste
    // pendante après la fermeture du flux (le test du démarrage ne doit pas
    // rester vivant).
    let heartbeat: ReturnType<typeof setTimeout> | null = null;
    const off = subscribe((change) => {
      queue.push(change);
      if (wake) { const w = wake; wake = null; w(); }
    });
    // Écrite tout de suite (pas mise en file) : la maintenance ne doit pas
    // attendre le prochain passage de la boucle ci-dessous.
    const offMaintenance = subscribeMaintenance(() => {
      void stream.writeSSE({ event: "maintenance", data: "{}" });
    });
    stream.onAbort(() => {
      off();
      offMaintenance();
      if (heartbeat) { clearTimeout(heartbeat); heartbeat = null; }
      if (wake) { const w = wake; wake = null; w(); }
    });
    await stream.writeSSE({ event: "ready", data: "{}" });
    while (!stream.aborted) {
      if (!queue.length) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          heartbeat = setTimeout(resolve, HEARTBEAT_MS);
          heartbeat.unref?.();
        });
        if (heartbeat) { clearTimeout(heartbeat); heartbeat = null; }
      }
      wake = null;
      if (stream.aborted) break;
      const change = queue.shift();
      await stream.writeSSE(change ? { event: "change", data: JSON.stringify(change) } : { event: "ping", data: "{}" });
    }
    off();
    offMaintenance();
  }));
}
