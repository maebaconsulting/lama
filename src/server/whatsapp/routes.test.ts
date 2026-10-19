import assert from "node:assert/strict";
import { test } from "node:test";
import { resourceFor } from "../realtime.ts";
import { setupApp } from "../test-support.ts";
import { createFakeWaha, FAKE_QR_PNG } from "./faux-waha.ts";

/** Routes WhatsApp (sous-projet 7 § 3 et § 4) : état, QR relayé, session, textes, « À envoyer à la main », message libre. */

async function withWaha(t: Parameters<typeof setupApp>[0]) {
  const fake = createFakeWaha("cle-essai");
  const ctx = await setupApp(t, { demo: false, bindings: { WHATSAPP_FETCH: fake.fetch } });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  await admin("PUT", "/api/settings/whatsapp.fournisseur", { value: "waha" });
  await admin("PUT", "/api/settings/waha.cle", { value: "cle-essai" });
  return { ctx, fake, admin, gerante: await ctx.as("manager"), reception: await ctx.as("reception") };
}

test("sans fournisseur : état « aucun », sans appel à une passerelle", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const reply = await (await ctx.as("reception"))("GET", "/api/whatsapp/status");
  assert.deepEqual(reply.body, { provider: "aucun" });
});

test("connexion de WAHA par la gérante : démarrer, QR relayé par lama, scan, connecté avec le numéro, se déconnecter", async (t) => {
  const { fake, gerante, reception } = await withWaha(t);
  assert.deepEqual((await gerante("GET", "/api/whatsapp/status")).body, { provider: "waha", state: "deconnecte" });
  assert.equal((await gerante("POST", "/api/whatsapp/session/start")).status, 200);
  assert.deepEqual((await gerante("GET", "/api/whatsapp/status")).body, { provider: "waha", state: "qr" });
  assert.deepEqual((await gerante("GET", "/api/whatsapp/qr")).body, { image: `data:image/png;base64,${FAKE_QR_PNG}` });
  fake.scan("default", "237699000000");
  assert.deepEqual((await reception("GET", "/api/whatsapp/status")).body, { provider: "waha", state: "connecte", phone: "237699000000" });
  assert.equal((await gerante("POST", "/api/whatsapp/session/logout")).status, 200);
  assert.deepEqual((await gerante("GET", "/api/whatsapp/status")).body, { provider: "waha", state: "qr" });
});

test("passerelle injoignable : état dit, démarrage refusé avec la raison", async (t) => {
  const { fake, admin } = await withWaha(t);
  fake.down = true;
  assert.deepEqual((await admin("GET", "/api/whatsapp/status")).body, { provider: "waha", state: "injoignable" });
  const start = await admin("POST", "/api/whatsapp/session/start", undefined, { "Accept-Language": "fr" });
  assert.equal(start.status, 502);
  assert.equal(start.body.error, "Passerelle WhatsApp injoignable.");
  fake.down = false;
  assert.equal((await admin("GET", "/api/whatsapp/qr")).status, 502, "pas de QR hors de l'état « QR à scanner »");
});

test("droits : état pour l'administrateur, la gérante et la réception ; session et QR aux deux premiers ; textes à la gérante", async (t) => {
  const { ctx, admin, gerante, reception } = await withWaha(t);
  const praticienne = await ctx.as("practitioner");
  assert.equal((await praticienne("GET", "/api/whatsapp/status")).status, 403);
  assert.equal((await reception("POST", "/api/whatsapp/session/start")).status, 403);
  assert.equal((await reception("GET", "/api/whatsapp/qr")).status, 403);
  assert.equal((await admin("GET", "/api/whatsapp/texts")).status, 403);
  assert.equal((await admin("GET", "/api/whatsapp/manual")).status, 403, "le texte des messages n'est jamais montré à l'administrateur");
  assert.equal((await admin("POST", "/api/clients/1/whatsapp", { text: "x" })).status, 403);
  const texts = (await gerante("GET", "/api/whatsapp/texts")).body.texts;
  assert.equal(texts.length, 24, "confirmation, rappel, ticket, produit recommandé, anniversaire, absence, campagne, transfert et les quatre textes de la réservation en ligne, en français et en anglais");
  assert.deepEqual(Object.keys(texts[0]).sort(), ["default", "key", "kind", "lang", "value"]);
});

