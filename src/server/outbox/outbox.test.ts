import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB, run } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { clearHandlers, enqueue, enqueueSync, listOutbox, nextDelay, OPENED_BY_HAND, PermanentError, processDue, purgeSent, recoverInterrupted, registerHandler, retry, TemporaryError } from "./outbox.ts";
import { decode } from "../messages.ts";

function fresh() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  clearHandlers();
  return db;
}
const T0 = 1_000_000;

test("délais de nouvel essai", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 20].map(nextDelay), [30e3, 60e3, 120e3, 300e3, 900e3, 1800e3, 3600e3, 3600e3, 3600e3]);
});

test("la clé anti-doublon empêche une double inscription", async () => {
  fresh();
  assert.equal((await enqueue({ kind: "test", payload: {}, dedupeKey: "rappel-1", now: T0 })).created, true);
  assert.equal((await enqueue({ kind: "test", payload: {}, dedupeKey: "rappel-1", now: T0 })).created, false);
  assert.equal((await listOutbox()).length, 1);
});

test("hors ligne, rien ne part ; en ligne, l'envoi réussit", async () => {
  fresh();
  const sent: unknown[] = [];
  registerHandler("test", async (p) => { sent.push(p); });
  await enqueue({ kind: "test", payload: { n: 1 }, dedupeKey: "a", now: T0 });
  assert.equal(await processDue(T0, false), 0);
  assert.equal(sent.length, 0);
  assert.equal(await processDue(T0, true), 1);
  assert.deepEqual(sent, [{ n: 1 }]);
  assert.equal((await listOutbox("sent")).length, 1);
});

test("erreur passagère : nouvel essai différé ; abandon après 24 h", async () => {
  fresh();
  registerHandler("test", async () => { throw new TemporaryError("Réseau indisponible"); });
  await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  await processDue(T0, true);
  let [item] = await listOutbox();
  assert.equal(item.status, "pending");
  assert.equal(item.attempts, 1);
  assert.equal(item.next_attempt_at, T0 + 30e3);
  assert.equal(item.last_error, "Réseau indisponible");
  assert.equal(await processDue(T0 + 10e3, true), 0, "pas avant l'heure");
  await processDue(T0 + 24 * 3600e3 + 1, true);
  [item] = await listOutbox();
  assert.equal(item.status, "failed");
});

test("erreur définitive : échec immédiat ; « Réessayer » relance", async () => {
  fresh();
  let fail = true;
  registerHandler("test", async () => { if (fail) throw new PermanentError("Numéro invalide"); });
  const { id } = await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  await processDue(T0, true);
  assert.equal((await listOutbox("failed"))[0].last_error, "Numéro invalide");
  fail = false;
  assert.equal(await retry(id, T0 + 1), true);
  await processDue(T0 + 1, true);
  assert.equal((await listOutbox("sent")).length, 1);
});

test("type sans gestionnaire : échec clair", async () => {
  fresh();
  await enqueue({ kind: "inconnu", payload: {}, dedupeKey: "a", now: T0 });
  await processDue(T0, true);
  assert.equal(decode("fr", (await listOutbox("failed"))[0].last_error), "Aucun gestionnaire pour ce type d'envoi.");
});

test("après une coupure, les envois « en cours » repartent", async () => {
  const db = fresh();
  await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  db.exec("UPDATE outbox SET status = 'sending'");
  assert.equal(await recoverInterrupted(), 1);
  assert.equal((await listOutbox("pending")).length, 1);
});

test("purge des envois réussis après 90 jours", async () => {
  fresh();
  registerHandler("test", async () => {});
  await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  await processDue(T0, true);
  assert.equal(await purgeSent(T0 + 89 * 86_400_000), 0);
  assert.equal(await purgeSent(T0 + 91 * 86_400_000), 1);
});

test("hors ligne plus de 24 h : à la reprise, l'envoi est abandonné sans jamais appeler le gestionnaire", async () => {
  fresh();
  let called = false;
  registerHandler("test", async () => { called = true; });
  await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  assert.equal(await processDue(T0 + 25 * 3600e3, true), 1);
  assert.equal(called, false);
  const [item] = await listOutbox("failed");
  assert.equal(decode("fr", item.last_error), "Délai de 24\u00a0h dépassé, envoi abandonné.");
});

