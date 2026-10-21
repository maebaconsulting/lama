import assert from "node:assert/strict";
import { test } from "node:test";
import { relaisEssai } from "../../../relais/essais/relais.ts";
import { setupApp, type Caller } from "../test-support.ts";

const reglage = async (call: Caller, key: string) => ((await call("GET", "/api/settings")).body.settings as { key: string; value: unknown; secret: boolean; set: boolean }[]).find((s) => s.key === key);
const FR = { "Accept-Language": "fr" };

test("réservation en ligne : désactivée par défaut, réglée par la gérante ; liaison par l'administrateur, clé jamais relue", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const a = await ctx.as("admin");
  assert.deepEqual(
    await Promise.all(["en_ligne.active", "en_ligne.horizon_jours", "en_ligne.delai_minimal_heures", "en_ligne.theme", "en_ligne.adresse", "en_ligne.salon"].map(async (k) => (await reglage(g, k))?.value)),
    [false, 30, 2, null, "", ""],
  );
  assert.match(String((await reglage(g, "en_ligne.texte_donnees.fr"))?.value), /Vos coordonnées servent seulement/);
  assert.equal((await g("PUT", "/api/settings/en_ligne.active", { value: true })).status, 200);
  assert.equal((await g("PUT", "/api/settings/en_ligne.adresse", { value: "https://rdv.exemple.com" })).status, 200);
  assert.equal((await g("PUT", "/api/settings/en_ligne.salon", { value: "eclat" })).status, 403, "la gérante lit le salon, ne l'écrit pas");
  await a("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await a("PUT", "/api/settings/en_ligne.salon", { value: "eclat" })).status, 200);
  assert.equal((await a("PUT", "/api/settings/en_ligne.cle", { value: "a".repeat(64) })).status, 200);
  assert.deepEqual(await reglage(a, "en_ligne.cle"), { key: "en_ligne.cle", secret: true, value: null, set: true });
  assert.equal((await reglage(g, "en_ligne.salon"))?.value, "eclat");
  assert.equal(await reglage(g, "en_ligne.cle"), undefined, "la gérante ne voit pas la clé");
  assert.equal((await reglage(a, "en_ligne.active"))?.value, true, "l'administrateur lit l'interrupteur");
  assert.equal((await a("PUT", "/api/settings/en_ligne.active", { value: false })).status, 403);
});

test("réglages refusés avec un message lisible : adresse, salon, clé, délai, horizon, texte", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const a = await ctx.as("admin");
  await a("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const refus = async (call: Caller, key: string, value: unknown) => {
    const r = await call("PUT", `/api/settings/${key}`, { value }, FR);
    assert.equal(r.status, 400, `${key} ${JSON.stringify(value)}`);
    return r.body.error as string;
  };
  assert.match(await refus(g, "en_ligne.adresse", "http://rdv.exemple.com"), /https/);
  assert.match(await refus(g, "en_ligne.adresse", "https://u:p@rdv.invalid"), /sans identifiants/);
  assert.match(await refus(a, "en_ligne.salon", "Éclat"), /minuscules/);
  assert.match(await refus(a, "en_ligne.cle", "ABC"), /64 caractères/);
  assert.match(await refus(g, "en_ligne.delai_minimal_heures", 200), /de 0 à 168 heures/);
  await refus(g, "en_ligne.horizon_jours", 120);
  await refus(g, "en_ligne.texte_donnees.fr", "");
  assert.equal((await g("PUT", "/api/settings/en_ligne.adresse", { value: "http://127.0.0.1:8790" })).status, 200, "relais local d'essai");
});

test("thème : refusé avec la raison, couleurs gardées en majuscules, retour à la charte de lama", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const theme = (v: unknown) => g("PUT", "/api/settings/en_ligne.theme", { value: v }, FR);
  assert.match((await theme({ fond: "#F3EDE3", accent: "#E0D5C5", police: "lama" })).body.error, /3:1/);
  assert.match((await theme({ fond: "#F3EDE3", accent: "#141312", police: "gothique" })).body.error, /Police inconnue/);
  assert.match((await theme({ fond: "ivoire", accent: "#141312", police: "lama" })).body.error, /#RRGGBB/);
  assert.equal((await theme({ fond: "#f3ede3", accent: "#141312", police: "elegante", autre: 1 })).status, 200);
  assert.deepEqual((await reglage(g, "en_ligne.theme"))?.value, { fond: "#F3EDE3", accent: "#141312", police: "elegante" });
  assert.equal((await theme(null)).status, 200);
  assert.equal((await reglage(g, "en_ligne.theme"))?.value, null);
});