function failed(ctx: Awaited<ReturnType<typeof setupApp>>, key: string, origin: Record<string, unknown>, extra = "status = 'failed', last_error = '@whatsapp.sans_fournisseur'") {
  const payload = JSON.stringify({ to: "237699123456", lang: "fr", text: `Texte ${key}`, origin });
  ctx.db.prepare(`INSERT INTO outbox (kind, payload, dedupe_key, next_attempt_at, created_at) VALUES ('whatsapp', ?, ?, 0, ?)`).run(payload, key, ctx.clock.now);
  ctx.db.exec(`UPDATE outbox SET ${extra} WHERE dedupe_key = '${key}'`);
}

test("« À envoyer à la main » : cliente, type, raison et texte ; rendez-vous passés et silence écartés ; marquer comme envoyé ou ignorer", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const reception = await ctx.as("reception");
  const client = (await reception("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699123456" })).body.client.id;
  const future = ctx.clock.now + 48 * 3600e3;
  // Rendez-vous réel (toujours à venir, non annulé, même cliente) : la confirmation « a » garde son objet.
  ctx.db.exec(`INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time) VALUES (1, 'APT-TEST-1', ${client}, '2026-09-30', '09:00')`);
  failed(ctx, "a", { type: "confirmation", appointmentId: 1, clientId: client, at: future });
  failed(ctx, "b", { type: "rappel", appointmentId: 2, clientId: client, at: ctx.clock.now - 60e3 });
  failed(ctx, "c", { type: "libre", clientId: client }, "status = 'pending', attempts = 3, last_error = '@whatsapp.session_non_connectee'");
  failed(ctx, "d", { type: "rappel", appointmentId: 3, clientId: client, at: future }, "status = 'pending', attempts = 1, last_error = '@whatsapp.silence'");
  failed(ctx, "e", { type: "libre", clientId: client }, "status = 'pending', attempts = 0");
  const items = (await reception("GET", "/api/whatsapp/manual", undefined, { "Accept-Language": "fr" })).body.items;
  assert.deepEqual(items.map((i: { text: string }) => i.text).sort(), ["Texte a", "Texte c"]);
  const a = items.find((i: { text: string }) => i.text === "Texte a");
  assert.deepEqual({ type: a.type, client_name: a.client_name, to: a.to, reason: a.reason }, { type: "confirmation", client_name: "Aïcha Mbarga", to: "237699123456", reason: "Aucun fournisseur WhatsApp\u00a0: à envoyer à la main." });
  assert.equal((await reception("POST", `/api/whatsapp/manual/${a.id}`, { action: "sent" })).status, 200);
  assert.equal((await reception("POST", `/api/whatsapp/manual/${a.id}`, { action: "sent" })).status, 409, "déjà traité");
  const c = items.find((i: { text: string }) => i.text === "Texte c");
  assert.equal((await reception("POST", `/api/whatsapp/manual/${c.id}`, { action: "perdu" })).status, 400);
  assert.equal((await reception("POST", `/api/whatsapp/manual/${c.id}`, { action: "ignored" })).status, 200);
  assert.deepEqual((await reception("GET", "/api/whatsapp/manual")).body.items, []);
  const rows = ctx.db.prepare("SELECT dedupe_key, status, manual FROM outbox WHERE dedupe_key IN ('a', 'c') ORDER BY dedupe_key").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ dedupe_key: "a", status: "sent", manual: "sent" }, { dedupe_key: "c", status: "sent", manual: "ignored" }]);
  const audit = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'whatsapp.manuel'").all().map((r) => ({ ...r }));
  assert.deepEqual(audit, [{ action: "whatsapp.manuel", target: String(a.id) }, { action: "whatsapp.manuel", target: String(c.id) }]);
});

