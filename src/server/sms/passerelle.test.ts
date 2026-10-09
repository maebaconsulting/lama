import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { decode } from "../messages.ts";
import { runMigrations } from "../migrations.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { setMasterKey, setSetting } from "../settings.ts";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { createFakeGateway } from "./fausse-passerelle.ts";
import { createGateway, smsProviderFromSettings } from "./passerelle.ts";

const gateway = (fake: ReturnType<typeof createFakeGateway>, password = "secret") =>
  createGateway({ address: "192.168.1.60", username: "sms", password, fetch: fake.fetch, timeoutMs: 50 });

test("envoi : POST /message en authentification basique, numéro au format +237…, texte tel quel", async () => {
  const fake = createFakeGateway("sms", "secret");
  await gateway(fake).sendText("237699123456", "Bonjour Aïcha");
  assert.deepEqual(fake.sent, [{ phoneNumbers: ["+237699123456"], text: "Bonjour Aïcha" }]);
  assert.equal(fake.lastUrl, "http://192.168.1.60:8080/message");
});

test("échecs classés : identifiants refusés, refus, erreur du téléphone, pas de réponse", async () => {
  const fake = createFakeGateway("sms", "secret");
  await assert.rejects(gateway(fake, "faux").sendText("237699123456", "x"), (e: Error) => e instanceof TemporaryError && decode("fr", e.message) === "Identifiant ou mot de passe de la passerelle SMS refusé.");
  fake.mode = "refus";
  await assert.rejects(gateway(fake).sendText("237699123456", "x"), (e: Error) => e instanceof PermanentError && decode("fr", e.message) === "SMS refusé par la passerelle (code 400).");
  fake.mode = "erreur";
  await assert.rejects(gateway(fake).sendText("237699123456", "x"), (e: Error) => e instanceof TemporaryError && decode("fr", e.message) === "Passerelle SMS en erreur (code 500).");
  fake.mode = "muet";
  await assert.rejects(gateway(fake).sendText("237699123456", "x"), (e: Error) => e instanceof TemporaryError && decode("fr", e.message) === "Passerelle SMS injoignable.");
  assert.equal(fake.sent.length, 0);
});

test("état : joignable, identifiants refusés, injoignable", async () => {
  const fake = createFakeGateway("sms", "secret");
  assert.deepEqual(await gateway(fake).status(), { state: "joignable" });
  assert.deepEqual(await gateway(fake, "faux").status(), { state: "identifiants" });
  fake.mode = "muet";
  assert.deepEqual(await gateway(fake).status(), { state: "injoignable" });
});

test("fournisseur lu dans les réglages : aucun par défaut, passerelle seulement avec une adresse valable", async () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  setMasterKey(new Uint8Array(32).fill(7));
  const fake = createFakeGateway("sms", "secret");
  assert.equal(await smsProviderFromSettings(fake.fetch), null);
  await setSetting("sms.fournisseur", "passerelle", null, 0);
  assert.equal(await smsProviderFromSettings(fake.fetch), null, "adresse vide");
  await setSetting("sms.adresse", "192.168.1.60", null, 0);
  await setSetting("sms.identifiant", "sms", null, 0);
  await setSetting("sms.mot_de_passe", "secret", null, 0);
  const provider = await smsProviderFromSettings(fake.fetch);
  assert.deepEqual(await provider!.status(), { state: "joignable" });
});