test("borne exacte de l'abandon : l'essai qui atteint 24 h est replanifié, celui qui la dépasserait échoue", async () => {
  const db = fresh();
  registerHandler("test", async () => { throw new TemporaryError("Réseau indisponible"); });
  await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  // Après 7 essais, le prochain délai est de 1 h : un essai à T0 + 23 h tombe
  // exactement à la limite de 24 h depuis la création → encore replanifié.
  db.exec(`UPDATE outbox SET attempts = 7, next_attempt_at = ${T0 + 23 * 3600e3}`);
  await processDue(T0 + 23 * 3600e3, true);
  let [item] = await listOutbox();
  assert.equal(item.status, "pending");
  assert.equal(item.next_attempt_at, T0 + 24 * 3600e3);
  // Une minute plus tard, le même essai dépasserait 24 h : abandon.
  db.exec(`UPDATE outbox SET attempts = 7, next_attempt_at = ${T0 + 23 * 3600e3 + 60e3}`);
  await processDue(T0 + 23 * 3600e3 + 60e3, true);
  [item] = await listOutbox();
  assert.equal(item.status, "failed");
});

test("charge illisible (JSON invalide) : échec immédiat, gestionnaire jamais appelé", async () => {
  const db = fresh();
  let called = false;
  registerHandler("test", async () => { called = true; });
  await enqueue({ kind: "test", payload: {}, dedupeKey: "a", now: T0 });
  db.exec("UPDATE outbox SET payload = '{invalide'");
  await processDue(T0, true);
  assert.equal(called, false);
  assert.equal(decode("fr", (await listOutbox("failed"))[0].last_error), "La charge n'est pas du JSON valide.");
});

test("« pas avant » : un envoi peut être inscrit pour plus tard (fenêtre de silence), sa fenêtre de 24 h part de l'inscription", async () => {
  fresh();
  const sent: unknown[] = [];
  registerHandler("test", async (p) => { sent.push(p); });
  await enqueue({ kind: "test", payload: { n: 1 }, dedupeKey: "a", now: T0, notBefore: T0 + 3600e3 });
  assert.equal(await processDue(T0 + 3599e3, true), 0);
  assert.equal(await processDue(T0 + 3600e3, true), 1);
  assert.deepEqual(sent, [{ n: 1 }]);
  assert.equal((await listOutbox("sent"))[0].created_at, T0);
});

test("inscription dans une transaction ouverte (enqueueSync) : annulée avec elle", () => {
  const db = fresh();
  const storage = sqliteStorage(db);
  assert.throws(() => storage.transaction!((tx) => {
    enqueueSync(tx, { kind: "test", payload: {}, dedupeKey: "a", now: T0 });
    throw new Error("échec de l'écriture du rendez-vous");
  }));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n, 0);
  assert.deepEqual(storage.transaction!((tx) => enqueueSync(tx, { kind: "test", payload: {}, dedupeKey: "a", now: T0 })).created, true);
  assert.deepEqual(storage.transaction!((tx) => enqueueSync(tx, { kind: "test", payload: {}, dedupeKey: "a", now: T0 })).created, false);
});

test("débit : un type freiné n'expédie qu'un envoi par passage, sans retenir les autres types ni compter d'essai", async () => {
  fresh();
  const order: string[] = [];
  let readyAt = 0;
  registerHandler("lent", async (p: { n: number }, ctx) => { order.push(`lent-${p.n}`); readyAt = ctx.now + 4000; }, undefined, { ready: (now) => now >= readyAt });
  registerHandler("test", async () => { order.push("test"); });
  for (let n = 1; n <= 12; n++) await enqueue({ kind: "lent", payload: { n }, dedupeKey: `l${n}`, now: T0 });
  await enqueue({ kind: "test", payload: {}, dedupeKey: "t", now: T0 + 1 });
  await processDue(T0 + 10, true);
  assert.deepEqual(order, ["lent-1", "test"], "un seul envoi freiné, l'autre type part dans le même passage");
  await processDue(T0 + 2000, true);
  assert.deepEqual(order, ["lent-1", "test"], "pas avant la fin de l'espacement");
  await processDue(T0 + 4010, true);
  assert.deepEqual(order, ["lent-1", "test", "lent-2"]);
  const waiting = (await listOutbox("pending")).filter((i) => i.kind === "lent");
  assert.ok(waiting.every((i) => i.attempts === 0), "attendre son tour n'est pas un essai");
});

