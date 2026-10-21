import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { decode } from "../messages.ts";
import { PermanentError } from "../outbox/outbox.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { setupApp } from "../test-support.ts";
import { providerFromSettings } from "./envoi.ts";
import { createFakeMeta, registerLamaTemplates } from "./faux-meta.ts";
import { createMeta, oublierEtatsMeta, type MetaOptions } from "./meta.ts";
import { etatsDepuisMeta } from "./modeles-meta.ts";

/** Fournisseur WhatsApp Business (spec du 21/10/2026, W-1, W-4, W-5, W-10, W-11, W-16, W-17). */

const raison = (e: unknown) => decode("fr", (e as Error).message);
const VALEURS = { prenom: "Aïcha", nom: "Aïcha Mbarga", date: "lundi 5 octobre", heure: "10:00", prestation: "Tresses", institut: "Institut Ébène", telephone: "699 00 00 00" };
const PDF = { name: "F-2026-000012.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 essai") };

function scene(over: Partial<MetaOptions> = {}) {
  oublierEtatsMeta();
  const fake = createFakeMeta();
  registerLamaTemplates(fake);
  const meta = createMeta({ numero: fake.phoneId, compte: fake.wabaId, jeton: fake.token, noms: null, etats: null, fetch: fake.fetch, ...over });
  return { fake, meta };
}

test("modèle (W-16) : nom par défaut, langue de la cliente, valeurs dans l'ordre de chaque langue, variable répétée une fois, wamid rendu", async () => {
  const { fake, meta } = scene();
  assert.deepEqual(await meta.sendTemplate("237699123456", { modele: "confirmation", lang: "fr", valeurs: VALEURS }), { id: "wamid.essai1" });
  await meta.sendTemplate("237699123456", { modele: "confirmation", lang: "en", valeurs: { ...VALEURS, date: "Monday 5 October", prestation: "Braids" } });
  await meta.sendTemplate("237699123456", { modele: "campagne", lang: "fr", valeurs: { institut: "Institut Ébène", texte: "Nouveautés\nde la saison." } });
  assert.deepEqual(fake.sent.map((s) => s.template), [
    { name: "lama_confirmation", language: "fr", body: ["Aïcha", "Tresses", "lundi 5 octobre", "10:00", "Institut Ébène", "699 00 00 00"] },
    { name: "lama_confirmation", language: "en", body: ["Aïcha", "Braids", "Monday 5 October", "10:00", "Institut Ébène", "699 00 00 00"] },
    { name: "lama_campagne", language: "fr", body: ["Institut Ébène", "Nouveautés de la saison."] },
  ]);
});

test("langue de secours, refus sans appel à Meta (refusé, absent, nom vide), nom changé : tenté (W-4, W-16)", async () => {
  const base = scene();
  const modeles = base.fake.templates.filter((t) => !(t.name === "lama_rappel" && t.language === "en"));
  modeles.push({ name: "ebene_ticket", language: "fr", status: "REJECTED", category: "UTILITY", params: 3, header: "document" });
  const lus = modeles.map(({ name, language, status }) => ({ name, language, status }));
  const noms = { ticket: "ebene_ticket", absence: "" };
  const { fake, meta } = scene({ noms, etats: etatsDepuisMeta(lus, noms, 0) });
  fake.templates = modeles;
  await meta.sendTemplate("237699123456", { modele: "rappel", lang: "en", valeurs: VALEURS });
  assert.equal(fake.sent[0].template?.language, "fr", "rappel approuvé en français seulement : il sert pour l'anglais");
  const appels = fake.calls.length;
  await assert.rejects(meta.sendTemplate("237699123456", { modele: "ticket", lang: "fr", valeurs: VALEURS, entete: { type: "document", file: PDF } }),
    (e) => e instanceof PermanentError && raison(e) === "Modèle ebene_ticket non approuvé par Meta.");
  await assert.rejects(meta.sendTemplate("237699123456", { modele: "absence", lang: "fr", valeurs: VALEURS }),
    (e) => e instanceof PermanentError && raison(e) === "Modèle sans nom pour ce message\u00a0: à régler dans Réglages, Connexions.");
  assert.equal(fake.calls.length, appels, "aucun appel à Meta, aucun fichier déposé");
  const change = scene({ noms: { rappel: "ebene_rappel" }, etats: etatsDepuisMeta(lus, null, 0) });
  await assert.rejects(change.meta.sendTemplate("237699123456", { modele: "rappel", lang: "fr", valeurs: VALEURS }),
    (e) => e instanceof PermanentError && raison(e) === "Modèle ebene_rappel non approuvé par Meta.");
  assert.equal(change.fake.calls.length, 1, "nom changé depuis la vérification : non vérifié, tenté chez Meta (qui le refuse ici)");
});

test("ticket et produit (W-17) : fichier déposé chez Meta puis envoyé en en-tête, nom du fichier compris", async () => {
  const { fake, meta } = scene();
  await meta.sendTemplate("237699123456", { modele: "ticket", lang: "fr", valeurs: { prenom: "Aïcha", document: "ticket F-2026-000012", institut: "Institut Ébène" }, entete: { type: "document", file: PDF } });
  await meta.sendTemplate("237699123456", {
    modele: "produit", lang: "en", valeurs: { prenom: "Aïcha", produit: "Shea Serum", prix: "12\u202f000\u00a0FCFA", institut: "Institut Ébène" },
    entete: { type: "image", file: { name: "produit-3.png", mime: "image/png", data: PNG_1PX } },
  });
  assert.deepEqual(fake.sent.map((s) => s.template?.header), [{ type: "document", media: "media-1", filename: "F-2026-000012.pdf" }, { type: "image", media: "media-2" }]);
  assert.deepEqual(fake.sent[1].template?.body, ["Aïcha", "Shea Serum", "12\u202f000\u00a0FCFA", "Institut Ébène"]);
  assert.deepEqual([...fake.media.values()].map((m) => m.mime), ["application/pdf", "image/png"]);
});

