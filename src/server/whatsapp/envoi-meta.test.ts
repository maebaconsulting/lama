import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { clearHandlers, enqueue, processDue, registerHandler } from "../outbox/outbox.ts";
import { decode } from "../messages.ts";
import { setMasterKey } from "../settings.ts";
import { saveLogo } from "../institut/logos.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { saveProductImage } from "../produits/images.ts";
import type { SmsProvider } from "../sms/passerelle.ts";
import { createFakeMeta, registerLamaTemplates } from "./faux-meta.ts";
import { createFakeWaha } from "./faux-waha.ts";
import { createMeta, oublierEtatsMeta } from "./meta.ts";
import { appointmentAt } from "./numeros.ts";
import { createPacer, createWhatsappHandler, WHATSAPP_KIND, type DocumentSource, type WhatsappMessage } from "./envoi.ts";
import type { WhatsappProvider } from "./fournisseur.ts";
import { createWaha } from "./waha.ts";

/** File d'envoi avec WhatsApp Business (spec du 21/10/2026, W-2, W-5, W-7, W-17, W-18, W-20). */

const NOON = Date.parse("2026-10-01T11:00:00Z"); // midi à Douala
const AT = appointmentAt("2026-10-03", "10:00");
const PDF = { name: "F-2026-000012.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 essai") };
const VALEURS = { prenom: "Aïcha", nom: "Aïcha Mbarga", date: "samedi 3 octobre", heure: "10:00", prestation: "Tresses", institut: "Institut Ébène", telephone: "699 00 00 00" };

function setup(opts: { document?: DocumentSource; sms?: SmsProvider; provider?: "meta" | "waha" } = {}) {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  setMasterKey(new Uint8Array(32).fill(7));
  clearHandlers();
  oublierEtatsMeta();
  db.exec(`INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456');
           INSERT INTO appointments (id, identifier, client_id, scheduled_date, start_time) VALUES (1, 'APT-1', 1, '2026-10-03', '10:00');`);
  const fake = createFakeMeta();
  registerLamaTemplates(fake);
  const waha = createFakeWaha("cle-essai");
  waha.scan();
  const provider: WhatsappProvider = opts.provider === "waha"
    ? createWaha({ baseUrl: "http://waha", apiKey: "cle-essai", session: "default", fetch: waha.fetch })
    : createMeta({ numero: fake.phoneId, compte: fake.wabaId, jeton: fake.token, noms: null, etats: null, fetch: fake.fetch });
  const pacer = createPacer({ random: () => 0 });
  const handler = createWhatsappHandler({ provider: async () => provider, sms: async () => opts.sms ?? null, document: opts.document ?? (async () => PDF) }, pacer);
  registerHandler(WHATSAPP_KIND, handler, undefined, pacer);
  const ligne = () => ({ ...(db.prepare("SELECT status, channel, provider_ref, last_error, manual FROM outbox ORDER BY id LIMIT 1").get() as Record<string, unknown>) });
  return { db, fake, waha, ligne };
}

const rappel = (over: Partial<WhatsappMessage> = {}): WhatsappMessage => ({
  to: "237699123456", lang: "fr", text: "Bonjour Aïcha, rappel.", modele: "rappel", valeurs: VALEURS,
  origin: { type: "rappel", appointmentId: 1, clientId: 1, at: AT }, ...over,
});
const TICKET: WhatsappMessage = {
  to: "237699123456", lang: "fr", text: "Voici votre ticket", modele: "ticket",
  valeurs: { prenom: "Aïcha", document: "ticket F-2026-000012", institut: "Institut Ébène" },
  document: { kind: "invoice", id: 1 }, origin: { type: "ticket", clientId: 1 },
};
const put = (m: WhatsappMessage, key = "k") => enqueue({ kind: WHATSAPP_KIND, payload: m, dedupeKey: key, now: NOON });

test("rappel avec modèle : part par l'API officielle avec ses valeurs ; wamid gardé avec l'envoi, canal WhatsApp (W-7)", async () => {
  const { fake, ligne } = setup();
  await put(rappel());
  await processDue(NOON, true);
  assert.deepEqual(fake.sent.map((s) => s.template), [{ name: "lama_rappel", language: "fr", body: ["Aïcha", "Tresses", "samedi 3 octobre", "10:00", "Institut Ébène"] }]);
  assert.deepEqual(ligne(), { status: "sent", channel: "whatsapp", provider_ref: "wamid.essai1", last_error: "", manual: "" });
});

