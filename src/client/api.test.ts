import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { api, ApiError, setApiLang } from "./api.ts";
import { onSessionSignal } from "./lib/session-bus.ts";

function stubFetch(t: TestContext, impl: (url: string, init: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
}

function listen(t: TestContext): string[] {
  const seen: string[] = [];
  t.after(onSessionSignal((s) => seen.push(s)));
  return seen;
}

test("api() ajoute X-Lama sur une modification et renvoie le JSON", async (t) => {
  const inits: RequestInit[] = [];
  stubFetch(t, async (_url, init) => { inits.push(init); return new Response('{"ok":true}', { status: 200 }); });
  assert.deepEqual(await api("POST", "/api/auth/logout"), { ok: true });
  assert.equal((inits[0].headers as Record<string, string>)["X-Lama"], "1");
});

test("serveur injoignable : erreur « reseau » en français, aucun signal", async (t) => {
  stubFetch(t, async () => { throw new TypeError("Failed to fetch"); });
  const seen = listen(t);
  await assert.rejects(api("GET", "/api/auth/state"), (e: unknown) =>
    e instanceof ApiError && e.code === "reseau" && e.status === 0 && /injoignable/.test(e.message));
  assert.deepEqual(seen, []);
});

test("session perdue, poste verrouillé, maintenance : la porte d'entrée est prévenue", async (t) => {
  const replies = [
    [401, '{"error":"Connexion requise.","code":"connexion"}'],
    [401, '{"error":"Poste verrouillé.","code":"verrouille"}'],
    [503, '{"error":"Maintenance en cours, réessayez dans un instant.","code":"maintenance"}'],
    [401, '{"error":"Identifiant ou mot de passe incorrect."}'],
  ] as const;
  let i = 0;
  stubFetch(t, async () => { const [status, body] = replies[i++]; return new Response(body, { status }); });
  const seen = listen(t);
  for (let n = 0; n < replies.length; n++) await assert.rejects(api("GET", "/api/stats"), ApiError);
  assert.deepEqual(seen, ["connexion", "verrouille", "maintenance"]);
});

test("api() envoie la langue de l'écran et traduit « serveur injoignable »", async (t) => {
  const inits: RequestInit[] = [];
  stubFetch(t, async (_url, init) => { inits.push(init); throw new TypeError("Failed to fetch"); });
  setApiLang("en");
  t.after(() => setApiLang("fr"));
  await assert.rejects(api("GET", "/api/stats"), (e: unknown) => e instanceof ApiError && /unreachable/.test(e.message));
  assert.equal((inits[0].headers as Record<string, string>)["Accept-Language"], "en");
});
