import assert from "node:assert/strict";
import { test } from "node:test";
import { publishMaintenance, resourceFor, subscribeMaintenance } from "./realtime.ts";
import { setupApp } from "./test-support.ts";

test("chaque chemin modifié désigne une ressource", () => {
  assert.equal(resourceFor("/api/appointments/3"), "appointments");
  assert.equal(resourceFor("/api/notes/4"), "appointments");
  assert.equal(resourceFor("/api/blocked-slots"), "blocked_slots");
  assert.equal(resourceFor("/api/clients/2"), "clients");
  assert.equal(resourceFor("/api/outbox/1/retry"), "outbox");
  assert.equal(resourceFor("/api/auth/login"), null);
});

test("l'envoi WhatsApp d'un produit ou à une cliente publie la file (outbox), pas la fiche", () => {
  assert.equal(resourceFor("/api/products/5/whatsapp"), "outbox");
  assert.equal(resourceFor("/api/clients/2/whatsapp"), "outbox");
  assert.equal(resourceFor("/api/products/5"), "products");
  assert.equal(resourceFor("/api/products/5/image"), "products");
  assert.equal(resourceFor("/api/clients/2"), "clients");
});

test("« Sauvegarder maintenant » publie la file (outbox) : le bandeau des 36 h se relit sans recharger la page", () => {
  assert.equal(resourceFor("/api/backups/run"), "outbox");
});

async function readEvents(res: Response, until: (events: { event: string; data: string }[]) => boolean, timeoutMs = 2000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: { event: string; data: string }[] = [];
  let buffer = "";
  const deadline = Date.now() + timeoutMs;
  while (!until(events) && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now())),
    ]);
    if (done || !value) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? "message";
      const data = /^data: (.*)$/m.exec(block)?.[1] ?? "";
      events.push({ event, data });
    }
  }
  await reader.cancel();
  return events;
}

test("une modification est signalée aux autres écrans en moins de 2 secondes, sans donnée", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("practitioner");
  const reception = await ctx.as("reception");
  const login = await ctx.raw("POST", "/api/auth/login", { login: "practitioner", password: "mot-de-passe-test" }, { "X-Lama": "1" });
  const session = login.headers.getSetCookie().find((c) => c.startsWith("lama_session="))!.split(";")[0];
  const stream = await ctx.app.request("/api/events", { headers: { cookie: session } }, ctx.env);
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
  const started = Date.now();
  setTimeout(() => void reception("POST", "/api/clients", { name: "Ngozi Tabi", phone: "6 77 12 34 04" }), 50);
  const events = await readEvents(stream, (evs) => evs.some((e) => e.event === "change"));
  const change = events.find((e) => e.event === "change");
  assert.ok(change, "signal reçu");
  assert.ok(Date.now() - started < 2000);
  assert.deepEqual(JSON.parse(change!.data), { resource: "clients" });
});

test("sans session, pas de flux", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("manager");
  assert.equal((await ctx.anonymous()("GET", "/api/events")).status, 401);
});

test("publishMaintenance() : tout abonné est notifié, l'abonnement se résilie", () => {
  let calls = 0;
  const off = subscribeMaintenance(() => { calls++; });
  publishMaintenance();
  assert.equal(calls, 1);
  off();
  publishMaintenance();
  assert.equal(calls, 1);
});

test("un transfert de rendez-vous publie les rendez-vous (agenda et listes rechargés partout)", () => {
  assert.equal(resourceFor("/api/transfers"), "appointments");
});
