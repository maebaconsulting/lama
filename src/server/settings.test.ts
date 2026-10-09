import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

test("chaque rôle ne voit que ses rubriques ; valeurs par défaut", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const keys = (await gerante("GET", "/api/settings")).body.settings.map((s: { key: string }) => s.key);
  assert.ok(keys.includes("institut.nom"));
  assert.ok(keys.includes("postes.verrouillage_minutes"));
  assert.ok(!keys.includes("technique.drive_remote"));
  const admin = await ctx.as("admin");
  const adminKeys = (await admin("GET", "/api/settings")).body.settings.map((s: { key: string }) => s.key);
  assert.ok(adminKeys.includes("technique.drive_remote"));
  assert.ok(!adminKeys.includes("institut.nom"));
});

test("validation et enregistrement d'un réglage métier", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", "/api/settings/postes.verrouillage_minutes", { value: 90 })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/postes.verrouillage_minutes", { value: 10 })).status, 200);
  const s = (await gerante("GET", "/api/settings")).body.settings.find((x: { key: string }) => x.key === "postes.verrouillage_minutes");
  assert.equal(s.value, 10);
  assert.equal((await gerante("PUT", "/api/settings/technique.drive_remote", { value: "x:y" })).status, 403);
});

test("un secret est chiffré en base, masqué à l'écran, et exige la confirmation", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.as("admin");
  assert.equal((await admin("PUT", "/api/settings/whatsapp.jeton_acces", { value: "EAAG-secret" })).body.code, "confirmation");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await admin("PUT", "/api/settings/whatsapp.jeton_acces", { value: "EAAG-secret" })).status, 200);
  const row = ctx.db.prepare("SELECT value, secret FROM settings WHERE key = 'whatsapp.jeton_acces'").get() as { value: string; secret: number };
  assert.equal(row.secret, 1);
  assert.ok(!row.value.includes("EAAG-secret"));
  const shown = (await admin("GET", "/api/settings")).body.settings.find((x: { key: string }) => x.key === "whatsapp.jeton_acces");
  assert.deepEqual({ value: shown.value, set: shown.set }, { value: null, set: true });
});

test("sans clé maîtresse, écrire un réglage secret échoue proprement", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  // Retire la clé maîtresse posée par le harnais, pour simuler un redémarrage
  // sans configuration ; la même mutation n'affecte aucun autre test (chaque
  // `setupApp` a son propre objet `env`).
  (ctx.env as { MASTER_KEY?: Uint8Array }).MASTER_KEY = undefined;
  const res = await admin("PUT", "/api/settings/whatsapp.jeton_acces", { value: "EAAG-secret" });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "Master key not loaded: restart the server." });
});

test("réglages SMS : adresse du réseau local, délais bornés, mot de passe jamais renvoyé", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await admin("PUT", "/api/settings/sms.fournisseur", { value: "passerelle" })).status, 200);
  assert.equal((await admin("PUT", "/api/settings/sms.adresse", { value: "192.168.1.60" })).status, 200);
  assert.equal((await admin("PUT", "/api/settings/sms.adresse", { value: "8.8.8.8" })).status, 400);
  assert.equal((await admin("PUT", "/api/settings/sms.identifiant", { value: "sms" })).status, 200);
  assert.equal((await admin("PUT", "/api/settings/sms.mot_de_passe", { value: "secret-du-telephone" })).status, 200);
  const seen = (await admin("GET", "/api/settings")).body.settings.find((s: { key: string }) => s.key === "sms.mot_de_passe");
  assert.deepEqual(seen, { key: "sms.mot_de_passe", secret: true, value: null, set: true });
  const gerante = await ctx.as("manager");
  const keys = (await gerante("GET", "/api/settings")).body.settings.map((s: { key: string }) => s.key);
  assert.ok(!keys.includes("sms.mot_de_passe") && !keys.includes("sms.adresse"), "réglages de la passerelle à l'administrateur seulement");
  assert.equal((await gerante("PUT", "/api/settings/sms.delai_rendez_vous_minutes", { value: 120 })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/sms.delai_rendez_vous_minutes", { value: 10 })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/sms.delai_libre_minutes", { value: 241 })).status, 400);
});
