import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

test("la réception voit la file ; la praticienne non", async (t) => {
  const ctx = await setupApp(t);
  ctx.db.exec(`INSERT INTO outbox (kind, payload, dedupe_key, status, next_attempt_at, created_at, last_error)
               VALUES ('test', '{}', 'a', 'failed', 0, 0, 'Numéro invalide')`);
  const reception = await ctx.as("reception");
  const list = await reception("GET", "/api/outbox?status=failed");
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].last_error, "Numéro invalide");
  assert.equal((await reception("POST", `/api/outbox/${list.body.items[0].id}/retry`)).status, 200);
  assert.equal((await (await ctx.as("practitioner"))("GET", "/api/outbox")).status, 403);
});

test("la raison d'un échec stockée codée est rendue dans la langue de l'écran", async (t) => {
  const ctx = await setupApp(t);
  ctx.db.exec(`INSERT INTO outbox (kind, payload, dedupe_key, status, next_attempt_at, created_at, last_error)
               VALUES ('test', '{}', 'b', 'failed', 0, 0, '@envoi.abandon')`);
  const reception = await ctx.as("reception");
  assert.equal((await reception("GET", "/api/outbox?status=failed", undefined, { "Accept-Language": "fr" })).body.items[0].last_error, "Délai de 24\u00a0h dépassé, envoi abandonné.");
  assert.equal((await reception("GET", "/api/outbox?status=failed")).body.items[0].last_error, "24-hour limit reached, item abandoned.");
});

test("la file ne renvoie jamais le contenu : ni texte ni numéro, seulement les clés de suivi (sous-projet 7 § 1)", async (t) => {
  const ctx = await setupApp(t);
  ctx.db.exec(`INSERT INTO outbox (kind, payload, dedupe_key, status, next_attempt_at, created_at)
               VALUES ('whatsapp', '{"to":"237699000001","text":"Bonjour Aïcha"}', 'wa:libre:1', 'pending', 0, 0)`);
  for (const role of ["admin", "manager", "reception"] as const) {
    const reply = await (await ctx.as(role))("GET", "/api/outbox");
    assert.equal(reply.status, 200);
    assert.deepEqual(Object.keys(reply.body.items[0]).sort(), ["attempts", "created_at", "id", "kind", "last_error", "manual", "next_attempt_at", "sent_at", "status"]);
    assert.doesNotMatch(JSON.stringify(reply.body), /Aïcha|237699000001/);
  }
});
