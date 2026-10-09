import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB, query } from "@clawnify/db";
import { decode } from "../messages.ts";
import { runMigrations } from "../migrations.ts";
import { clearHandlers, enqueue, listOutbox, OPENED_BY_HAND, processDue, registerHandler } from "../outbox/outbox.ts";
import { setMasterKey, setSetting } from "../settings.ts";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { createFakeWaha } from "../whatsapp/faux-waha.ts";
import { createPacer, createWhatsappHandler, smsDeadline, WHATSAPP_KIND, type WhatsappMessage } from "../whatsapp/envoi.ts";
import { appointmentAt } from "../whatsapp/numeros.ts";
import { createWaha } from "../whatsapp/waha.ts";
import { createFakeGateway } from "./fausse-passerelle.ts";
import { createGateway } from "./passerelle.ts";

const NOON = Date.parse("2026-10-01T11:00:00Z"); // midi à Douala
const AT = appointmentAt("2026-10-03", "10:00");
const H = 3600e3;

function setup(opts: { whatsapp?: boolean; sms?: boolean } = {}) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  setMasterKey(new Uint8Array(32).fill(7));
  clearHandlers();
  db.exec(`INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456');
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time) VALUES (1, 'APT-1', 1, '2026-10-03', '10:00');`);
  const waha = createFakeWaha("cle-essai");
  waha.scan();
  const gateway = createFakeGateway("sms", "secret");
  const wahaProvider = createWaha({ baseUrl: "http://waha", apiKey: "cle-essai", session: "default", fetch: waha.fetch });
  const smsProvider = createGateway({ address: "192.168.1.60", username: "sms", password: "secret", fetch: gateway.fetch, timeoutMs: 50 });
  const pacer = createPacer({ random: () => 0 });
  registerHandler(WHATSAPP_KIND, createWhatsappHandler({
    provider: async () => (opts.whatsapp === false ? null : wahaProvider),
    sms: async () => (opts.sms === false ? null : smsProvider),
    document: async () => ({ name: "F-2026-000001.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 essai") }),
  }, pacer), undefined, pacer, { offline: async () => opts.sms !== false });
  return { db, waha, gateway };
}

const message = (over: Partial<WhatsappMessage> = {}): WhatsappMessage => ({
  to: "237699123456", lang: "fr", text: "Bonjour Aïcha", origin: { type: "confirmation", appointmentId: 1, clientId: 1, at: AT }, ...over,
});
const put = (m: WhatsappMessage, key = "k", now = NOON) => enqueue({ kind: WHATSAPP_KIND, payload: m, dedupeKey: key, now });
const only = async () => (await listOutbox())[0];
const channelOf = async (id: number) => (await query<{ channel: string }>("SELECT channel FROM outbox WHERE id = ?", [id]))[0].channel;

test("échéance : rendez-vous moins le délai, message libre création plus le délai, au plus 20 h après la création", () => {
  const s = { appointmentMinutes: 180, freeMinutes: 15 };
  assert.equal(smsDeadline(message(), AT - 10 * H, s), AT - 3 * H);
  assert.equal(smsDeadline(message({ origin: { type: "libre", clientId: 1 } }), NOON, s), NOON + 15 * 60e3);
  assert.equal(smsDeadline(message(), NOON, s), NOON + 20 * H, "rendez-vous dans deux jours : borne des 20 h");
});

test("cliente en « SMS » : le SMS part directement, WhatsApp jamais tenté, canal noté", async () => {
  const { db, waha, gateway } = setup();
  db.exec("UPDATE clients SET channel = 'sms'");
  const { id } = await put(message());
  await processDue(NOON, true);
  assert.deepEqual(gateway.sent, [{ phoneNumbers: ["+237699123456"], text: "Bonjour Aïcha" }]);
  assert.equal(waha.sent.length, 0);
  assert.equal((await only()).status, "sent");
  assert.equal(await channelOf(id), "sms");
});