test("relance manuelle : jamais un envoi ouvert à la main (« Ouvrir WhatsApp », sous-projet 7 vague 2)", async () => {
  fresh();
  const { id } = await enqueue({ kind: "whatsapp", payload: {}, dedupeKey: "wa:libre:ouvert", now: 0 });
  await run("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ?", [OPENED_BY_HAND, id]);
  assert.equal(await retry(id, 1000), false);
  assert.equal(await processDue(10_000, true), 0, "ni relancé, ni repris par la file");
});

test("retryAt : la relance tombe au plus tôt du délai habituel et de l'heure demandée", async () => {
  fresh();
  const T = 1_000_000_000;
  const seen: number[] = [];
  registerHandler("essai", async (_p, ctx) => {
    seen.push(ctx.createdAt);
    throw new TemporaryError("@envoi.abandon", { retryAt: ctx.now + 10_000 });
  });
  await enqueue({ kind: "essai", payload: {}, dedupeKey: "a", now: T });
  // 4 essais : délais habituels 30 s, 60 s, 120 s, 300 s ; retryAt (10 s) l'emporte à chaque fois.
  let now = T;
  for (let i = 0; i < 4; i++) {
    await processDue(now, true);
    const item = (await listOutbox())[0];
    assert.equal(item.next_attempt_at, now + 10_000);
    now = item.next_attempt_at;
  }
  assert.deepEqual(seen, [T, T, T, T], "createdAt transmis tel quel");
});

test("retryAt plus lointain que le délai habituel : le délai habituel l'emporte ; retryAt passé : relance au prochain passage", async () => {
  fresh();
  const T = 1_000_000_000;
  let retryAt = T + 3600e3;
  registerHandler("essai", async () => { throw new TemporaryError("@envoi.abandon", { retryAt }); });
  await enqueue({ kind: "essai", payload: {}, dedupeKey: "a", now: T });
  await processDue(T, true);
  assert.equal((await listOutbox())[0].next_attempt_at, T + 30e3);
  retryAt = T;
  await processDue(T + 30e3, true);
  assert.equal((await listOutbox())[0].next_attempt_at, T + 30e3);
});

test("hors ligne : seuls les types qui tournent hors ligne passent, avec online = false", async () => {
  fresh();
  const T = 1_000_000_000;
  const calls: [string, boolean][] = [];
  let smsReady = true;
  registerHandler("drive", async (_p, ctx) => { calls.push(["drive", ctx.online]); });
  registerHandler("msg", async (_p, ctx) => { calls.push(["msg", ctx.online]); }, undefined, undefined, { offline: async () => smsReady });
  await enqueue({ kind: "drive", payload: {}, dedupeKey: "d", now: T });
  await enqueue({ kind: "msg", payload: {}, dedupeKey: "m", now: T });
  await processDue(T, false);
  assert.deepEqual(calls, [["msg", false]]);
  smsReady = false;
  await enqueue({ kind: "msg", payload: {}, dedupeKey: "m2", now: T });
  await processDue(T + 1, false);
  assert.deepEqual(calls, [["msg", false]], "fournisseur SMS retiré : plus rien hors ligne");
  await processDue(T + 2, true);
  assert.deepEqual(calls.slice(1).sort(), [["drive", true], ["msg", true]]);
});

test("purge quotidienne (V1-05) : un échec de 91 jours disparaît, un de 89 jours reste ; une attente n'est jamais purgée", async () => {
  const db = fresh();
  registerHandler("test", async () => { throw new PermanentError("refusé"); });
  await enqueue({ kind: "test", payload: {}, dedupeKey: "echec", now: T0 });
  await processDue(T0, true);
  assert.equal((await listOutbox("failed")).length, 1);
  await enqueue({ kind: "test", payload: {}, dedupeKey: "attente", now: T0 + 365 * 86_400_000 });
  db.exec("UPDATE outbox SET next_attempt_at = 0 WHERE dedupe_key = 'attente'");
  assert.equal(await purgeSent(T0 + 89 * 86_400_000), 0);
  assert.equal(await purgeSent(T0 + 91 * 86_400_000), 1);
  assert.deepEqual((await listOutbox()).map((i) => i.dedupe_key), ["attente"]);
});

test("purge quotidienne (V1-05) : un envoi « ignoré » à la main de plus de 90 jours disparaît", async () => {
  const db = fresh();
  await enqueue({ kind: "test", payload: {}, dedupeKey: "ignore", now: T0 });
  db.prepare("UPDATE outbox SET status = 'sent', manual = 'ignored', sent_at = ?").run(T0);
  assert.equal(await purgeSent(T0 + 91 * 86_400_000), 1);
});
