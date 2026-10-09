import assert from "node:assert/strict";
import { test } from "node:test";
import { shareRequests } from "./partage.ts";

/**
 * Une seule requête pour le même jour demandé par le « + » (monté au démarrage)
 * et « Ma journée » (montée après le chargement initial) du téléphone.
 */

test("deux demandes simultanées de la même adresse : une seule requête, la même réponse", async () => {
  const calls: string[] = [];
  let resolve!: (v: string) => void;
  const get = shareRequests((url: string) => { calls.push(url); return new Promise<string>((r) => { resolve = r; }); }, 5000);
  const a = get("/jour", false);
  const b = get("/jour", true);
  resolve("jour");
  assert.deepEqual(await Promise.all([a, b]), ["jour", "jour"]);
  assert.equal(calls.length, 1);
});

test("écran qui s'ouvre juste après : la réponse de moins de 5 s est reprise ; plus vieille, elle repart au serveur", async () => {
  let now = 1_000;
  const calls: string[] = [];
  const get = shareRequests(async (url: string) => { calls.push(url); return `${url}#${calls.length}`; }, 5000, () => now);
  assert.equal(await get("/jour", true), "/jour#1");
  now += 4_999;
  assert.equal(await get("/jour", true), "/jour#1", "« Ma journée » reprend ce que le « + » vient de recevoir");
  now += 2;
  assert.equal(await get("/jour", true), "/jour#2", "trop ancienne : nouvelle requête");
  assert.equal(await get("/autre", true), "/autre#3", "adresse différente : sa propre requête");
});

test("rechargement demandé (Réessayer, statut changé, signal du serveur) : toujours au serveur, jamais la réponse gardée", async () => {
  const now = 1_000;
  let n = 0;
  const get = shareRequests(async () => `v${++n}`, 5000, () => now);
  assert.equal(await get("/jour", true), "v1");
  assert.equal(await get("/jour", false), "v2");
  assert.equal(await get("/jour", true), "v2", "la réponse la plus récente est gardée");
});

test("échec : rien n'est gardé, la demande suivante repart au serveur", async () => {
  let n = 0;
  const get = shareRequests(async () => { n++; if (n === 1) throw new Error("réseau coupé"); return "ok"; }, 5000);
  const [a, b] = await Promise.allSettled([get("/x", true), get("/x", true)]);
  assert.equal(a.status, "rejected");
  assert.equal(b.status, "rejected");
  assert.equal(await get("/x", true), "ok");
  assert.equal(n, 2);
});