test("« À envoyer à la main » : rendez-vous annulé, déplacé, cliente décochée ou changée : plus montré", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const reception = await ctx.as("reception");
  let n = 0;
  const client = async (name: string) => (await g("POST", "/api/clients", { name, phone: `69900000${++n}` })).body.client.id as number;
  const ca = await client("Annulée");
  const cm = await client("Déplacée");
  const cu = await client("Décochée");
  const cc = await client("Changée Avant");
  const newClient = await client("Changée Après");
  const book = async (clientId: number, date: string) =>
    (await g("POST", "/api/appointments", { client_id: clientId, scheduled_date: date, start_time: "10:00" })).body.appointment.id as number;
  const cancelledId = await book(ca, "2026-10-05");
  const movedId = await book(cm, "2026-10-06");
  await book(cu, "2026-10-07");
  const changedId = await book(cc, "2026-10-08");
  const fail = () => ctx.db.exec("UPDATE outbox SET status = 'failed', manual = '', last_error = '@whatsapp.sans_fournisseur' WHERE kind = 'whatsapp'");
  fail(); // les quatre confirmations initiales : sans fournisseur, à envoyer à la main
  ctx.clock.now += 60_000; // les changements ont lieu plus tard (clé de la nouvelle confirmation distincte)

  await g("PUT", `/api/appointments/${cancelledId}`, { status: "cancelled" });
  await g("PUT", `/api/appointments/${movedId}`, { start_time: "15:00" });
  ctx.db.prepare("UPDATE clients SET channel = 'none' WHERE id = ?").run(cu);
  await g("PUT", `/api/appointments/${changedId}`, { client_id: newClient });
  fail(); // les nouvelles confirmations (déplacement, changement de cliente) : sans fournisseur aussi

  const items = (await reception("GET", "/api/whatsapp/manual")).body.items as { client_id: number; text: string }[];
  // Annulée et décochée : plus aucun message. Déplacée et changée : seule la nouvelle confirmation reste.
  assert.deepEqual(items.filter((i) => i.client_id === ca), []);
  assert.deepEqual(items.filter((i) => i.client_id === cu), []);
  assert.deepEqual(items.filter((i) => i.client_id === cc), [], "l'ancienne cliente du rendez-vous changé n'a plus de message");
  const moved = items.filter((i) => i.client_id === cm);
  assert.equal(moved.length, 1);
  assert.match(moved[0].text, /15:00/);
  const changed = items.filter((i) => i.client_id === newClient);
  assert.equal(changed.length, 1, "nouvelle confirmation pour la nouvelle cliente du rendez-vous changé");
});

test("message libre : mis en file pour la cliente, numéro normalisé, journal sans le texte", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const reception = await ctx.as("reception");
  const client = (await reception("POST", "/api/clients", { name: "Aïcha", phone: "+237 699 12 34 56", channel: "none", language: "en" })).body.client.id;
  const reply = await reception("POST", `/api/clients/${client}/whatsapp`, { text: "  Votre commande est arrivée.  " });
  assert.equal(reply.status, 200);
  const row = ctx.db.prepare("SELECT payload, dedupe_key, created_by FROM outbox WHERE kind = 'whatsapp'").get() as { payload: string; dedupe_key: string; created_by: number };
  assert.match(row.dedupe_key, /^wa:libre:[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(row.payload), { to: "237699123456", lang: "en", text: "Votre commande est arrivée.", origin: { type: "libre", clientId: client } });
  assert.ok(row.created_by > 0);
  const audit = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'whatsapp.libre'").get() as { target: string };
  assert.equal(audit.target, String(client));
});

test("message libre refusé : texte vide ou trop long, cliente sans numéro ou numéro impossible, cliente inconnue", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const ok = (await g("POST", "/api/clients", { name: "Aïcha", phone: "699123456" })).body.client.id;
  const none = (await g("POST", "/api/clients", { name: "Brenda" })).body.client.id;
  const bad = (await g("POST", "/api/clients", { name: "Carine", phone: "12" })).body.client.id;
  const fr = { "Accept-Language": "fr" };
  assert.equal((await g("POST", `/api/clients/${ok}/whatsapp`, { text: "   " }, fr)).body.error, "Le texte du message est vide.");
  assert.equal((await g("POST", `/api/clients/${ok}/whatsapp`, { text: "a".repeat(1001) })).status, 400);
  assert.equal((await g("POST", `/api/clients/${none}/whatsapp`, { text: "Bonjour" }, fr)).body.error, "Cette cliente n'a pas de numéro de téléphone.");
  assert.equal((await g("POST", `/api/clients/${bad}/whatsapp`, { text: "Bonjour" }, fr)).body.error, "Numéro de téléphone impossible à normaliser.");
  assert.equal((await g("POST", "/api/clients/9999/whatsapp", { text: "Bonjour" })).status, 404);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n, 0);
});

test("signal temps réel : toute route /api/whatsapp recharge la file, la liste et la pastille", () => {
  assert.equal(resourceFor("/api/whatsapp/manual/3"), "outbox");
  assert.equal(resourceFor("/api/whatsapp/session/start"), "outbox");
});