test("cliente en « Aucun » : confirmation ignorée ; message libre envoyé par WhatsApp (geste volontaire)", async () => {
  const { db, waha, gateway } = setup();
  db.exec("UPDATE clients SET channel = 'none'");
  await put(message(), "a");
  await put(message({ text: "Libre", origin: { type: "libre", clientId: 1 } }), "b");
  await processDue(NOON, true);
  await processDue(NOON + 10e3, true);
  const rows = (await listOutbox()).sort((x, y) => x.dedupe_key.localeCompare(y.dedupe_key)).map((r) => [r.dedupe_key, r.status, r.manual]);
  assert.deepEqual(rows, [["a", "sent", "ignored"], ["b", "sent", ""]]);
  assert.deepEqual(waha.sent.map((s) => s.text), ["Libre"]);
  assert.equal(gateway.sent.length, 0);
});

test("cliente en « WhatsApp », WhatsApp joignable : WhatsApp, canal noté", async () => {
  const { waha, gateway } = setup();
  const { id } = await put(message());
  await processDue(NOON, true);
  assert.equal(waha.sent.length, 1);
  assert.equal(gateway.sent.length, 0);
  assert.equal(await channelOf(id), "whatsapp");
});

test("numéro sans WhatsApp : la fiche passe en « SMS » (journal, sans texte), le SMS part dans la même tentative", async () => {
  const { db, waha, gateway } = setup();
  waha.unknownNumbers.add("237699123456");
  await put(message());
  await processDue(NOON, true);
  assert.equal(gateway.sent.length, 1);
  assert.equal((db.prepare("SELECT channel FROM clients WHERE id = 1").get() as { channel: string }).channel, "sms");
  const audit = db.prepare("SELECT account_id, action, target FROM audit_log").all().map((r) => ({ ...r }));
  assert.deepEqual(audit, [{ account_id: null, action: "cliente.canal_sms", target: "1" }]);
});

test("WhatsApp en panne : relance jusqu'à l'échéance (jamais au-delà), puis SMS", async () => {
  const { waha, gateway } = setup();
  // Sans heures de silence (début égal à la fin) : la création à 5 h du matin ne doit pas tomber dedans.
  await setSetting("whatsapp.silence_debut", "00:00", null, NOON);
  await setSetting("whatsapp.silence_fin", "00:00", null, NOON);
  waha.drop();
  const created = AT - 5 * H; // échéance : AT - 3 h, soit 2 h après la création
  await put(message(), "k", created);
  await processDue(created, true);
  let item = await only();
  assert.equal(item.status, "pending");
  assert.equal(gateway.sent.length, 0);
  // Relances successives : jamais programmées après l'échéance.
  while (item.next_attempt_at < AT - 3 * H) {
    assert.ok(item.next_attempt_at <= AT - 3 * H);
    await processDue(item.next_attempt_at, true);
    item = await only();
  }
  assert.equal(item.next_attempt_at, AT - 3 * H);
  await processDue(AT - 3 * H, true);
  assert.equal(gateway.sent.length, 1);
  assert.equal((await only()).status, "sent");
});

test("échéance déjà passée (rendez-vous dans deux heures) : premier échec WhatsApp, SMS aussitôt", async () => {
  const { waha, gateway } = setup();
  waha.drop();
  await put(message(), "k", AT - 2 * H);
  await processDue(AT - 2 * H, true);
  assert.equal(gateway.sent.length, 1);
});

test("aucun fournisseur WhatsApp, passerelle SMS réglée : SMS tout de suite", async () => {
  const { gateway } = setup({ whatsapp: false });
  await put(message());
  await processDue(NOON, true);
  assert.equal(gateway.sent.length, 1);
});

test("sans fournisseur SMS : comportement d'aujourd'hui (numéro absent : à la main, fiche inchangée)", async () => {
  const { db, waha, gateway } = setup({ sms: false });
  waha.unknownNumbers.add("237699123456");
  await put(message());
  await processDue(NOON, true);
  const item = await only();
  assert.equal(item.status, "failed");
  assert.equal(decode("fr", item.last_error), "Ce numéro n'a pas WhatsApp.");
  assert.equal((db.prepare("SELECT channel FROM clients WHERE id = 1").get() as { channel: string }).channel, "whatsapp");
  assert.equal(gateway.sent.length, 0);
});

