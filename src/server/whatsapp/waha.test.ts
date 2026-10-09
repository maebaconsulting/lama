import assert from "node:assert/strict";
import { test } from "node:test";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { decode } from "../messages.ts";
import { createFakeWaha, FAKE_QR_PNG } from "./faux-waha.ts";
import { createWaha } from "./waha.ts";

function setup() {
  const fake = createFakeWaha("cle-essai");
  const waha = createWaha({ baseUrl: "http://127.0.0.1:3000/", apiKey: "cle-essai", session: "default", fetch: fake.fetch });
  return { fake, waha };
}
const reason = (error: unknown) => decode("fr", (error as Error).message);

test("première installation : aucune session (déconnecté), le démarrage la crée, QR à scanner, scan : connecté avec le numéro", async () => {
  const { fake, waha } = setup();
  assert.deepEqual(await waha.status(), { state: "deconnecte" });
  await waha.start();
  assert.deepEqual(await waha.status(), { state: "qr" });
  fake.scan("default", "237699000000");
  assert.deepEqual(await waha.status(), { state: "connecte", phone: "237699000000" });
});

test("démarrer une session arrêtée, ou déjà démarrée, n'est pas une erreur", async () => {
  const { fake, waha } = setup();
  fake.sessions.set("default", { status: "STOPPED", me: null });
  assert.deepEqual(await waha.status(), { state: "deconnecte" });
  await waha.start();
  assert.deepEqual(await waha.status(), { state: "qr" });
  await waha.start();
  assert.deepEqual(await waha.status(), { state: "qr" });
});

test("QR code : image PNG en base64, relayée telle quelle", async () => {
  const { waha } = setup();
  await waha.start();
  assert.deepEqual(await waha.qr(), { mimetype: "image/png", data: FAKE_QR_PNG });
});

test("déconnexion : l'appareil est délié, un nouveau QR est demandé", async () => {
  const { fake, waha } = setup();
  await waha.start();
  fake.scan();
  await waha.logout();
  assert.deepEqual(await waha.status(), { state: "qr" });
});

test("envoi de texte : numéro vérifié, chatId en @c.us", async () => {
  const { fake, waha } = setup();
  await waha.start();
  fake.scan();
  await waha.sendText("237699123456", "Bonjour Aïcha");
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Bonjour Aïcha" }]);
});

test("numéro sans WhatsApp : erreur définitive, rien n'est envoyé", async () => {
  const { fake, waha } = setup();
  await waha.start();
  fake.scan();
  fake.unknownNumbers.add("237699123456");
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof PermanentError && reason(e) === "Ce numéro n'a pas WhatsApp.");
  assert.equal(fake.sent.length, 0);
});

test("réponse inattendue du contrôle d'existence (ni vrai ni faux) : erreur temporaire, pas un échec définitif", async () => {
  const odd = async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  const waha = createWaha({ baseUrl: "http://x", apiKey: "k", session: "default", fetch: odd as typeof fetch });
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof TemporaryError && reason(e) === "Réponse inattendue de la passerelle WhatsApp.");
});

test("session tombée, passerelle injoignable, limite de débit, clé refusée : erreurs temporaires", async () => {
  const { fake, waha } = setup();
  await waha.start();
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof TemporaryError && reason(e) === "Session WhatsApp non connectée.");
  fake.scan();
  fake.rateLimitNext = true;
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof TemporaryError && reason(e) === "Limite de débit de WhatsApp atteinte.");
  fake.down = true;
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof TemporaryError && reason(e) === "Passerelle WhatsApp injoignable.");
  assert.deepEqual(await waha.status(), { state: "injoignable" });
  fake.down = false;
  const wrongKey = createWaha({ baseUrl: "http://127.0.0.1:3000", apiKey: "mauvaise", session: "default", fetch: fake.fetch });
  await assert.rejects(wrongKey.sendText("237699123456", "Bonjour"), (e) => e instanceof TemporaryError && reason(e) === "Clé de la passerelle WhatsApp refusée.");
  assert.deepEqual(await wrongKey.status(), { state: "erreur" });
});

test("refus de la requête (400) : erreur définitive", async () => {
  const fake = createFakeWaha("cle-essai");
  const bad = async () => new Response(JSON.stringify({ statusCode: 400, message: "Bad Request" }), { status: 400 });
  const waha = createWaha({ baseUrl: "http://x", apiKey: "cle-essai", session: "default", fetch: bad as typeof fetch });
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof PermanentError && reason(e) === "Message refusé par WhatsApp (code 400).");
  assert.equal(fake.sent.length, 0);
});

