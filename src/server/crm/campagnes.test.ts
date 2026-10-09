import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { resourceFor } from "../realtime.ts";

/** Cinq clientes : deux joignables « VIP » (WhatsApp, SMS en anglais), une sans numéro, une en « Aucun », une « Mariée ». */
async function withClients(t: { after: (fn: () => void) => void }, now?: number) {
  const ctx = await setupApp(t, { demo: false });
  if (now !== undefined) ctx.clock.now = now;
  ctx.db.exec(`INSERT INTO clients (id, name, phone, channel, language) VALUES
      (1, 'Aïcha Mbarga', '699123456', 'whatsapp', ''),
      (2, 'Brenda Ngo', '699000002', 'sms', 'en'),
      (3, 'Carine Eto', '', 'whatsapp', ''),
      (4, 'Diane Abena', '699000004', 'none', ''),
      (5, 'Estelle Ndi', '699000005', 'whatsapp', '');
    INSERT INTO client_tags (client_id, tag, tag_key) VALUES (1, 'VIP', 'vip'), (2, 'VIP', 'vip'), (3, 'VIP', 'vip'), (4, 'VIP', 'vip'), (5, 'Mariée', 'mariee');
    INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', '"Institut Ébène"', 0, 0), ('institut.telephone', '"699 00 00 00"', 0, 0);`);
  return { ctx, gerante: await ctx.as("manager") };
}

const count = (ctx: Awaited<ReturnType<typeof setupApp>>, table: string) => (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

test("aperçu : destinataires et exclues (sans numéro, en « Aucun »), étiquette sans accents ni majuscules", async (t) => {
  const { gerante } = await withClients(t);
  assert.deepEqual((await gerante("GET", "/api/campaigns/preview?tag=vip")).body, { recipients: 2, excluded: 2 });
  assert.deepEqual((await gerante("GET", `/api/campaigns/preview?tag=${encodeURIComponent(" MARIÉE ")}`)).body, { recipients: 1, excluded: 0 });
  assert.deepEqual((await gerante("GET", "/api/campaigns/preview?tag=inconnue")).body, { recipients: 0, excluded: 0 });
  const missing = await gerante("GET", "/api/campaigns/preview", undefined, { "Accept-Language": "fr" });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, "Choisissez une étiquette\u00a0: une campagne s'adresse aux clientes d'une étiquette.");
});

test("envoi : un message par destinataire dans sa langue, clé par campagne et par cliente, journal sans le texte", async (t) => {
  const { ctx, gerante } = await withClients(t);
  const created = await gerante("POST", "/api/campaigns", { tag: "vip", text_fr: " Bonjour {prenom}, nouveautés chez {institut}. ", text_en: "Hello {prenom}, news at {institut}." });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { id: 1, tag: "VIP", recipients: 2, excluded: 2 });
  const rows = ctx.db.prepare("SELECT dedupe_key, payload, next_attempt_at, created_by FROM outbox ORDER BY dedupe_key").all() as { dedupe_key: string; payload: string; next_attempt_at: number; created_by: number }[];
  assert.deepEqual(rows.map((r) => r.dedupe_key), ["wa:campagne:1:1", "wa:campagne:1:2"]);
  assert.deepEqual(rows.map((r) => [JSON.parse(r.payload).lang, JSON.parse(r.payload).text]), [
    ["fr", "Bonjour Aïcha, nouveautés chez Institut Ébène."],
    ["en", "Hello Brenda, news at Institut Ébène."],
  ]);
  assert.deepEqual(JSON.parse(rows[0].payload).origin, { type: "campagne", clientId: 1, campaignId: 1 });
  assert.equal(JSON.parse(rows[0].payload).to, "237699123456");
  assert.equal(rows[0].next_attempt_at, ctx.clock.now, "hors silence : tout de suite");
  assert.ok(rows.every((r) => r.created_by !== null));
  const campaign = ctx.db.prepare("SELECT tag, text_fr, text_en, recipients, excluded, created_at FROM campaigns").get() as Record<string, unknown>;
  assert.deepEqual({ ...campaign }, { tag: "VIP", text_fr: "Bonjour {prenom}, nouveautés chez {institut}.", text_en: "Hello {prenom}, news at {institut}.", recipients: 2, excluded: 2, created_at: ctx.clock.now });
  const audit = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'campagne.envoyee'").all() as { target: string }[];
  assert.deepEqual(audit.map((a) => a.target), ["VIP"]);
});

test("texte anglais facultatif : le français pour tout le monde ; départ à la fin du silence", async (t) => {
  const { ctx, gerante } = await withClients(t, Date.parse("2026-09-28T21:30:00Z")); // 22:30 à Douala
  assert.equal((await gerante("POST", "/api/campaigns", { tag: "VIP", text_fr: "Bonsoir {prenom}." })).status, 201);
  const rows = ctx.db.prepare("SELECT payload, next_attempt_at FROM outbox ORDER BY dedupe_key").all() as { payload: string; next_attempt_at: number }[];
  assert.deepEqual(rows.map((r) => [JSON.parse(r.payload).lang, JSON.parse(r.payload).text]), [["fr", "Bonsoir Aïcha."], ["fr", "Bonsoir Brenda."]]);
  assert.ok(rows.every((r) => r.next_attempt_at === Date.parse("2026-09-29T07:00:00Z")), "08:00 à Douala");
});