test("coupure d'internet prolongée : un message en attente 30 min après son premier essai prévu apparaît, raison « Pas d'internet » ; il disparaît une fois parti (vague 2)", async (t) => {
  // La file vue par les routes (liaison `ONLINE`, comme `CLOCK`) : l'application des tests est assemblée à part.
  let online = true;
  const ctx = await setupApp(t, { demo: false, bindings: { ONLINE: () => online } });
  const reception = await ctx.as("reception");
  const client = (await reception("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699123456" })).body.client.id;
  ctx.db.exec(`INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time) VALUES (1, 'APT-TEST-1', ${client}, '2026-09-30', '09:00')`);
  const future = Date.parse("2026-09-30T08:00:00Z");
  failed(ctx, "vieux", { type: "confirmation", appointmentId: 1, clientId: client, at: future }, `status = 'pending', attempts = 0, next_attempt_at = ${ctx.clock.now - 31 * 60e3}`);
  failed(ctx, "jeune", { type: "confirmation", appointmentId: 1, clientId: client, at: future }, `status = 'pending', attempts = 0, next_attempt_at = ${ctx.clock.now - 29 * 60e3}`);
  failed(ctx, "nuit", { type: "rappel", appointmentId: 1, clientId: client, at: future }, `status = 'pending', attempts = 0, next_attempt_at = ${ctx.clock.now + 3600e3}`);
  const texts = async () => ((await reception("GET", "/api/whatsapp/manual", undefined, { "Accept-Language": "fr" })).body.items as { text: string; reason: string }[]);
  assert.deepEqual(await texts(), [], "en ligne : la file s'en occupe, rien à la main");
  online = false;
  const items = await texts();
  assert.deepEqual(items.map((i) => i.text), ["Texte vieux"]);
  assert.equal(items[0].reason, "Pas d'internet.");
  ctx.db.exec("UPDATE outbox SET status = 'sent', sent_at = 1 WHERE dedupe_key = 'vieux'");
  assert.deepEqual(await texts(), [], "parti tout seul : il disparaît de la liste");
});

test("« Ouvrir WhatsApp » sur un message en attente : l'envoi automatique est suspendu, le message reste jusqu'à « Marquer comme envoyé » ou « Ignorer » (vague 2)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const reception = await ctx.as("reception");
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const client = (await reception("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699123456" })).body.client.id;
  failed(ctx, "attente", { type: "libre", clientId: client }, "status = 'pending', attempts = 2, last_error = '@whatsapp.injoignable'");
  failed(ctx, "echec", { type: "libre", clientId: client });
  const id = (key: string) => (ctx.db.prepare("SELECT id FROM outbox WHERE dedupe_key = ?").get(key) as { id: number }).id;
  const state = (key: string) => ({ ...(ctx.db.prepare("SELECT status, last_error FROM outbox WHERE dedupe_key = ?").get(key) as object) });

  assert.equal((await reception("POST", `/api/whatsapp/manual/${id("attente")}/open`)).status, 200);
  assert.equal((await reception("POST", `/api/whatsapp/manual/${id("echec")}/open`)).status, 200, "déjà en échec : rien à suspendre, ouverture permise");
  // La file ne prend que les envois « en attente » (`processDue`) : suspendu, il ne partira plus tout seul.
  assert.deepEqual(state("attente"), { status: "failed", last_error: "@whatsapp.ouvert" });
  const items = (await reception("GET", "/api/whatsapp/manual", undefined, { "Accept-Language": "fr" })).body.items as { id: number; reason: string }[];
  assert.equal(items.find((i) => i.id === id("attente"))!.reason, "Ouvert pour un envoi à la main\u00a0: marquez-le comme envoyé ou ignorez-le.");
  assert.equal((await admin("POST", `/api/outbox/${id("attente")}/retry`)).status, 409, "la file d'envoi ne le relance pas non plus");
  assert.equal((await reception("POST", `/api/whatsapp/manual/${id("attente")}`, { action: "sent" })).status, 200);

  // Pris par la file à l'instant même (réservé, en cours d'envoi) : refus clair, rien n'est ouvert.
  failed(ctx, "en-cours", { type: "libre", clientId: client }, "status = 'sending'");
  const busy = await reception("POST", `/api/whatsapp/manual/${id("en-cours")}/open`, undefined, { "Accept-Language": "fr" });
  assert.equal(busy.status, 409);
  assert.equal(busy.body.error, "Ce message est en train de partir\u00a0: attendez quelques secondes.");
  assert.equal((await reception("POST", `/api/whatsapp/manual/${id("attente")}/open`)).status, 409, "déjà traité");
  assert.equal((await reception("POST", "/api/whatsapp/manual/9999/open")).status, 409);
  assert.equal((await admin("POST", `/api/whatsapp/manual/${id("echec")}/open`)).status, 403);
});