test("message mis en file avant la mise à jour (sans modèle) : message libre ; hors de la fenêtre de 24 h, à envoyer à la main avec son motif (W-2, W-5)", async () => {
  const { fake, ligne } = setup();
  await put(rappel({ modele: undefined, valeurs: undefined }));
  await processDue(NOON, true);
  assert.equal(ligne().status, "failed");
  assert.equal(decode("fr", String(ligne().last_error)), "Fenêtre de 24\u00a0h fermée\u00a0: la cliente n'a pas écrit à l'institut depuis plus de 24\u00a0h.");
  fake.window.add("237699123456");
  await put(rappel({ modele: undefined, valeurs: undefined }), "k2");
  await processDue(NOON + 10_000, true);
  assert.deepEqual(fake.sent.map((s) => [s.type, s.text]), [["text", "Bonjour Aïcha, rappel."]]);
});

test("ticket : PDF produit à l'envoi, déposé chez Meta, modèle avec en-tête document (W-17)", async () => {
  const { fake, ligne } = setup();
  await put(TICKET);
  await processDue(NOON, true);
  assert.deepEqual(fake.sent[0].template, {
    name: "lama_ticket", language: "fr", header: { type: "document", media: "media-1", filename: "F-2026-000012.pdf" },
    body: ["Aïcha", "ticket F-2026-000012", "Institut Ébène"],
  });
  assert.equal(ligne().status, "sent");
});

test("facture entièrement reprise par un avoir (Review Focus 5) : ignorée, rien déposé ni envoyé chez Meta", async () => {
  const { fake, ligne } = setup({ document: async () => "annulee" });
  await put(TICKET);
  await processDue(NOON, true);
  assert.deepEqual([ligne().status, ligne().manual], ["sent", "ignored"]);
  assert.deepEqual(fake.calls, []);
});

test("produit : photo en en-tête image ; sans photo, logo de l'institut ; sans photo ni logo, message libre (W-17)", async () => {
  const { db, fake } = setup();
  fake.window.add("237699123456");
  db.exec("INSERT INTO products (id, name, price) VALUES (3, 'Sérum Karité', 12000), (4, 'Huile de coco', 4500)");
  await saveProductImage(3, "image/png", PNG_1PX, NOON);
  const produit = (id: number): WhatsappMessage => ({
    to: "237699123456", lang: "fr", text: `Produit ${id}`, modele: "produit",
    valeurs: { prenom: "Aïcha", produit: `Produit ${id}`, prix: "4\u202f500\u00a0FCFA", institut: "Institut Ébène" },
    product: { id }, origin: { type: "produit", clientId: 1 },
  });
  await put(produit(4), "sans-logo");
  await processDue(NOON, true);
  await put(produit(3), "photo");
  await processDue(NOON + 10_000, true);
  await saveLogo("clair", "image/png", PNG_1PX, null, NOON);
  await put(produit(4), "logo");
  await processDue(NOON + 20_000, true);
  assert.deepEqual(fake.sent.map((s) => [s.type, s.text ?? s.template?.header?.type]), [["text", "Produit 4"], ["template", "image"], ["template", "image"]]);
  assert.deepEqual([...fake.media.values()].map((m) => m.filename), ["produit-3.png", "logo.png"]);
});

test("limite de Meta : temporaire, la file relance ; jeton refusé : définitif, le SMS de secours part (W-6)", async () => {
  const smsSent: string[] = [];
  const sms = { status: async () => ({ state: "joignable" }), sendText: async (_to: string, text: string) => { smsSent.push(text); } } as unknown as SmsProvider;
  const { fake, ligne } = setup({ sms });
  fake.failNext = { status: 400, code: 131056 };
  await put(rappel());
  await processDue(NOON, true);
  assert.equal(ligne().status, "pending");
  assert.equal(decode("fr", String(ligne().last_error)), "Limite d'envoi de Meta atteinte.");
  fake.failNext = { status: 401, code: 190 };
  await processDue(NOON + 60_000, true);
  assert.deepEqual(smsSent, ["Bonjour Aïcha, rappel."]);
  assert.deepEqual([ligne().status, ligne().channel, ligne().provider_ref], ["sent", "sms", ""]);
});

test("WAHA inchangé (W-20) : un message avec modèle et valeurs part avec son texte, comme avant", async () => {
  const { waha, ligne } = setup({ provider: "waha" });
  await put(rappel());
  await processDue(NOON, true);
  assert.deepEqual(waha.sent.map((s) => s.text), ["Bonjour Aïcha, rappel."]);
  assert.deepEqual([ligne().channel, ligne().provider_ref], ["whatsapp", ""]);
});

test("débit (W-18) : un envoi à la fois, dépôt du fichier et envoi comptés pour un ; le suivant attend son tour", async () => {
  const { fake } = setup();
  await put(TICKET, "a");
  await put(rappel(), "b");
  await processDue(NOON, true);
  assert.equal(fake.sent.length, 1);
  await processDue(NOON + 3_999, true);
  assert.equal(fake.sent.length, 1);
  await processDue(NOON + 4_000, true);
  assert.equal(fake.sent.length, 2);
});
