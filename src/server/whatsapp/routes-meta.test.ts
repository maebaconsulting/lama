import assert from "node:assert/strict";
import { test } from "node:test";
import { avecFormation, setupApp, type Reply } from "../test-support.ts";
import { createFakeMeta, registerLamaTemplates, type FakeMeta } from "./faux-meta.ts";
import { oublierEtatsMeta } from "./meta.ts";

/** Routes WhatsApp Business de l'administrateur (spec du 21/10/2026, W-9 à W-13, W-20). */

const FR = { "Accept-Language": "fr" };
const pick = (r: Reply) => [r.status, r.body.error];
const INCOMPLET = "WhatsApp Business incomplet\u00a0: identifiant du numéro, identifiant du compte ou jeton d'accès manquant.";

async function withMeta(t: Parameters<typeof setupApp>[0], fake: FakeMeta = createFakeMeta({ token: "jeton-secret-123" })) {
  oublierEtatsMeta();
  if (fake.templates.length === 0) registerLamaTemplates(fake);
  const ctx = await setupApp(t, { demo: false, bindings: { WHATSAPP_FETCH: fake.fetch } });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  for (const [key, value] of [["whatsapp.fournisseur", "meta"], ["whatsapp.meta.numero", fake.phoneId], ["whatsapp.meta.compte", fake.wabaId], ["whatsapp.jeton_acces", fake.token]] as const) {
    assert.equal((await admin("PUT", `/api/settings/${key}`, { value })).status, 200, key);
  }
  return { ctx, fake, admin, gerante: await ctx.as("manager"), reception: await ctx.as("reception") };
}

test("tester la connexion (W-11) : numéro, nom vérifié, qualité ; état « connecté » montré à la gérante et à la réception", async (t) => {
  const { admin, gerante, reception } = await withMeta(t);
  assert.deepEqual((await admin("POST", "/api/whatsapp/meta/tester")).body, { numero: "+237 6 99 00 00 00", nom: "Institut Ébène", qualite: "GREEN" });
  assert.deepEqual((await gerante("GET", "/api/whatsapp/status")).body, { provider: "meta", state: "connecte", phone: "237699000000" });
  assert.equal((await reception("GET", "/api/whatsapp/status")).body.provider, "meta");
});

test("tester la connexion (W-11) : efface l'état « connecté » gardé ; un échec se voit aussitôt à l'écran d'état", async (t) => {
  const { admin, gerante, fake } = await withMeta(t);
  assert.equal((await gerante("GET", "/api/whatsapp/status")).body.state, "connecte", "état mis en garde");
  fake.down = true;
  assert.equal((await admin("POST", "/api/whatsapp/meta/tester")).status, 502);
  assert.equal((await gerante("GET", "/api/whatsapp/status")).body.state, "injoignable", "l'état gardé n'est plus servi");
});

test("connexion refusée (W-11) : jeton refusé, identifiant inconnu, Meta injoignable, réglages incomplets", async (t) => {
  const { admin, fake } = await withMeta(t);
  fake.failNext = { status: 401, code: 190 };
  assert.deepEqual(pick(await admin("POST", "/api/whatsapp/meta/tester", undefined, FR)), [502, "Jeton d'accès de WhatsApp Business refusé ou expiré."]);
  await admin("PUT", "/api/settings/whatsapp.meta.numero", { value: "999" });
  assert.deepEqual(pick(await admin("POST", "/api/whatsapp/meta/tester", undefined, FR)), [502, "Identifiant du numéro ou du compte inconnu de Meta."]);
  fake.down = true;
  assert.deepEqual(pick(await admin("POST", "/api/whatsapp/meta/tester", undefined, FR)), [502, "Meta injoignable\u00a0: vérifiez la connexion à internet."]);
  await admin("PUT", "/api/settings/whatsapp.meta.numero", { value: "" });
  assert.deepEqual(pick(await admin("POST", "/api/whatsapp/meta/tester", undefined, FR)), [409, INCOMPLET]);
});