test("message libre (W-5) : hors fenêtre de 24 h, erreur définitive « Fenêtre de 24 h fermée » ; dans la fenêtre, texte et document libres", async () => {
  const { fake, meta } = scene();
  await assert.rejects(meta.sendText("237699123456", "Votre commande est arrivée."), (e) => e instanceof PermanentError && raison(e).startsWith("Fenêtre de 24\u00a0h fermée"));
  fake.window.add("237699123456");
  assert.deepEqual(await meta.sendText("237699123456", "Votre commande est arrivée."), { id: "wamid.essai1" });
  await meta.sendDocument("237699123456", PDF, "Votre ticket");
  assert.deepEqual(fake.sent.map((s) => [s.type, s.text ?? s.document?.filename]), [["text", "Votre commande est arrivée."], ["document", "F-2026-000012.pdf"]]);
});

test("valeur vide (Review Focus 1) : jamais envoyée vide, Meta l'accepte", async () => {
  const { fake, meta } = scene();
  await meta.sendTemplate("237699123456", { modele: "en_ligne_rappel", lang: "fr", valeurs: { prenom: "", institut: "Institut Ébène", prestation: "Soin visage" } });
  assert.deepEqual(fake.sent[0].template?.body, ["chère cliente", "Institut Ébène", "Soin visage"]);
});

test("corps trop long (campagne, Review Focus 4) : erreur définitive sans appel à Meta", async () => {
  const { fake, meta } = scene();
  await assert.rejects(meta.sendTemplate("237699123456", { modele: "campagne", lang: "fr", valeurs: { institut: "Institut Ébène", texte: "x".repeat(1000) } }),
    (e) => e instanceof PermanentError && raison(e) === "Message trop long pour un modèle de Meta\u00a0: 1\u00a0024 caractères au plus.");
  assert.deepEqual(fake.calls, []);
});

test("réglages incomplets (W-1) : erreur définitive sans appel, état « erreur »", async () => {
  const { fake, meta } = scene({ jeton: "" });
  await assert.rejects(meta.sendText("237699123456", "x"),
    (e) => e instanceof PermanentError && raison(e) === "WhatsApp Business incomplet\u00a0: identifiant du numéro, identifiant du compte ou jeton d'accès manquant.");
  assert.deepEqual(await meta.status(), { state: "erreur" });
  await assert.rejects(scene({ compte: "" }).meta.lireModeles(), (e) => e instanceof PermanentError);
  assert.deepEqual(fake.calls, []);
});

test("état (W-11) : numéro connecté gardé cinq minutes ; Meta injoignable ; jeton refusé : erreur", async () => {
  const { fake, meta } = scene();
  assert.deepEqual(await meta.status(), { state: "connecte", phone: "237699000000" });
  fake.down = true;
  assert.deepEqual(await meta.status(), { state: "connecte", phone: "237699000000" }, "gardé : les écrans le demandent chaque minute");
  oublierEtatsMeta();
  assert.deepEqual(await meta.status(), { state: "injoignable" });
  assert.deepEqual(await scene({ jeton: "faux" }).meta.status(), { state: "erreur" });
});

test("réglages (W-1, W-10) : fournisseur « meta », identifiants en chiffres, noms valides ; état des modèles réservé à la vérification ; administrateur seul", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const put = (key: string, value: unknown) => admin("PUT", `/api/settings/${key}`, { value }, { "Accept-Language": "fr" });
  assert.equal((await put("whatsapp.fournisseur", "meta")).status, 200);
  assert.equal((await put("whatsapp.fournisseur", "graph")).body.error, "Fournisseur attendu\u00a0: aucun, waha ou meta.");
  assert.equal((await put("whatsapp.meta.numero", "106540352242922")).status, 200);
  assert.equal((await put("whatsapp.meta.numero", "1065 4035")).body.error, "Identifiant attendu\u00a0: des chiffres seulement, 30 au plus.");
  assert.equal((await put("whatsapp.meta.compte", "102290129340398")).status, 200);
  assert.equal((await put("whatsapp.meta.noms", { rappel: "ebene_rappel", ticket: "" })).status, 200);
  assert.equal((await put("whatsapp.meta.noms", { rappel: "Rappel Ébène" })).body.error,
    "Nom de modèle attendu\u00a0: lettres minuscules sans accent, chiffres et _, 512 caractères au plus.");
  const etats = await put("whatsapp.meta.etats", { verifieLe: 1, modeles: {} });
  assert.deepEqual([etats.status, etats.body.error], [409, "L'état des modèles se met à jour par «\u00a0Vérifier les modèles\u00a0»."]);
  assert.equal((await (await ctx.as("manager"))("PUT", "/api/settings/whatsapp.meta.numero", { value: "1" })).status, 403);
  initDB(ctx.env);
  const provider = await providerFromSettings();
  assert.equal(typeof provider?.sendTemplate, "function", "fournisseur WhatsApp Business choisi");
  await assert.rejects(provider!.sendText("237699123456", "x"), (e) => raison(e).startsWith("WhatsApp Business incomplet"), "sans jeton : rien ne part");
});
