import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_KEYS, createLiveConnection, reconnectDelay, refreshPlan, type RefreshKey, type SourceLike, type Timers } from "./realtime.ts";

class FakeSource implements SourceLike {
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data?: string) { for (const fn of this.listeners.get(type) ?? []) fn({ data }); }
  fail() { this.onerror?.(new Event("error")); }
  close() { this.closed = true; }
}

function fakeTimers() {
  let seq = 0;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timers: Timers & { pending: typeof pending; run(ms?: number): void; delays(): number[] } = {
    set(fn, ms) { pending.set(++seq, { fn, ms }); return seq; },
    clear(id) { pending.delete(id as number); },
    pending,
    /** Déclenche les minuteries en attente, ou seulement celles du délai donné. */
    run(ms?: number) {
      const due = [...pending].filter(([, t]) => ms === undefined || t.ms === ms);
      for (const [id] of due) pending.delete(id);
      for (const [, t] of due) t.fn();
    },
    delays() { return [...pending.values()].map((t) => t.ms).sort((a, b) => a - b); },
  };
  return timers;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(check: () => Promise<unknown> = async () => undefined) {
  const sources: FakeSource[] = [];
  const received: RefreshKey[][] = [];
  const timers = fakeTimers();
  let checks = 0;
  let maintenances = 0;
  const live = createLiveConnection({
    open: () => { const s = new FakeSource(); sources.push(s); return s; },
    onKeys: (keys) => received.push(keys),
    check: () => { checks++; return check(); },
    onMaintenance: () => { maintenances++; },
    timers,
  });
  return { sources, received, timers, live, checks: () => checks, maintenances: () => maintenances };
}

test("plan de rechargement : chaque ressource vers ce qu'elle touche", () => {
  assert.deepEqual(refreshPlan(["blocked_slots"]), ["calendar"]);
  assert.deepEqual(new Set(refreshPlan(["appointments", "blocked_slots"])), new Set(["appointments", "calendar", "stats", "selectedAppointment", "selectedClient"]));
  assert.deepEqual(refreshPlan(["inconnue"]), []);
  // Vague 4 : la fiche d'un produit ouverte dans le panneau suit son stock (réception qui vend au comptoir).
  assert.deepEqual(new Set(refreshPlan(["products"])), new Set(["products", "selectedProduct", "stats"]));
  // Mini CRM : une vente sans rendez-vous ou un avoir change le total, le panier moyen et les achats de la fiche ouverte.
  assert.deepEqual(new Set(refreshPlan(["invoices"])), new Set(["invoices", "selectedClient"]));
  for (const key of ["outbox", "settings", "accounts", "lookups"] as const) assert.ok(ALL_KEYS.includes(key));
});

test("délais de reconnexion croissants, plafonnés à 30 s", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(reconnectDelay), [1000, 2000, 5000, 10000, 30000, 30000]);
});

test("les signaux rapprochés sont regroupés en un seul rechargement", () => {
  const { sources, received, timers } = setup();
  sources[0].emit("ready", "{}");
  sources[0].emit("change", '{"resource":"appointments"}');
  sources[0].emit("change", '{"resource":"clients"}');
  sources[0].emit("change", "illisible");
  sources[0].emit("change", '{"resource":"inconnue"}');
  assert.equal(received.length, 0);
  timers.run(200);
  assert.equal(received.length, 1);
  assert.ok(received[0].includes("appointments") && received[0].includes("clients"));
});

test("coupure : reconnexion après 1 s, vérification de session, puis rechargement complet", async () => {
  const { sources, received, timers, checks } = setup();
  sources[0].emit("ready", "{}");
  sources[0].fail();
  assert.equal(sources[0].closed, true);
  assert.deepEqual(timers.delays(), [1000]);
  timers.run();
  await tick();
  assert.equal(checks(), 1);
  assert.equal(sources.length, 2);
  sources[1].emit("ready", "{}");
  assert.deepEqual(received, [ALL_KEYS]);
});