test("message d'essai (W-12) : modèle de confirmation, valeurs d'exemple, langue de l'écran, hors file ; refus avec le motif de Meta ; journal sans le texte", async (t) => {
  const { ctx, admin, gerante, fake } = await withMeta(t);
  await gerante("PUT", "/api/settings/institut.nom", { value: "Institut Ébène" });
  assert.equal((await admin("POST", "/api/whatsapp/meta/essai", { to: "699 12 34 56" }, { "Accept-Language": "en" })).status, 200);
  assert.equal(fake.sent[0].to, "237699123456");
  assert.deepEqual(fake.sent[0].template, { name: "lama_confirmation", language: "en", body: ["Aïcha", "Braids", "Friday 2 October", "10:00", "Institut Ébène", "699 00 00 00"] });
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n, 0, "hors file");
  assert.deepEqual(pick(await admin("POST", "/api/whatsapp/meta/essai", { to: "12" }, FR)), [400, "Numéro de téléphone impossible à normaliser."]);
  fake.templates = fake.templates.filter((x) => x.name !== "lama_confirmation");
  assert.deepEqual(pick(await admin("POST", "/api/whatsapp/meta/essai", { to: "699123456" }, FR)), [502, "Modèle lama_confirmation non approuvé par Meta."]);
  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'whatsapp.meta%' ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(journal, [{ action: "whatsapp.meta_essai", target: "237699123456" }]);
});

test("modèles (W-13) : une ligne par type, non vérifiés au départ ; « Vérifier les modèles » lit Meta et garde la date ; nom changé : non vérifié (Review Focus 3) ; texte à déposer", async (t) => {
  const { ctx, admin, fake } = await withMeta(t);
  fake.templates = fake.templates.filter((x) => !(x.name === "lama_produit" && x.language === "en"));
  fake.templates.find((x) => x.name === "lama_rappel" && x.language === "fr")!.status = "PENDING";
  const depart = (await admin("GET", "/api/whatsapp/meta/modeles")).body;
  assert.equal(depart.verifie_le, null);
  assert.equal(depart.modeles.length, 12);
  assert.deepEqual(depart.modeles[0].statut, { fr: "non_verifie", en: "non_verifie" });
  const lu = (await admin("POST", "/api/whatsapp/meta/modeles/verifier")).body;
  assert.equal(lu.verifie_le, ctx.clock.now);
  const ligne = (body: { modeles: { kind: string }[] }, kind: string) => body.modeles.find((m) => m.kind === kind) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.deepEqual(ligne(lu, "confirmation").statut, { fr: "approuve", en: "approuve" });
  assert.deepEqual(ligne(lu, "rappel").statut, { fr: "en_attente", en: "approuve" });
  assert.deepEqual(ligne(lu, "produit").statut, { fr: "approuve", en: "absent" });
  const ticket = ligne(lu, "ticket");
  assert.deepEqual([ticket.categorie, ticket.entete, ticket.nom, ticket.nom_defaut], ["utilitaire", "document", "lama_ticket", "lama_ticket"]);
  assert.equal(ticket.depot.fr.corps, "Bonjour {{1}}, voici votre {{2}} de {{3}}. Merci de votre confiance\u00a0!");
  assert.equal(ticket.depot.en.exemples.length, 3);
  assert.equal((await admin("PUT", "/api/settings/whatsapp.meta.noms", { value: { ticket: "ebene_ticket" } })).status, 200);
  const apres = (await admin("GET", "/api/whatsapp/meta/modeles")).body;
  assert.deepEqual(ligne(apres, "ticket").statut, { fr: "non_verifie", en: "non_verifie" });
  assert.equal(ligne(apres, "ticket").nom, "ebene_ticket");
  assert.equal(ctx.db.prepare("SELECT action FROM audit_log WHERE action = 'whatsapp.meta_verification'").all().length, 1);
});