test("état de la liaison et « Tester la liaison » contre le relais de référence ; page, code d'intégration, QR code", async (t) => {
  let relais: Awaited<ReturnType<typeof relaisEssai>> | null = null;
  const ctx = await setupApp(t, { demo: false, bindings: { EN_LIGNE_FETCH: (url: string, init: RequestInit) => relais!.app.fetch(new Request(url, init)) } });
  relais = await relaisEssai({ etat: "actif", maintenant: () => ctx.clock.now });
  const g = await ctx.as("manager");
  const a = await ctx.as("admin");
  const vierge = (await g("GET", "/api/en-ligne/etat")).body;
  assert.deepEqual([vierge.active, vierge.reglee, vierge.page, vierge.integration, vierge.dernier_succes_le], [false, false, null, null, null]);
  assert.equal((await g("POST", "/api/en-ligne/tester", {}, FR)).status, 409);
  assert.equal((await g("GET", "/api/en-ligne/qr")).status, 404);
  await g("PUT", "/api/settings/en_ligne.adresse", { value: "https://relais.exemple/" });
  await a("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  await a("PUT", "/api/settings/en_ligne.salon", { value: "eclat" });
  await a("PUT", "/api/settings/en_ligne.cle", { value: "0".repeat(64) });
  const refus = (await g("POST", "/api/en-ligne/tester", {}, FR)).body;
  assert.deepEqual(refus, { ok: false, message: "Le relais refuse l'identifiant du salon ou la clé partagée." });
  assert.equal((await g("GET", "/api/en-ligne/etat", undefined, FR)).body.derniere_erreur, "Le relais refuse l'identifiant du salon ou la clé partagée.");
  await a("PUT", "/api/settings/en_ligne.cle", { value: relais.cles.eclat });
  const ok = (await g("POST", "/api/en-ligne/tester", {}, FR)).body;
  assert.deepEqual([ok.ok, ok.mode_essai, ok.demandes_en_attente], [true, false, 0]);
  assert.match(ok.message, /^Liaison établie/);
  const etat = (await a("GET", "/api/en-ligne/etat")).body;
  assert.deepEqual([etat.reglee, etat.derniere_erreur, etat.dernier_succes_le, etat.page], [true, null, ctx.clock.now, "https://relais.exemple/eclat/"]);
  assert.equal(etat.integration, '<script src="https://relais.exemple/integrer.js" data-salon="eclat" async></script>');
  const qr = (await g("GET", "/api/en-ligne/qr")).body;
  assert.equal(qr.page, "https://relais.exemple/eclat/");
  assert.match(Buffer.from(String(qr.image).split(",")[1], "base64").toString("utf8"), /<svg/);
  assert.equal((await a("GET", "/api/en-ligne/qr")).status, 403, "le QR code est à la gérante");
});

test("code d'intégration : une adresse avec identifiants ne casse jamais l'extrait HTML", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const a = await ctx.as("admin");
  await a("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  await a("PUT", "/api/settings/en_ligne.salon", { value: "eclat" });
  for (const adresse of ['https://u"x onload="alert(1):p@relais.invalid', "https://u:p<b>@relais.invalid", "https://u:p&q@relais.invalid"]) {
    const mise = await g("PUT", "/api/settings/en_ligne.adresse", { value: adresse });
    if (mise.status !== 200) continue; // adresse refusée : rien à afficher
    const { integration } = (await g("GET", "/api/en-ligne/etat")).body;
    assert.match(integration, /^<script src="[^"<>]*\/integrer\.js" data-salon="eclat" async><\/script>$/, adresse);
  }
  assert.equal((await g("PUT", "/api/settings/en_ligne.adresse", { value: "https://u:p@relais.invalid" })).status, 400, "identifiants refusés dans l'adresse");
});

test("mise en page de la page du salon (19/10/2026) : en-tête affiché et colonne par défaut, réglée par la gérante, largeur inconnue refusée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  assert.deepEqual([(await reglage(g, "en_ligne.entete"))?.value, (await reglage(g, "en_ligne.largeur"))?.value], [true, "colonne"]);
  assert.equal((await g("PUT", "/api/settings/en_ligne.entete", { value: false })).status, 200);
  assert.equal((await g("PUT", "/api/settings/en_ligne.largeur", { value: "pleine" })).status, 200);
  const refus = await g("PUT", "/api/settings/en_ligne.largeur", { value: "large" }, FR);
  assert.deepEqual([refus.status, refus.body.error], [400, "Largeur de la page\u00a0: «\u00a0colonne\u00a0» ou «\u00a0pleine\u00a0»."]);
  assert.deepEqual([(await reglage(g, "en_ligne.entete"))?.value, (await reglage(g, "en_ligne.largeur"))?.value], [false, "pleine"]);
});