test("délai d'attente court : une passerelle qui ne répond pas est injoignable", async () => {
  const hang = (_: unknown, init?: RequestInit) => new Promise<Response>((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(init.signal!.reason)));
  const waha = createWaha({ baseUrl: "http://x", apiKey: "k", session: "default", fetch: hang as typeof fetch, timeoutMs: 20 });
  assert.deepEqual(await waha.status(), { state: "injoignable" });
  await assert.rejects(waha.sendText("237699123456", "Bonjour"), (e) => e instanceof TemporaryError && reason(e) === "Passerelle WhatsApp injoignable.");
});

test("délai de l'envoi du texte : 45 s, contre 10 s pour les autres appels (dont le contrôle d'existence)", async () => {
  const { fake, waha } = setup();
  await waha.start();
  fake.scan();
  const original = AbortSignal.timeout;
  const seen: number[] = [];
  AbortSignal.timeout = ((ms: number) => { seen.push(ms); return original(ms); }) as typeof AbortSignal.timeout;
  try {
    await waha.sendText("237699123456", "Bonjour");
  } finally {
    AbortSignal.timeout = original;
  }
  assert.deepEqual(seen, [10_000, 45_000], "contrôle d'existence à 10 s, envoi du texte à 45 s");
});

test("en-tête X-Api-Key sur chaque appel ; la clé n'apparaît jamais dans l'adresse", async () => {
  const seen: { url: string; key: string | null }[] = [];
  const fake = createFakeWaha("cle-essai");
  const spy = (async (input: string, init: RequestInit) => {
    seen.push({ url: input, key: new Headers(init.headers).get("x-api-key") });
    return fake.fetch(input, init);
  }) as typeof fetch;
  const waha = createWaha({ baseUrl: "http://127.0.0.1:3000", apiKey: "cle-essai", session: "default", fetch: spy });
  await waha.status();
  await waha.start();
  await waha.qr();
  assert.ok(seen.length >= 3);
  assert.ok(seen.every((s) => s.key === "cle-essai" && !s.url.includes("cle-essai")));
});

test("envoi d'un document (vague 2) : numéro vérifié, POST /api/sendFile, PDF en base64, nom, type et légende", async () => {
  const { fake, waha } = setup();
  fake.scan();
  const data = Buffer.from("%PDF-1.4 essai");
  await waha.sendDocument!("237699123456", { name: "F-2026-000012.pdf", mime: "application/pdf", data }, "Votre ticket");
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Votre ticket", file: { mimetype: "application/pdf", filename: "F-2026-000012.pdf", size: data.length } }]);
  fake.unknownNumbers.add("237677000000");
  await assert.rejects(waha.sendDocument!("237677000000", { name: "a.pdf", mime: "application/pdf", data }, ""), (e) => e instanceof PermanentError && reason(e) === "Ce numéro n'a pas WhatsApp.");
  fake.drop();
  await assert.rejects(waha.sendDocument!("237699123456", { name: "a.pdf", mime: "application/pdf", data }, ""), (e) => e instanceof TemporaryError);
  assert.equal(fake.sent.length, 1);
});

test("photo d'un produit : POST /api/sendImage (vue comme une photo) ; commande refusée : repli sur /api/sendFile ; autre échec classé comme d'habitude", async () => {
  const { fake, waha } = setup();
  fake.scan();
  const data = Buffer.from("png-essai");
  const file = { name: "produit-3.png", mime: "image/png", data };
  await waha.sendImage!("237699123456", file, "Aïcha, voici Sérum Karité");
  assert.deepEqual(fake.sent, [{ session: "default", chatId: "237699123456@c.us", text: "Aïcha, voici Sérum Karité", file: { mimetype: "image/png", filename: "produit-3.png", size: data.length }, image: true }]);
  for (const status of [400, 404, 405, 422, 501]) {
    fake.sent.length = 0;
    fake.imageRefusal = status;
    await waha.sendImage!("237699123456", file, "Légende");
    assert.deepEqual(fake.sent.map((s) => [s.text, s.image ?? false, s.file?.filename]), [["Légende", false, "produit-3.png"]], `repli après ${status}`);
  }
  fake.sent.length = 0;
  fake.imageRefusal = 503;
  await assert.rejects(waha.sendImage!("237699123456", file, ""), (e) => e instanceof TemporaryError && reason(e) === "Erreur de la passerelle WhatsApp (code 503).");
  fake.imageRefusal = null;
  fake.unknownNumbers.add("237677000000");
  await assert.rejects(waha.sendImage!("237677000000", file, ""), (e) => e instanceof PermanentError && reason(e) === "Ce numéro n'a pas WhatsApp.");
  assert.equal(fake.sent.length, 0);
});
