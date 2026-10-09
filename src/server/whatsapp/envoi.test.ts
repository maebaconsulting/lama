import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { clearHandlers, enqueue, listOutbox, processDue, registerHandler } from "../outbox/outbox.ts";
import { decode } from "../messages.ts";
import { setMasterKey, setSetting } from "../settings.ts";
import { createFakeWaha } from "./faux-waha.ts";
import { appointmentAt } from "./numeros.ts";
import { createPacer, createWhatsappHandler, providerFromSettings, WHATSAPP_KIND, withoutPurpose, type WhatsappMessage } from "./envoi.ts";
import { createWaha } from "./waha.ts";
import { deleteProductImage, saveProductImage } from "../produits/images.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { appointmentMessage, type MessageSettings } from "./rendez-vous.ts";
import { DEFAULT_TEXTS } from "./textes.ts";
import type { SmsProvider } from "../sms/passerelle.ts";

const NOON = Date.parse("2026-10-01T11:00:00Z"); // midi à Douala
const AT = appointmentAt("2026-10-03", "10:00");

function setup(provider: "waha" | "aucun" = "waha") {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  setMasterKey(new Uint8Array(32).fill(7));
  clearHandlers();
  db.exec(`INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456');
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time) VALUES (1, 'APT-1', 1, '2026-10-03', '10:00');`);
  const fake = createFakeWaha("cle-essai");
  fake.scan();
  const waha = createWaha({ baseUrl: "http://waha", apiKey: "cle-essai", session: "default", fetch: fake.fetch });
  const pacer = createPacer({ random: () => 0 });
  registerHandler(WHATSAPP_KIND, createWhatsappHandler({ provider: async () => (provider === "waha" ? waha : null) }, pacer), undefined, pacer);
  return { db, fake };
}

const message = (over: Partial<WhatsappMessage> = {}): WhatsappMessage => ({
  to: "237699123456", lang: "fr", text: "Bonjour Aïcha", origin: { type: "confirmation", appointmentId: 1, clientId: 1, at: AT }, ...over,
});
const put = (m: WhatsappMessage, key = "k", now = NOON) => enqueue({ kind: WHATSAPP_KIND, payload: m, dedupeKey: key, now });
const only = async () => (await listOutbox())[0];

