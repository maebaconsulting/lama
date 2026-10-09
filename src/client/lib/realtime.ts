/**
 * Temps réel côté écran (spec § 6) : le serveur envoie un signal sans donnée
 * (`{ resource }`) ; l'écran recharge par l'API, avec ses propres droits, ce
 * que le signal concerne. Sans dépendance au navigateur : `EventSource` et les
 * minuteries sont injectés, pour les tests.
 */

export type RefreshKey =
  | "stats" | "appointments" | "calendar" | "selectedAppointment" | "clients" | "selectedClient"
  | "lookups" | "staff" | "services" | "products" | "selectedProduct" | "outbox" | "settings" | "accounts" | "invoices";

const PLAN: Record<string, RefreshKey[]> = {
  appointments: ["appointments", "calendar", "stats", "selectedAppointment", "selectedClient"],
  blocked_slots: ["calendar"],
  clients: ["clients", "selectedClient", "lookups", "stats"],
  staff: ["staff", "lookups", "stats"],
  services: ["services", "stats"],
  products: ["products", "selectedProduct", "stats"],
  outbox: ["outbox"],
  settings: ["settings"],
  accounts: ["accounts"],
  invoices: ["invoices", "selectedClient"],
};

export const ALL_KEYS: RefreshKey[] = [...new Set(Object.values(PLAN).flat())];

export function refreshPlan(resources: Iterable<string>): RefreshKey[] {
  const keys = new Set<RefreshKey>();
  for (const resource of resources) for (const key of PLAN[resource] ?? []) keys.add(key);
  return [...keys];
}

const DELAYS = [1000, 2000, 5000, 10000];
export function reconnectDelay(attempt: number): number {
  return DELAYS[attempt] ?? 30_000;
}

export interface Timers { set(fn: () => void, ms: number): unknown; clear(id: unknown): void }

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Regroupe les ressources signalées pendant `delayMs` en un seul appel de `flush`. */
export function createBatcher(delayMs: number, flush: (resources: string[]) => void, timers: Timers = realTimers) {
  let pending = new Set<string>();
  let timer: unknown = null;
  return {
    push(resource: string) {
      pending.add(resource);
      if (timer !== null) return;
      timer = timers.set(() => {
        timer = null;
        const batch = [...pending];
        pending = new Set();
        flush(batch);
      }, delayMs);
    },
    cancel() {
      if (timer !== null) timers.clear(timer);
      timer = null;
      pending = new Set();
    },
  };
}

/** Ce que l'on utilise d'un `EventSource`. */
export interface SourceLike {
  addEventListener(type: string, fn: (e: { data?: string }) => void): void;
  close(): void;
  onerror: ((e: unknown) => void) | null;
}

/**
 * Sans rien recevoir pendant ce délai (le serveur envoie un `ping` toutes les
 * 25 s), le flux est tenu pour mort : un serveur privé de courant ne ferme pas
 * la connexion, et le navigateur peut mettre longtemps à s'en apercevoir.
 */
export const SILENCE_MS = 60_000;

/**
 * Connexion vivante au flux : regroupe les signaux, se reconnecte avec des
 * délais croissants après une coupure (ou après `SILENCE_MS` sans signal de
 * vie), vérifie la session avant de se reconnecter (un 401 prévient la porte
 * d'entrée) et, au retour, demande un rechargement complet (des signaux ont pu
 * être perdus pendant la coupure).
 */
export function createLiveConnection(o: {
  open: () => SourceLike;
  onKeys: (keys: RefreshKey[]) => void;
  check: () => Promise<unknown>;
  /** Le serveur passe en maintenance : diffusé tout de suite par le flux, avant sa coupure. */
  onMaintenance?: () => void;
  timers?: Timers;
  batchMs?: number;
}): { close(): void } {
  const timers = o.timers ?? realTimers;
  let source: SourceLike | null = null;
  let closed = false;
  let lost = false;
  let attempt = 0;
  let retry: unknown = null;
  let silence: unknown = null;
  const batcher = createBatcher(o.batchMs ?? 200, (resources) => {
    const keys = refreshPlan(resources);
    if (keys.length) o.onKeys(keys);
  }, timers);

  const stopSilence = () => {
    if (silence !== null) timers.clear(silence);
    silence = null;
  };

  const lose = (s: SourceLike) => {
    s.close();
    // Une ancienne connexion déjà remplacée ne relance rien.
    if (source !== s) return;
    stopSilence();
    source = null;
    if (closed) return;
    lost = true;
    retry = timers.set(() => {
      retry = null;
      void o.check().catch(() => undefined).then(connect);
    }, reconnectDelay(attempt++));
  };

  const connect = () => {
    if (closed) return;
    const s = o.open();
    source = s;
    // Réarmée à chaque signal reçu ; à échéance, même traitement qu'une coupure.
    const alive = () => {
      if (source !== s) return;
      stopSilence();
      silence = timers.set(() => { silence = null; lose(s); }, SILENCE_MS);
    };
    alive();
    s.addEventListener("ping", alive);
    s.addEventListener("ready", () => {
      alive();
      attempt = 0;
      if (lost) { lost = false; o.onKeys(ALL_KEYS); }
    });
    s.addEventListener("change", (e) => {
      alive();
      try {
        const { resource } = JSON.parse(e.data ?? "") as { resource?: unknown };
        if (typeof resource === "string") batcher.push(resource);
      } catch {
        // Signal illisible : ignoré, le prochain rechargement complet rattrapera.
      }
    });
    s.addEventListener("maintenance", () => o.onMaintenance?.());
    s.onerror = () => lose(s);
  };

  connect();
  return {
    close() {
      closed = true;
      stopSilence();
      batcher.cancel();
      if (retry !== null) timers.clear(retry);
      retry = null;
      source?.close();
      source = null;
    },
  };
}
