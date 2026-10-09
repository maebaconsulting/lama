import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

test("/api/llms.txt : liste des routes pour un compte connecté, refusée sans session (décision 14)", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("manager", "aicha");
  assert.equal((await ctx.anonymous()("GET", "/api/llms.txt")).status, 401);
  const praticienne = await ctx.as("practitioner");
  assert.equal((await praticienne("GET", "/api/llms.txt")).status, 200, "tout compte connecté, comme /api/openapi.json");
  const gerante = await ctx.as("manager");
  const res = await gerante("GET", "/api/llms.txt");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
  assert.equal(typeof res.body, "string");
  assert.match(res.body, /^# lama$/m);
  assert.match(res.body, /`GET \/api\/appointments`/);
  assert.match(res.body, /`POST \/api\/appointments`/);
  assert.doesNotMatch(res.body, /\u2014/, "jamais de tiret cadratin dans le texte servi");
});

test("description OpenAPI réécrite pour lama : plus la formule d'OpenSalon", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const res = await gerante("GET", "/api/openapi.json");
  assert.equal(res.status, 200);
  const description: string = res.body.info.description;
  assert.match(description, /^lama: /);
  assert.match(description, /beauty institute\b/);
  assert.match(description, /Accept-Language: fr/);
  assert.doesNotMatch(description, /institutes|in Africa|by lama/);
});