test("échecs répétés : 1 s, 2 s, 5 s ; une reconnexion réussie remet le compteur à zéro", async () => {
  const { sources, timers } = setup();
  const delays: number[] = [];
  for (let i = 0; i < 3; i++) {
    sources[sources.length - 1].fail();
    delays.push([...timers.pending.values()][0].ms);
    timers.run();
    await tick();
  }
  assert.deepEqual(delays, [1000, 2000, 5000]);
  sources[sources.length - 1].emit("ready", "{}");
  sources[sources.length - 1].fail();
  assert.equal([...timers.pending.values()][0].ms, 1000);
});

test("signal de maintenance : le flux le transmet directement, sans passer par les clés de rechargement", () => {
  const { sources, received, maintenances } = setup();
  sources[0].emit("ready", "{}");
  sources[0].emit("maintenance", "{}");
  assert.equal(maintenances(), 1);
  assert.equal(received.length, 0);
});

test("fermeture : plus de reconnexion ni de rechargement", async () => {
  const { sources, received, timers, live } = setup();
  sources[0].emit("change", '{"resource":"staff"}');
  sources[0].fail();
  live.close();
  assert.equal(timers.pending.size, 0);
  await tick();
  assert.equal(sources.length, 1);
  assert.deepEqual(received, []);
});

test("signal de vie : 60 s sans rien recevoir, le flux est fermé puis relancé comme après une coupure (M5)", async () => {
  const { sources, received, timers } = setup();
  sources[0].emit("ready", "{}");
  assert.deepEqual(timers.delays(), [60_000]);
  timers.run(60_000);
  assert.equal(sources[0].closed, true);
  assert.deepEqual(timers.delays(), [1000]);
  timers.run(1000);
  await tick();
  assert.equal(sources.length, 2);
  sources[1].emit("ready", "{}");
  assert.deepEqual(received, [ALL_KEYS]);
});

test("signal de vie : ping, change et ready réarment la minuterie de 60 s (M5)", () => {
  const { sources, timers } = setup();
  const minuterie = () => [...timers.pending].filter(([, t]) => t.ms === 60_000).map(([id]) => id);
  const depart = minuterie();
  assert.equal(depart.length, 1, "minuterie armée dès l'ouverture");
  let precedente = depart[0];
  for (const [type, data] of [["ready", "{}"], ["ping", "{}"], ["change", '{"resource":"staff"}']]) {
    sources[0].emit(type, data);
    const actuelle = minuterie();
    assert.equal(actuelle.length, 1, type);
    assert.notEqual(actuelle[0], precedente, `${type} doit réarmer la minuterie`);
    precedente = actuelle[0];
  }
  assert.equal(sources[0].closed, false);
});

test("signal de vie : aucune minuterie ne reste après la fermeture", () => {
  const { timers, live } = setup();
  live.close();
  assert.equal(timers.pending.size, 0);
});

test("fermeture pendant la vérification de session : aucune reconnexion ensuite", async () => {
  let repondre!: () => void;
  const { sources, timers, live } = setup(() => new Promise<void>((r) => { repondre = r; }));
  sources[0].fail();
  timers.run(1000);
  live.close();
  repondre();
  await tick();
  assert.equal(sources.length, 1);
  assert.equal(timers.pending.size, 0);
});

test("session refusée (401) pendant la vérification : pas d'erreur non rattrapée, la porte d'entrée prend le relais", async () => {
  const { sources, timers, checks } = setup(() => Promise.reject(Object.assign(new Error("Non connecté"), { status: 401 })));
  sources[0].fail();
  timers.run(1000);
  await tick();
  await tick();
  assert.equal(checks(), 1);
  // Le refus est rattrapé ; la reconnexion reste tentée (l'écran d'entrée
  // démonte l'app et ferme alors la connexion, voir use-realtime.ts).
  assert.equal(sources.length, 2);
});