test("échec du SMS : à la main, avec les raisons des deux canaux, sans nouvelle tentative", async () => {
  const { waha, gateway } = setup();
  waha.unknownNumbers.add("237699123456");
  gateway.mode = "muet";
  await put(message());
  await processDue(NOON, true);
  const item = await only();
  assert.equal(item.status, "failed");
  assert.equal(decode("fr", item.last_error), "WhatsApp\u00a0: Ce numéro n'a pas WhatsApp. SMS\u00a0: Passerelle SMS injoignable.");
});

test("document pour une cliente en « SMS » ou sans WhatsApp : jamais par SMS, à la main", async () => {
  const { db, waha, gateway } = setup();
  db.exec("UPDATE clients SET channel = 'sms'");
  await put(message({ document: { kind: "invoice", id: 1 }, origin: { type: "ticket", clientId: 1 } }), "a");
  await processDue(NOON, true);
  assert.equal(decode("fr", (await only()).last_error), "La cliente reçoit ses messages par SMS\u00a0: document à envoyer à la main.");
  db.exec("UPDATE clients SET channel = 'whatsapp'");
  waha.unknownNumbers.add("237699123456");
  await put(message({ document: { kind: "invoice", id: 1 }, origin: { type: "ticket", clientId: 1 } }), "b", NOON + 1);
  await processDue(NOON + 10e3, true);
  assert.equal(gateway.sent.length, 0);
  assert.equal((db.prepare("SELECT channel FROM clients WHERE id = 1").get() as { channel: string }).channel, "whatsapp", "un document ne change pas la fiche");
});

test("numéro impossible à normaliser : échec définitif sans appel à aucune passerelle", async () => {
  const { waha, gateway } = setup();
  await put(message({ to: "" }));
  await processDue(NOON, true);
  assert.equal((await only()).status, "failed");
  assert.equal(waha.sent.length + gateway.sent.length, 0);
});

test("heures de silence : le SMS de secours attend leur fin, même échéance passée", async () => {
  const { db, waha, gateway } = setup();
  waha.drop();
  db.exec("UPDATE appointments SET scheduled_date = '2026-10-02', start_time = '09:00'");
  const at = appointmentAt("2026-10-02", "09:00");
  const night = Date.parse("2026-10-02T05:00:00Z"); // 6:00 à Douala, échéance (6:00) atteinte, silence jusqu'à 8:00
  await put(message({ origin: { type: "rappel", appointmentId: 1, clientId: 1, at } }), "k", night - 60e3);
  await processDue(night, true);
  assert.equal(gateway.sent.length, 0);
  assert.equal(decode("fr", (await only()).last_error), "Fenêtre sans envoi\u00a0: le message partira à la fin.");
  await processDue(Date.parse("2026-10-02T07:00:00Z"), true); // 8:00 à Douala
  assert.equal(gateway.sent.length, 1);
});

test("heures de silence : en suivant les relances de la file, le SMS part à 8:00 pile", async () => {
  const { db, waha, gateway } = setup();
  waha.drop();
  db.exec("UPDATE appointments SET scheduled_date = '2026-10-02', start_time = '09:30'");
  const at = appointmentAt("2026-10-02", "09:30");
  const first = Date.parse("2026-10-02T05:00:00Z"); // 6:00 à Douala, échéance (6:30) pas encore atteinte
  await put(message({ origin: { type: "rappel", appointmentId: 1, clientId: 1, at } }), "k", first - 60e3);
  await processDue(first, true);
  let item = await only();
  const end = Date.parse("2026-10-02T07:00:00Z"); // 8:00 à Douala
  let guard = 0;
  while (gateway.sent.length === 0 && guard++ < 20) {
    assert.ok(item.next_attempt_at <= end, "aucune relance après la fin du silence");
    await processDue(item.next_attempt_at, true);
    item = await only();
  }
  assert.equal(gateway.sent.length, 1);
  assert.equal(item.status, "sent");
  assert.equal(item.sent_at, end, "le SMS part à la fin exacte du silence");
});

