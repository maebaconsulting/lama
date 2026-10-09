import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { api } from "../api.ts";
import { noterJoignable, onJoignable, oublierJoignablePourEssai, reessayer, serveurJoignable } from "./joignable.ts";

/** Serveur injoignable (PWA, P-04) : état tenu par chaque réponse de l'API, bandeau et « Réessayer ». */
beforeEach(() => oublierJoignablePourEssai());

test("joignable : un changement prévient les abonnés une fois, une répétition jamais", () => {
  const vus: boolean[] = [];
  const fin = onJoignable((j) => vus.push(j));
  noterJoignable(true);
  noterJoignable(false);
  noterJoignable(false);
  noterJoignable(true);
  fin();
  noterJoignable(false);
  assert.deepEqual(vus, [false, true]);
  assert.equal(serveurJoignable(), false);
});

test("api() : un échec réseau rend le serveur injoignable, la réponse suivante (même un refus) le rend joignable", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  await assert.rejects(api("GET", "/api/stats"));
  assert.equal(serveurJoignable(), false);
  globalThis.fetch = (async () => new Response('{"error":"Accès refusé."}', { status: 403 })) as typeof fetch;
  await assert.rejects(api("GET", "/api/stats"));
  assert.equal(serveurJoignable(), true, "le serveur a répondu : il est joignable");
});

test("« Réessayer » : relit tout si le serveur répond, rien sinon", async () => {
  let relus = 0;
  assert.equal(await reessayer(async () => { throw new Error("injoignable"); }, () => { relus++; }), false);
  assert.equal(relus, 0);
  assert.equal(await reessayer(async () => ({}), () => { relus++; }), true);
  assert.equal(relus, 1);
});

test("écran : bandeau « Serveur injoignable » en tête, avec « Réessayer » ; l'écran d'entrée garde le sien", () => {
  const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
  const bandeaux = lire("../components/bandeaux.tsx");
  assert.match(bandeaux, /<>\s*<BandeauInjoignable \/>/);
  assert.match(bandeaux, /reessayer\(\(\) => api\("GET", "\/api\/auth\/state"\), \(\) => emitRefresh\(ALL_KEYS\)\)/);
  assert.match(bandeaux, /\{t\("etat\.reessayer"\)\}/);
  assert.match(lire("../components/auth/porte.tsx"), /case "injoignable": return <Injoignable onRetry=\{gate\.reload\} refus=\{gate\.refus\} \/>;/);
});

test("bandeaux : l'état courant est relu juste après l'abonnement (changement tombé entre le rendu et l'effet)", () => {
  const bandeaux = readFileSync(new URL("../components/bandeaux.tsx", import.meta.url), "utf8");
  assert.match(bandeaux, /const fin = onNouvelleVersion\(setVisible\);[^}]*setVisible\(nouvelleVersionVisible\(\)\);\s*return fin;/);
  assert.match(bandeaux, /const fin = onJoignable\(setJoignable\);\s*setJoignable\(serveurJoignable\(\)\);\s*return fin;/);
});