test("WAHA connecté : le message part, une seule fois", async () => {
  const { fake } = setup();
  await put(message());
  await processDue(NOON, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Bonjour Aïcha"]);
  assert.equal((await only()).status, "sent");
});

test("sans fournisseur : directement « À envoyer à la main » (échec définitif expliqué)", async () => {
  const { fake } = setup("aucun");
  await put(message());
  await processDue(NOON, true);
  const item = await only();
  assert.equal(item.status, "failed");
  assert.equal(decode("fr", item.last_error), "Aucun fournisseur WhatsApp\u00a0: à envoyer à la main.");
  assert.equal(fake.sent.length, 0);
});

test("numéro impossible à normaliser : échec définitif, sans appel à la passerelle", async () => {
  const { fake } = setup();
  await put(message({ to: "" }));
  await processDue(NOON, true);
  assert.equal(decode("fr", (await only()).last_error), "Numéro de téléphone impossible à normaliser.");
  assert.equal(fake.sent.length, 0);
});

test("session tombée : reste en attente, la file relance ; repart quand la session revient", async () => {
  const { fake } = setup();
  fake.drop();
  await put(message());
  await processDue(NOON, true);
  let item = await only();
  assert.equal(item.status, "pending");
  assert.equal(decode("fr", item.last_error), "Session WhatsApp non connectée.");
  fake.scan();
  await processDue(NOON + 30e3, true);
  item = await only();
  assert.equal(item.status, "sent");
});

test("cliente décochée entre-temps : le message automatique est ignoré, jamais envoyé", async () => {
  const { db, fake } = setup();
  await put(message());
  db.exec("UPDATE clients SET channel = 'none'");
  await processDue(NOON, true);
  const item = await only();
  assert.deepEqual([item.status, item.manual], ["sent", "ignored"]);
  assert.equal(fake.sent.length, 0);
});

test("rendez-vous annulé, déplacé ou passé avant l'envoi : ignoré", async () => {
  const { db, fake } = setup();
  await put(message(), "a");
  db.exec("UPDATE appointments SET status = 'cancelled'");
  await processDue(NOON, true);
  db.exec("UPDATE appointments SET status = 'booked', start_time = '11:00'");
  await put(message(), "b");
  await processDue(NOON + 10e3, true);
  db.exec("UPDATE appointments SET start_time = '10:00'");
  await put(message({ origin: { type: "rappel", appointmentId: 1, clientId: 1, at: AT } }), "c", AT - 3600e3);
  await processDue(AT + 60e3, true);
  assert.deepEqual((await listOutbox()).map((i) => i.manual), ["ignored", "ignored", "ignored"]);
  assert.equal(fake.sent.length, 0);
});

test("cliente changée entre-temps : le message automatique visant l'ancienne cliente est ignoré", async () => {
  const { db, fake } = setup();
  db.exec("INSERT INTO clients (id, name, phone) VALUES (2, 'Brenda', '699000002')");
  await put(message(), "a");
  db.exec("UPDATE appointments SET client_id = 2 WHERE id = 1");
  await processDue(NOON, true);
  const item = await only();
  assert.deepEqual([item.status, item.manual], ["sent", "ignored"]);
  assert.equal(fake.sent.length, 0);
});

test("fenêtre de silence : confirmation et rappel attendent ; le message libre part", async () => {
  const { db, fake } = setup();
  const night = Date.parse("2026-10-01T21:30:00Z"); // 22:30 à Douala
  await put(message(), "a", night);
  db.exec("INSERT INTO clients (id, name, phone, channel) VALUES (2, 'Brenda', '699000002', 'none')");
  await put(message({ text: "Libre", origin: { type: "libre", clientId: 2 } }), "b", night);
  await processDue(night, true);
  await processDue(night + 10e3, true);
  const items = await listOutbox();
  const confirmation = items.find((i) => i.dedupe_key === "a")!;
  assert.equal(confirmation.status, "pending");
  assert.equal(decode("fr", confirmation.last_error), "Fenêtre sans envoi\u00a0: le message partira à la fin.");
  assert.deepEqual(fake.sent.map((s) => s.text), ["Libre"], "message libre : geste volontaire, sans accord ni silence");
});

test("débit : 4 s plus un tirage de 0 à 4 s entre deux envois", () => {
  const pacer = createPacer({ random: () => 0.5 });
  assert.equal(pacer.ready(0), true);
  pacer.sent(1000);
  assert.equal(pacer.ready(6999), false);
  assert.equal(pacer.ready(7000), true);
  const fast = createPacer({ random: () => 0 });
  fast.sent(0);
  assert.equal(fast.ready(3999), false);
  assert.equal(fast.ready(4000), true);
});

test("deux messages dus ensemble partent à deux passages distincts, espacés", async () => {
  const { fake } = setup();
  await put(message({ text: "Un" }), "a");
  await put(message({ text: "Deux" }), "b");
  await processDue(NOON, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Un"]);
  await processDue(NOON + 3000, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Un"]);
  await processDue(NOON + 4000, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Un", "Deux"]);
});

test("fournisseur lu dans les réglages : aucun par défaut, WAHA avec adresse, clé et session", async () => {
  setup();
  const fake = createFakeWaha("cle-essai");
  assert.equal(await providerFromSettings(fake.fetch), null);
  await setSetting("whatsapp.fournisseur", "waha", null, NOON);
  await setSetting("waha.cle", "cle-essai", null, NOON);
  const provider = await providerFromSettings(fake.fetch);
  assert.deepEqual(await provider!.status(), { state: "deconnecte" });
});

test("document (vague 2) : PDF produit au moment de l'envoi, envoyé avec le texte en légende ; facture entièrement reprise : ignoré ; document introuvable : échec définitif", async () => {
  const { fake } = setup();
  const asked: unknown[] = [];
  const files: Record<number, Awaited<ReturnType<NonNullable<Parameters<typeof createWhatsappHandler>[0]["document"]>>>> = {
    1: { name: "F-2026-000012.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 essai") },
    2: "annulee",
    3: null,
  };
  const waha = createWaha({ baseUrl: "http://waha", apiKey: "cle-essai", session: "default", fetch: fake.fetch });
  const pacer = createPacer({ random: () => 0 });
  registerHandler(WHATSAPP_KIND, createWhatsappHandler({ provider: async () => waha, document: async (d) => { asked.push(d); return files[d.id]; } }, pacer), undefined, pacer);
  const ticket = (id: number) => message({ text: `Votre ticket ${id}`, document: { kind: "invoice", id }, origin: { type: "ticket", clientId: 1 } });
  await put(ticket(1), "t1");
  await put(ticket(2), "t2", NOON + 1);
  await put(ticket(3), "t3", NOON + 2);
  for (let i = 0; i < 3; i++) await processDue(NOON + i * 10_000, true);
  assert.deepEqual(asked, [{ kind: "invoice", id: 1 }, { kind: "invoice", id: 2 }, { kind: "invoice", id: 3 }]);
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Votre ticket 1", file: { mimetype: "application/pdf", filename: "F-2026-000012.pdf", size: 14 } }]);
  const rows = (await listOutbox()).sort((a, b) => a.dedupe_key.localeCompare(b.dedupe_key)).map((r) => [r.dedupe_key, r.status, r.manual, decode("fr", r.last_error)]);
  assert.deepEqual(rows, [["t1", "sent", "", ""], ["t2", "sent", "ignored", ""], ["t3", "failed", "", "Document introuvable."]]);
});

test("document sans moyen de le produire, ou fournisseur qui n'envoie pas de document : échec définitif, à envoyer à la main", async () => {
  setup();
  const pacer = createPacer({ random: () => 0 });
  const textOnly = { status: async () => ({ state: "connecte" as const }), sendText: async () => undefined };
  registerHandler(WHATSAPP_KIND, createWhatsappHandler({ provider: async () => textOnly, document: async () => ({ name: "a.pdf", mime: "application/pdf", data: Buffer.from("x") }) }, pacer), undefined, pacer);
  await put(message({ document: { kind: "deposit", id: 1 }, origin: { type: "ticket", clientId: 1 } }));
  await processDue(NOON, true);
  assert.equal(decode("fr", (await only()).last_error), "Ce fournisseur WhatsApp n'envoie pas de document.");
});

/** Produit recommandé (images des produits) : la charge ne garde que l'identifiant du produit et le texte. */
const produit = (id: number, over: Partial<WhatsappMessage> = {}) => message({ text: `Produit ${id}`, product: { id }, origin: { type: "produit", clientId: 1 }, ...over });

test("produit avec photo : photo lue au moment de l'envoi, envoyée par sendImage avec le texte en légende ; jamais gardée dans la file", async () => {
  const { db, fake } = setup();
  db.exec("INSERT INTO products (id, name, price) VALUES (3, 'Sérum Karité', 12000)");
  await saveProductImage(3, "image/png", PNG_1PX, NOON);
  await put(produit(3));
  await processDue(NOON, true);
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Produit 3", file: { mimetype: "image/png", filename: "produit-3.png", size: PNG_1PX.length }, image: true }]);
  assert.equal((await only()).status, "sent");
  const payload = JSON.parse((db.prepare("SELECT payload FROM outbox").get() as { payload: string }).payload);
  assert.deepEqual(payload, { to: "237699123456", lang: "fr", text: "Produit 3", product: { id: 3 }, origin: { type: "produit", clientId: 1 } });
});

test("produit sans photo : le texte part seul ; produit supprimé avant l'envoi : message ignoré, rien d'envoyé", async () => {
  const { db, fake } = setup();
  db.exec("INSERT INTO products (id, name, price) VALUES (3, 'Sérum Karité', 12000), (4, 'Huile de coco', 5000)");
  await saveProductImage(4, "image/png", PNG_1PX, NOON);
  await put(produit(3), "a");
  await put(produit(4), "b", NOON + 1);
  db.exec("DELETE FROM products WHERE id = 4");
  await processDue(NOON, true);
  await processDue(NOON + 10_000, true);
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Produit 3" }]);
  const rows = (await listOutbox()).sort((x, y) => x.dedupe_key.localeCompare(y.dedupe_key)).map((r) => [r.dedupe_key, r.status, r.manual]);
  assert.deepEqual(rows, [["a", "sent", ""], ["b", "sent", "ignored"]]);
});

test("photo retirée entre la demande et l'envoi : le texte part seul ; cliente « Aucun » : geste volontaire, envoyé", async () => {
  const { db, fake } = setup();
  db.exec("INSERT INTO products (id, name, price) VALUES (3, 'Sérum Karité', 12000)");
  await saveProductImage(3, "image/png", PNG_1PX, NOON);
  db.exec("UPDATE clients SET channel = 'none' WHERE id = 1");
  await put(produit(3));
  await deleteProductImage(3);
  await processDue(NOON, true);
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Produit 3" }]);
});

test("produit et SMS : cliente « SMS », sans photo, le texte part par SMS ; avec photo, jamais par SMS ; numéro sans WhatsApp : la photo ne bascule pas en SMS", async () => {
  const { db, fake } = setup();
  db.exec("INSERT INTO products (id, name, price) VALUES (3, 'Sérum Karité', 12000), (4, 'Huile de coco', 5000)");
  await saveProductImage(4, "image/png", PNG_1PX, NOON);
  const smsSent: string[] = [];
  const sms = { status: async () => ({ state: "joignable" }), sendText: async (_to: string, text: string) => { smsSent.push(text); } } as unknown as SmsProvider;
  const waha = createWaha({ baseUrl: "http://waha", apiKey: "cle-essai", session: "default", fetch: fake.fetch });
  const pacer = createPacer({ random: () => 0 });
  registerHandler(WHATSAPP_KIND, createWhatsappHandler({ provider: async () => waha, sms: async () => sms }, pacer), undefined, pacer);
  db.exec("UPDATE clients SET channel = 'sms' WHERE id = 1");
  await put(produit(3), "a");
  await put(produit(4), "b", NOON + 1);
  await processDue(NOON + 10_000, true);
  await processDue(NOON + 20_000, true);
  assert.deepEqual(smsSent, ["Produit 3"]);
  const b = (await listOutbox()).find((r) => r.dedupe_key === "b")!;
  assert.deepEqual([b.status, decode("fr", b.last_error)], ["failed", "La cliente reçoit ses messages par SMS\u00a0: photo à envoyer à la main."]);
  db.exec("UPDATE clients SET channel = 'whatsapp' WHERE id = 1");
  fake.unknownNumbers.add("237699123456");
  await put(produit(4), "c", NOON + 30_000);
  await processDue(NOON + 30_000, true);
  const c = (await listOutbox()).find((r) => r.dedupe_key === "c")!;
  assert.deepEqual([c.status, decode("fr", c.last_error)], ["failed", "Ce numéro n'a pas WhatsApp."]);
  assert.deepEqual(smsSent, ["Produit 3"], "la photo ne part jamais par SMS");
  assert.equal((db.prepare("SELECT channel FROM clients WHERE id = 1").get() as { channel: string }).channel, "whatsapp", "fiche inchangée : rien n'est parti par SMS");
});

test("produit sans fournisseur WhatsApp : à envoyer à la main ; fournisseur qui n'envoie ni photo ni document : échec définitif expliqué", async () => {
  const { db } = setup("aucun");
  db.exec("INSERT INTO products (id, name, price) VALUES (3, 'Sérum Karité', 12000)");
  await saveProductImage(3, "image/png", PNG_1PX, NOON);
  await put(produit(3), "a");
  await processDue(NOON, true);
  assert.equal(decode("fr", (await only()).last_error), "Aucun fournisseur WhatsApp\u00a0: à envoyer à la main.");
  const pacer = createPacer({ random: () => 0 });
  const textOnly = { status: async () => ({ state: "connecte" as const }), sendText: async () => undefined };
  registerHandler(WHATSAPP_KIND, createWhatsappHandler({ provider: async () => textOnly }, pacer), undefined, pacer);
  await put(produit(3), "b", NOON + 10_000);
  await processDue(NOON + 10_000, true);
  const b = (await listOutbox()).find((r) => r.dedupe_key === "b")!;
  assert.equal(decode("fr", b.last_error), "Ce fournisseur WhatsApp n'envoie pas de photo.");
});

test("anniversaire : part s'il est toujours d'actualité ; ignoré si la date a changé ou si la relance est décochée (décision 26)", async () => {
  const { db, fake } = setup();
  db.exec("UPDATE clients SET birthday = '10-01'");
  await setSetting("relances.anniversaire", true, null, NOON);
  const birthday = (key: string) => put(message({ text: `Anniversaire ${key}`, origin: { type: "anniversaire", clientId: 1, birthday: "10-01" } }), key);
  await birthday("a");
  await processDue(NOON, true);
  db.exec("UPDATE clients SET birthday = '10-02'");
  await birthday("b");
  await processDue(NOON + 10e3, true);
  db.exec("UPDATE clients SET birthday = '10-01'");
  await setSetting("relances.anniversaire", false, null, NOON);
  await birthday("c");
  await processDue(NOON + 20e3, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Anniversaire a"]);
  assert.deepEqual((await listOutbox()).map((i) => [i.dedupe_key, i.manual]).sort(), [["a", ""], ["b", "ignored"], ["c", "ignored"]]);
});

test("anniversaire en retard : ignoré le lendemain (internet ou session tombés), 29 février fêté le 28 d'une année non bissextile", async () => {
  const { db, fake } = setup();
  db.exec("UPDATE clients SET birthday = '10-01'");
  await setSetting("relances.anniversaire", true, null, NOON);
  await put(message({ text: "Anniversaire en retard", origin: { type: "anniversaire", clientId: 1, birthday: "10-01" } }), "late", NOON);
  await processDue(NOON + 20 * 3600e3, true); // le 2 octobre, 8 h à Douala
  assert.deepEqual(fake.sent, []);
  assert.deepEqual((await listOutbox()).map((i) => [i.dedupe_key, i.manual]), [["late", "ignored"]]);
  // Même règle que la détection (`birthdaysOf`) : le 29 février se fête le 28 d'une année non bissextile.
  db.exec("UPDATE clients SET birthday = '02-29'");
  const leapling = message({ text: "x", origin: { type: "anniversaire", clientId: 1, birthday: "02-29" } });
  const doualaNoon = (day: string) => Date.parse(`${day}T11:00:00Z`);
  assert.equal(await withoutPurpose(leapling, doualaNoon("2027-02-28")), false);
  assert.equal(await withoutPurpose(leapling, doualaNoon("2027-03-01")), true);
  assert.equal(await withoutPurpose(leapling, doualaNoon("2028-02-28")), true, "année bissextile : le 29 seulement");
  assert.equal(await withoutPurpose(leapling, doualaNoon("2028-02-29")), false);
  // Juste avant minuit à Douala (UTC+1), c'est encore le jour même.
  db.exec("UPDATE clients SET birthday = '10-01'");
  const onTime = message({ text: "x", origin: { type: "anniversaire", clientId: 1, birthday: "10-01" } });
  assert.equal(await withoutPurpose(onTime, Date.parse("2026-10-01T22:59:00Z")), false);
  assert.equal(await withoutPurpose(onTime, Date.parse("2026-10-01T23:00:00Z")), true);
});

test("« vous nous manquez » : ignoré après une visite, un rendez-vous pris ou la case décochée (décision 26)", async () => {
  const { db, fake } = setup();
  db.exec(`UPDATE appointments SET status = 'cancelled' WHERE id = 1;
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time, status) VALUES (2, 'APT-2', 1, '2026-08-01', '10:00', 'completed');`);
  await setSetting("relances.absence", true, null, NOON);
  const absence = (key: string) => put(message({ text: `Absence ${key}`, origin: { type: "absence", clientId: 1, lastVisit: "2026-08-01" } }), key);
  await absence("a");
  await processDue(NOON, true);
  db.exec("INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time, status) VALUES (3, 'APT-3', 1, '2026-10-05', '10:00', 'booked')");
  await absence("b");
  await processDue(NOON + 10e3, true);
  db.exec("UPDATE appointments SET status = 'completed', scheduled_date = '2026-09-30' WHERE id = 3");
  await absence("c");
  await processDue(NOON + 20e3, true);
  db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 3");
  await setSetting("relances.absence", false, null, NOON);
  await absence("d");
  await processDue(NOON + 30e3, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Absence a"]);
  assert.deepEqual((await listOutbox()).map((i) => [i.dedupe_key, i.manual]).sort(), [["a", ""], ["b", "ignored"], ["c", "ignored"], ["d", "ignored"]]);
});

test("« vous nous manquez » : ignoré pendant un soin en cours (in_progress)", async () => {
  const { db, fake } = setup();
  db.exec(`UPDATE appointments SET status = 'cancelled' WHERE id = 1;
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time, status) VALUES (2, 'APT-2', 1, '2026-08-01', '10:00', 'completed'),
             (3, 'APT-3', 1, '2026-10-01', '10:00', 'in_progress');`);
  await setSetting("relances.absence", true, null, NOON);
  put(message({ text: "Absence soin", origin: { type: "absence", clientId: 1, lastVisit: "2026-08-01" } }), "soin");
  await processDue(NOON, true);
  assert.deepEqual(fake.sent, []);
  assert.deepEqual((await listOutbox()).map((i) => [i.dedupe_key, i.manual]), [["soin", "ignored"]]);
});

test("campagne : message automatique, silence respecté, cliente passée à « Aucun » ignorée (décision 22)", async () => {
  const { db, fake } = setup();
  const night = Date.parse("2026-10-01T21:30:00Z"); // 22:30 à Douala
  db.exec("INSERT INTO clients (id, name, phone) VALUES (2, 'Brenda', '699000002')");
  await put(message({ text: "Campagne 1", origin: { type: "campagne", clientId: 1, campaignId: 1 } }), "a", night);
  await put(message({ text: "Campagne 2", origin: { type: "campagne", clientId: 2, campaignId: 1 } }), "b", night);
  await processDue(night, true);
  const waiting = (await listOutbox()).find((i) => i.dedupe_key === "a")!;
  assert.equal(waiting.status, "pending");
  assert.equal(decode("fr", waiting.last_error), "Fenêtre sans envoi\u00a0: le message partira à la fin.");
  assert.equal(fake.sent.length, 0);
  db.exec("UPDATE clients SET channel = 'none' WHERE id = 2");
  const morning = Date.parse("2026-10-02T07:00:00Z"); // 08:00 à Douala
  await processDue(morning, true);
  await processDue(morning + 10e3, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Campagne 1"]);
  assert.equal((await listOutbox()).find((i) => i.dedupe_key === "b")!.manual, "ignored");
});

test("mini CRM désactivé : anniversaire et absence déjà en file deviennent sans objet ; réactivé, elles repartent (interrupteur général)", async () => {
  const { db, fake } = setup();
  db.exec(`UPDATE clients SET birthday = '10-01'; UPDATE appointments SET status = 'cancelled' WHERE id = 1;
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time, status) VALUES (2, 'APT-2', 1, '2026-08-01', '10:00', 'completed');`);
  await setSetting("relances.anniversaire", true, null, NOON);
  await setSetting("relances.absence", true, null, NOON);
  await setSetting("crm.active", false, null, NOON);
  await put(message({ text: "Anniversaire", origin: { type: "anniversaire", clientId: 1, birthday: "10-01" } }), "a");
  await processDue(NOON, true);
  await put(message({ text: "Absence", origin: { type: "absence", clientId: 1, lastVisit: "2026-08-01" } }), "b", NOON + 10e3);
  await processDue(NOON + 10e3, true);
  assert.deepEqual(fake.sent.map((s) => s.text), []);
  assert.deepEqual((await listOutbox()).map((i) => [i.dedupe_key, i.manual]).sort(), [["a", "ignored"], ["b", "ignored"]]);
  await setSetting("crm.active", true, null, NOON);
  await put(message({ text: "Anniversaire bis", origin: { type: "anniversaire", clientId: 1, birthday: "10-01" } }), "c", NOON + 20e3);
  await processDue(NOON + 20e3, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Anniversaire bis"], "réactivé : la relance repart");
});

test("mini CRM désactivé : une campagne déjà en file est sans objet ; réactivé avant l'envoi, elle part (interrupteur général)", async () => {
  const { fake } = setup();
  const campagne = (key: string, now: number) => put(message({ text: `Campagne ${key}`, origin: { type: "campagne", clientId: 1, campaignId: 1 } }), key, now);
  await setSetting("crm.active", false, null, NOON);
  await campagne("a", NOON);
  await processDue(NOON, true);
  assert.deepEqual(fake.sent.map((s) => s.text), []);
  await campagne("b", NOON + 10e3);
  await setSetting("crm.active", true, null, NOON);
  await processDue(NOON + 10e3, true);
  assert.deepEqual(fake.sent.map((s) => s.text), ["Campagne b"]);
  assert.deepEqual((await listOutbox()).map((i) => [i.dedupe_key, i.manual]).sort(), [["a", "ignored"], ["b", ""]]);
});

const MESSAGE_SETTINGS: MessageSettings = {
  lang: "fr", institut: "Institut Ébène", telephone: "", indicatif: "237", silenceStart: "21:00", silenceEnd: "08:00", reminderHours: 24, texts: DEFAULT_TEXTS,
};

test("message de transfert : prénom de la nouvelle praticienne, clé par praticienne et par écriture, praticienne dans l'origine ; rien sans praticienne", () => {
  const { db } = setup();
  db.exec(`INSERT INTO staff (id, name) VALUES (2, 'Grace Nkeng');
           INSERT INTO services (id, name, name_en) VALUES (1, 'Tresses', 'Braids');
           INSERT INTO appointment_services (appointment_id, service_id) VALUES (1, 1);
           UPDATE appointments SET staff_id = 2 WHERE id = 1;`);
  const built = appointmentMessage(db, MESSAGE_SETTINGS, "transfert", 1, NOON)!;
  assert.equal(built.message.text, "Bonjour Aïcha, votre rendez-vous Tresses du samedi 3 octobre à 10:00 chez Institut Ébène sera assuré par Grace.");
  assert.equal(built.dedupeKey, `wa:transfert:1:2:2026-10-03 10:00:${NOON}`);
  assert.deepEqual(built.message.origin, { type: "transfert", appointmentId: 1, clientId: 1, at: AT, staffId: 2 });
  assert.equal(appointmentMessage(db, MESSAGE_SETTINGS, "confirmation", 1, NOON)!.message.origin.staffId, undefined, "la confirmation ne porte pas la praticienne");
  db.exec("UPDATE appointments SET staff_id = NULL WHERE id = 1");
  assert.equal(appointmentMessage(db, MESSAGE_SETTINGS, "transfert", 1, NOON), null, "pas de transfert vers « Non attribué »");
});

test("transfert : sans objet si le rendez-vous a changé de praticienne, d'heure ou de statut depuis ; sinon il part", async () => {
  const { db } = setup();
  db.exec("INSERT INTO staff (id, name) VALUES (2, 'Grace Nkeng'), (3, 'Mireille Fotso'); UPDATE appointments SET staff_id = 2 WHERE id = 1;");
  const transfer = message({ origin: { type: "transfert", appointmentId: 1, clientId: 1, at: AT, staffId: 2 } });
  assert.equal(await withoutPurpose(transfer, NOON), false);
  db.exec("UPDATE appointments SET staff_id = 3 WHERE id = 1");
  assert.equal(await withoutPurpose(transfer, NOON), true, "retransféré à Mireille : le message pour Grace n'a plus lieu d'être");
  db.exec("UPDATE appointments SET staff_id = 2, start_time = '11:00' WHERE id = 1");
  assert.equal(await withoutPurpose(transfer, NOON), true, "déplacé à une autre heure");
  db.exec("UPDATE appointments SET start_time = '10:00', status = 'cancelled' WHERE id = 1");
  assert.equal(await withoutPurpose(transfer, NOON), true, "annulé");
  db.exec("UPDATE appointments SET status = 'booked', staff_id = 3 WHERE id = 1");
  assert.equal(await withoutPurpose(message(), NOON), false, "une confirmation ne dépend pas de la praticienne");
  db.exec("UPDATE clients SET channel = 'none' WHERE id = 1; UPDATE appointments SET staff_id = 2 WHERE id = 1;");
  assert.equal(await withoutPurpose(transfer, NOON), true, "cliente en « Aucun » : message automatique, rien ne part");
});
