import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { createFakeGateway } from "./fausse-passerelle.ts";
import { createFakeWaha } from "../whatsapp/faux-waha.ts";

async function withGateway(t: Parameters<typeof setupApp>[0]) {
  const gateway = createFakeGateway("sms", "secret");
  const waha = createFakeWaha("cle-essai");
  const ctx = await setupApp(t, { demo: false, bindings: { SMS_FETCH: gateway.fetch, WHATSAPP_FETCH: waha.fetch } });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  return { ctx, gateway, waha, admin };
}

async function configure(admin: Awaited<ReturnType<typeof withGateway>>["admin"]) {
  await admin("PUT", "/api/settings/sms.fournisseur", { value: "passerelle" });
  await admin("PUT", "/api/settings/sms.adresse", { value: "192.168.1.60" });
  await admin("PUT", "/api/settings/sms.identifiant", { value: "sms" });
  await admin("PUT", "/api/settings/sms.mot_de_passe", { value: "secret" });
}

test("état de la passerelle : aucun, joignable, identifiants refusés ; réservé à l'administrateur et à la gérante", async (t) => {
  const { ctx, admin } = await withGateway(t);
  assert.deepEqual((await admin("GET", "/api/sms/status")).body, { provider: "aucun" });
  await configure(admin);
  assert.deepEqual((await admin("GET", "/api/sms/status")).body, { provider: "passerelle", state: "joignable" });
  await admin("PUT", "/api/settings/sms.mot_de_passe", { value: "faux" });
  assert.deepEqual((await (await ctx.as("manager"))("GET", "/api/sms/status")).body, { provider: "passerelle", state: "identifiants" });
  assert.equal((await (await ctx.as("reception"))("GET", "/api/sms/status")).status, 403);
});

test("SMS d'essai : envoyé au numéro saisi, inscrit au journal ; refusé sans fournisseur ou numéro impossible", async (t) => {
  const { ctx, gateway, admin } = await withGateway(t);
  assert.equal((await admin("POST", "/api/sms/test", { to: "699 12 34 56" })).status, 409);
  await configure(admin);
  assert.equal((await admin("POST", "/api/sms/test", { to: "abc" })).status, 400);
  assert.equal((await admin("POST", "/api/sms/test", { to: "699 12 34 56" })).status, 200);
  assert.deepEqual(gateway.sent.map((s) => s.phoneNumbers), [["+237699123456"]]);
  assert.equal(gateway.sent[0].text, "Message d'essai de lama.");
  const actions = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'sms.essai'").all().map((r) => ({ ...r }));
  assert.deepEqual(actions, [{ action: "sms.essai", target: "237699123456" }]);
  gateway.mode = "muet";
  const failed = await admin("POST", "/api/sms/test", { to: "699 12 34 56" }, { "Accept-Language": "fr" });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "Passerelle SMS injoignable.");
  assert.equal((await (await ctx.as("manager"))("POST", "/api/sms/test", { to: "699 12 34 56" })).status, 403);
});

test("« À envoyer à la main » avec passerelle SMS : un message texte qui attend son échéance n'y figure pas ; un document en attente, si", async (t) => {
  const { ctx, admin, waha } = await withGateway(t);
  await admin("PUT", "/api/settings/whatsapp.fournisseur", { value: "waha" });
  await admin("PUT", "/api/settings/waha.cle", { value: "cle-essai" });
  await configure(admin);
  waha.drop();
  const now = ctx.clock.now;
  ctx.db.exec("INSERT INTO clients (id, name, phone) VALUES (9, 'Aïcha', '699123456')");
  const insert = ctx.db.prepare("INSERT INTO outbox (kind, payload, dedupe_key, status, attempts, next_attempt_at, last_error, created_at) VALUES ('whatsapp', ?, ?, 'pending', 1, ?, '@whatsapp.session_non_connectee', ?)");
  insert.run(JSON.stringify({ to: "237699123456", lang: "fr", text: "Libre", origin: { type: "libre", clientId: 9 } }), "a", now + 60e3, now);
  insert.run(JSON.stringify({ to: "237699123456", lang: "fr", text: "Ticket", document: { kind: "invoice", id: 1 }, origin: { type: "ticket", clientId: 9 } }), "b", now + 60e3, now);
  const items = (await (await ctx.as("reception"))("GET", "/api/whatsapp/manual")).body.items as { text: string }[];
  assert.deepEqual(items.map((i) => i.text), ["Ticket"]);
});