test("message ouvert à la main (« Ouvrir WhatsApp » ou « Ouvrir les SMS ») : en attente puis suspendu, jamais envoyé par SMS ensuite", async () => {
  const { db, waha, gateway } = setup();
  waha.drop();
  const { id } = await put(message());
  await processDue(NOON, true);
  assert.equal((await only()).status, "pending", "WhatsApp en panne : le message attend son échéance");
  // Même requête que POST /api/whatsapp/manual/:id/open.
  const suspended = db.prepare("UPDATE outbox SET status = 'failed', last_error = ? WHERE id = ? AND kind = ? AND manual = '' AND status = 'pending'").run(OPENED_BY_HAND, id, WHATSAPP_KIND);
  assert.equal(Number(suspended.changes), 1);
  await processDue(NOON + 20 * H, true);
  assert.equal(gateway.sent.length, 0);
  assert.equal((await only()).status, "failed");
});

test("cliente en « Aucun », message libre, numéro sans WhatsApp : le SMS part, la fiche reste « Aucun », rien au journal", async () => {
  const { db, waha, gateway } = setup();
  db.exec("UPDATE clients SET channel = 'none'");
  waha.unknownNumbers.add("237699123456");
  await put(message({ origin: { type: "libre", clientId: 1 } }));
  await processDue(NOON, true);
  assert.equal(gateway.sent.length, 1);
  assert.equal((db.prepare("SELECT channel FROM clients WHERE id = 1").get() as { channel: string }).channel, "none");
  assert.equal(db.prepare("SELECT count(*) AS n FROM audit_log").get()!.n, 0);
});

test("hors ligne, aucun fournisseur WhatsApp, passerelle SMS réglée : SMS tout de suite", async () => {
  const { gateway } = setup({ whatsapp: false });
  await put(message());
  await processDue(NOON, false);
  assert.equal(gateway.sent.length, 1);
  assert.equal((await only()).status, "sent");
});

test("hors ligne : WhatsApp non tenté, relance toutes les 30 s ; SMS à l'échéance ; retour d'internet : WhatsApp aussitôt", async () => {
  const { waha, gateway } = setup();
  await put(message({ origin: { type: "libre", clientId: 1 } }), "a");
  await processDue(NOON, false);
  let item = await only();
  assert.equal(item.status, "pending");
  assert.equal(item.next_attempt_at, NOON + 30e3);
  assert.equal(decode("fr", item.last_error), "Pas d'internet.");
  await processDue(NOON + 15 * 60e3, false);
  assert.equal(gateway.sent.length, 1, "message libre : SMS après 15 min sans internet");
  assert.equal(waha.sent.length, 0);
  await put(message({ text: "Deux", origin: { type: "libre", clientId: 1 } }), "b", NOON + 16 * 60e3);
  await processDue(NOON + 16 * 60e3, false);
  item = (await listOutbox()).find((i) => i.dedupe_key === "b")!;
  await processDue(item.next_attempt_at, true);
  assert.deepEqual(waha.sent.map((s) => s.text), ["Deux"]);
});

test("débit : 2 s après un SMS, 4 s après un message WhatsApp", () => {
  const pacer = createPacer({ random: () => 0 });
  pacer.sent(0, "sms");
  assert.equal(pacer.ready(1999), false);
  assert.equal(pacer.ready(2000), true);
  pacer.sent(10_000);
  assert.equal(pacer.ready(13_999), false);
  assert.equal(pacer.ready(14_000), true);
  pacer.sent(20_000);
  pacer.sent(20_500, "sms");
  assert.equal(pacer.ready(23_999), false, "l'espacement WhatsApp reste après un SMS aussitôt");
  assert.equal(pacer.ready(24_000), true);
});

test("sans fournisseur WhatsApp ni passerelle SMS, numéro vide : raison « Aucun fournisseur WhatsApp »", async () => {
  setup({ whatsapp: false, sms: false });
  await put(message({ to: "" }));
  await processDue(NOON, true);
  const item = await only();
  assert.equal(item.status, "failed");
  assert.match(decode("fr", item.last_error), /Aucun fournisseur WhatsApp/);
});