test("refus : étiquette absente, texte français vide ou à variable inconnue, aucune destinataire ; rien n'est inscrit", async (t) => {
  const { ctx, gerante } = await withClients(t);
  const fr = { "Accept-Language": "fr" };
  assert.equal((await gerante("POST", "/api/campaigns", { text_fr: "Bonjour" }, fr)).status, 400);
  const empty = await gerante("POST", "/api/campaigns", { tag: "VIP", text_fr: "   " }, fr);
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, "Le texte du message est vide.");
  const unknown = await gerante("POST", "/api/campaigns", { tag: "VIP", text_fr: "Votre rendez-vous du {date}" }, fr);
  assert.match(unknown.body.error, /^Variable inconnue\u00a0: \{date\}\./);
  const badEn = await gerante("POST", "/api/campaigns", { tag: "VIP", text_fr: "Bonjour", text_en: "Hello {produit}" }, fr);
  assert.match(badEn.body.error, /^Variable inconnue\u00a0: \{produit\}\./);
  const nobody = await gerante("POST", "/api/campaigns", { tag: "inconnue", text_fr: "Bonjour" }, fr);
  assert.equal(nobody.status, 400);
  assert.match(nobody.body.error, /^Aucune cliente de cette étiquette/);
  assert.equal(count(ctx, "campaigns"), 0);
  assert.equal(count(ctx, "outbox"), 0);
});

test("liste : vingt dernières, la plus récente d'abord, envois partis, en attente et à la main comptés dans la file", async (t) => {
  const { ctx, gerante } = await withClients(t);
  assert.equal((await gerante("POST", "/api/campaigns", { tag: "VIP", text_fr: "Bonjour {prenom}." })).status, 201);
  ctx.db.exec("UPDATE outbox SET status = 'sent', sent_at = 1 WHERE dedupe_key = 'wa:campagne:1:1'; UPDATE outbox SET status = 'failed' WHERE dedupe_key = 'wa:campagne:1:2'");
  let list = (await gerante("GET", "/api/campaigns")).body.campaigns as { id: number; tag: string; sent: number; pending: number; manual: number }[];
  assert.deepEqual(list.map((c) => [c.id, c.tag, c.sent, c.pending, c.manual]), [[1, "VIP", 1, 0, 1]]);
  ctx.db.exec("UPDATE outbox SET status = 'sent', manual = 'ignored' WHERE dedupe_key = 'wa:campagne:1:2'");
  list = (await gerante("GET", "/api/campaigns")).body.campaigns;
  assert.deepEqual([list[0].sent, list[0].pending, list[0].manual], [1, 0, 0], "ignoré : ni parti ni à la main");
  const insert = ctx.db.prepare("INSERT INTO campaigns (tag, text_fr, recipients, excluded, created_at) VALUES ('Ancienne', 'Bonjour', 1, 0, ?)");
  for (let i = 0; i < 20; i++) insert.run(ctx.clock.now + 1000 + i);
  list = (await gerante("GET", "/api/campaigns")).body.campaigns;
  assert.equal(list.length, 20);
  assert.equal(list[0].id, 21, "la plus récente d'abord");
  assert.ok(!list.some((c) => c.id === 1), "la première est sortie des vingt dernières");
});

test("droits : campagnes à la gérante seulement ; l'envoi prévient les écrans de la file", async (t) => {
  const { ctx } = await withClients(t);
  for (const role of ["reception", "practitioner", "admin"] as const) {
    const caller = await ctx.as(role);
    assert.equal((await caller("GET", "/api/campaigns/preview?tag=VIP")).status, 403, role);
    assert.equal((await caller("GET", "/api/campaigns")).status, 403, role);
    assert.equal((await caller("POST", "/api/campaigns", { tag: "VIP", text_fr: "Bonjour" })).status, 403, role);
  }
  assert.equal(count(ctx, "outbox"), 0);
  assert.equal(resourceFor("/api/campaigns"), "outbox");
});

test("double envoi : la même demande rejouée en moins d'une minute ne réécrit pas aux clientes", async (t) => {
  const { ctx, gerante } = await withClients(t);
  const body = { tag: "VIP", text_fr: "Bonjour {prenom}." };
  const first = await gerante("POST", "/api/campaigns", body);
  assert.equal(first.status, 201);
  const again = await gerante("POST", "/api/campaigns", { ...body, tag: " vip " });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, first.body);
  assert.equal(count(ctx, "campaigns"), 1);
  assert.equal(count(ctx, "outbox"), 2);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'campagne.envoyee'").get() as { n: number }).n, 1);
  ctx.clock.now += 61_000;
  assert.equal((await gerante("POST", "/api/campaigns", body)).status, 201, "une minute plus tard : nouvelle campagne");
  assert.equal(count(ctx, "outbox"), 4);
});