test("droits (W-20) : routes WhatsApp Business à l'administrateur seul ; jeton jamais relu ; état des modèles écrit seulement par la vérification", async (t) => {
  const { ctx, admin, gerante, reception } = await withMeta(t);
  const praticienne = await ctx.as("practitioner");
  for (const call of [gerante, reception, praticienne]) {
    assert.equal((await call("GET", "/api/whatsapp/meta/modeles")).status, 403);
    assert.equal((await call("POST", "/api/whatsapp/meta/tester")).status, 403);
    assert.equal((await call("POST", "/api/whatsapp/meta/essai", { to: "699123456" })).status, 403);
    assert.equal((await call("POST", "/api/whatsapp/meta/modeles/verifier")).status, 403);
  }
  const jeton = (await admin("GET", "/api/settings")).body.settings.find((s: { key: string }) => s.key === "whatsapp.jeton_acces");
  assert.deepEqual(jeton, { key: "whatsapp.jeton_acces", secret: true, value: null, set: true });
  assert.equal((await admin("PUT", "/api/settings/whatsapp.meta.etats", { value: null })).status, 409);
});

test("passer de WhatsApp Business à WAHA et retour (W-9) : aucun réglage perdu", async (t) => {
  const { admin } = await withMeta(t);
  await admin("PUT", "/api/settings/waha.adresse", { value: "http://127.0.0.1:3001" });
  await admin("PUT", "/api/settings/whatsapp.fournisseur", { value: "waha" });
  assert.equal((await admin("GET", "/api/whatsapp/status")).body.provider, "waha");
  await admin("PUT", "/api/settings/whatsapp.fournisseur", { value: "meta" });
  const reglages = new Map((await admin("GET", "/api/settings")).body.settings.map((s: { key: string; secret: boolean; value: unknown; set: boolean }) => [s.key, s.secret ? s.set : s.value]));
  assert.deepEqual(
    ["waha.adresse", "whatsapp.meta.numero", "whatsapp.meta.compte", "whatsapp.jeton_acces", "whatsapp.fournisseur"].map((k) => reglages.get(k)),
    ["http://127.0.0.1:3001", "106540352242922", "102290129340398", true, "meta"],
  );
});

test("jeton jamais rendu ni écrit (W-10) : réponses, journal et file n'en portent aucune trace, même en échec", async (t) => {
  const { ctx, admin, fake } = await withMeta(t);
  const reponses: string[] = [];
  for (const [status, code] of [[401, 190], [500, 131000], [400, 131047]] as const) {
    fake.failNext = { status, code };
    reponses.push(JSON.stringify((await admin("POST", "/api/whatsapp/meta/essai", { to: "699123456" })).body));
  }
  fake.failNext = { status: 401, code: 190 };
  reponses.push(JSON.stringify((await admin("POST", "/api/whatsapp/meta/tester")).body));
  reponses.push(JSON.stringify((await admin("GET", "/api/settings")).body), JSON.stringify((await admin("GET", "/api/whatsapp/meta/modeles")).body));
  const traces = [
    ...reponses,
    ...ctx.db.prepare("SELECT action, target FROM audit_log").all().map((r) => JSON.stringify(r)),
    ...ctx.db.prepare("SELECT payload, last_error FROM outbox").all().map((r) => JSON.stringify(r)),
  ];
  assert.ok(traces.every((x) => !x.includes("jeton-secret-123")));
});

test("base de formation : test, essai et vérification coupés, rien ne part vers Meta", async (t) => {
  await avecFormation(true, async () => {
    const fake = createFakeMeta({ token: "jeton-secret-123" });
    const { admin } = await withMeta(t, fake);
    for (const path of ["/api/whatsapp/meta/tester", "/api/whatsapp/meta/essai", "/api/whatsapp/meta/modeles/verifier"]) {
      const r = await admin("POST", path, { to: "699123456" });
      assert.deepEqual([r.status, r.body.code], [409, "formation"], path);
    }
    assert.deepEqual(fake.calls, []);
  });
});
