import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { decode } from "../messages.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { createFakeMeta, registerLamaTemplates } from "./faux-meta.ts";
import { createServer } from "node:http";
import { appel, classerErreur, deposerMedia, envoyerMessage, GRAPH_BASE, GRAPH_VERSION, lireModeles, lireNumero, metaBase } from "./meta-api.ts";

/** Client de l'API Graph de Meta (WhatsApp Business, spec du 21/10/2026, W-1, W-6, W-8, W-19). */

const raison = (e: unknown) => decode("fr", (e as Error).message);

/** Faux Meta derrière un espion qui note chaque adresse et l'en-tête d'autorisation. */
function scene() {
  const fake = createFakeMeta({ token: "jeton-secret-123" });
  const vus: { url: string; authorization: string | null }[] = [];
  const espion: typeof fetch = async (input, init) => {
    vus.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return fake.fetch(input, init);
  };
  return { fake, vus, graph: { jeton: "jeton-secret-123", fetch: espion } };
}

test("classement des erreurs de Meta (W-6) : temporaires relancées, définitives à envoyer à la main ; code inconnu : 5xx temporaire, sinon définitif", () => {
  const JETON = "Jeton d'accès de WhatsApp Business refusé ou expiré.";
  const MODELE = "Modèle lama_rappel non approuvé par Meta.";
  const VALEURS = "Valeurs du message refusées par Meta.";
  const LIMITE = "Limite d'envoi de Meta atteinte.";
  const cas: [number, number | null, "temporaire" | "definitive", string][] = [
    [401, 190, "definitive", JETON], [403, 10, "definitive", JETON], [403, 200, "definitive", JETON],
    [400, 131026, "definitive", "Ce numéro n'a pas WhatsApp."],
    [400, 131047, "definitive", "Fenêtre de 24\u00a0h fermée\u00a0: la cliente n'a pas écrit à l'institut depuis plus de 24\u00a0h."],
    [404, 132001, "definitive", MODELE], [400, 132015, "definitive", MODELE], [400, 132016, "definitive", MODELE],
    [400, 132000, "definitive", VALEURS], [400, 132005, "definitive", VALEURS], [400, 132007, "definitive", VALEURS],
    [400, 132012, "definitive", VALEURS], [400, 100, "definitive", VALEURS], [400, 131008, "definitive", VALEURS], [400, 131009, "definitive", VALEURS],
    [400, 4, "temporaire", LIMITE], [400, 80007, "temporaire", LIMITE], [429, 130429, "temporaire", LIMITE],
    [400, 131048, "temporaire", LIMITE], [400, 131056, "temporaire", LIMITE],
    [500, 131000, "temporaire", "Erreur de Meta (code 131000)."], [503, 131016, "temporaire", "Erreur de Meta (code 131016)."],
    [500, 1, "temporaire", "Erreur de Meta (code 1)."], [503, 2, "temporaire", "Erreur de Meta (code 2)."],
    [503, null, "temporaire", "Erreur de Meta (code 503)."], [502, 999999, "temporaire", "Erreur de Meta (code 999999)."],
    [400, 999999, "definitive", "Message refusé par Meta (code 999999)."],
    [401, null, "definitive", JETON], [429, null, "temporaire", LIMITE],
    [401, 0, "definitive", JETON], [500, 133004, "temporaire", "Erreur de Meta (code 133004)."],
    [401, 999999, "definitive", JETON], [403, 999999, "definitive", JETON], [429, 999999, "temporaire", LIMITE],
  ];
  for (const [status, code, classe, texte] of cas) {
    const e = classerErreur({ status, code }, { modele: "lama_rappel" });
    assert.equal(e instanceof TemporaryError ? "temporaire" : e instanceof PermanentError ? "definitive" : "?", classe, `${status} ${code}`);
    assert.equal(raison(e), texte, `${status} ${code}`);
  }
  assert.equal(raison(classerErreur({ status: 400, code: 100 }, { lecture: true })), "Identifiant du numéro ou du compte inconnu de Meta.");
});

test("envoi : jeton en en-tête seulement, jamais dans l'adresse ; version de l'API dans l'adresse ; identifiant wamid rendu (W-7)", async () => {
  const { fake, vus, graph } = scene();
  fake.window.add("237699123456");
  const id = await envoyerMessage(graph, fake.phoneId, { to: "237699123456", type: "text", text: { body: "Bonjour Aïcha", preview_url: false } });
  assert.equal(id, "wamid.essai1");
  assert.deepEqual(fake.sent.map((s) => [s.to, s.type, s.text]), [["237699123456", "text", "Bonjour Aïcha"]]);
  assert.equal(vus[0].url, `${GRAPH_BASE}/${GRAPH_VERSION}/${fake.phoneId}/messages`);
  assert.equal(vus[0].authorization, "Bearer jeton-secret-123");
  assert.ok(vus.every((v) => !v.url.includes("jeton-secret-123")));
});

test("dépôt d'un fichier : multipart, type et nom gardés, identifiant rendu ; type refusé : erreur définitive", async () => {
  const { fake, graph } = scene();
  const id = await deposerMedia(graph, fake.phoneId, { name: "F-2026-000012.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.4 essai") });
  assert.deepEqual(fake.media.get(id), { mime: "application/pdf", filename: "F-2026-000012.pdf", size: 14 });
  await assert.rejects(deposerMedia(graph, fake.phoneId, { name: "x.gif", mime: "image/gif", data: Buffer.from("GIF89a") }),
    (e) => e instanceof PermanentError && raison(e) === "Message refusé par Meta (code 131053).");
});

test("lecture du numéro (W-11) : numéro affiché, nom vérifié, qualité ; identifiant inconnu, jeton refusé, Meta injoignable", async () => {
  const { fake, graph } = scene();
  assert.deepEqual(await lireNumero(graph, fake.phoneId), { numero: "+237 6 99 00 00 00", nom: "Institut Ébène", qualite: "GREEN" });
  await assert.rejects(lireNumero(graph, "999"), (e) => e instanceof PermanentError && raison(e) === "Identifiant du numéro ou du compte inconnu de Meta.");
  await assert.rejects(lireNumero({ ...graph, jeton: "faux" }, fake.phoneId), (e) => e instanceof PermanentError && raison(e) === "Jeton d'accès de WhatsApp Business refusé ou expiré.");
  fake.down = true;
  await assert.rejects(lireNumero(graph, fake.phoneId), (e) => e instanceof TemporaryError && raison(e) === "Meta injoignable\u00a0: vérifiez la connexion à internet.");
});

test("lecture des modèles : toutes les pages ; une page suivante hors de l'adresse de l'API n'est jamais suivie, le jeton ne part pas ailleurs (Review Focus 2)", async () => {
  const { fake, vus, graph } = scene();
  registerLamaTemplates(fake);
  fake.pageSize = 5;
  const lus = await lireModeles(graph, fake.wabaId);
  assert.equal(lus.length, 24);
  assert.deepEqual(lus[0], { name: "lama_confirmation", language: "fr", status: "APPROVED", category: "UTILITY" });
  assert.equal(vus.length, 5, "cinq pages de cinq modèles au plus");
  const piege: typeof fetch = async (input, init) => {
    vus.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(JSON.stringify({ data: [{ name: "lama_rappel", language: "fr", status: "APPROVED" }], paging: { next: "https://ailleurs.example/v1/page2" } }), { status: 200 });
  };
  vus.length = 0;
  assert.equal((await lireModeles({ jeton: "jeton-secret-123", fetch: piege }, fake.wabaId)).length, 1);
  assert.deepEqual(vus.map((v) => new URL(v.url).host), ["graph.facebook.com"]);
});

test("adresse de l'API : Meta, ou le faux Meta local sur 127.0.0.1 seulement (vérification au navigateur)", () => {
  assert.equal(metaBase({}), GRAPH_BASE);
  assert.equal(metaBase({ LAMA_META_BASE: "http://127.0.0.1:3098" }), "http://127.0.0.1:3098");
  for (const v of ["http://exemple.com:3098", "https://127.0.0.1:3098", "http://127.0.0.1:3098/x", "http://127.0.0.1"]) assert.equal(metaBase({ LAMA_META_BASE: v }), GRAPH_BASE, v);
});

test("version de l'API Graph écrite dans une seule constante (W-1)", () => {
  assert.match(GRAPH_VERSION, /^v\d{1,2}\.\d$/);
  const dossier = new URL(".", import.meta.url);
  const fautes = readdirSync(dossier)
    .filter((f) => f.endsWith(".ts") && f !== "meta-api.ts")
    .filter((f) => /\bv\d{1,2}\.\d\b/.test(readFileSync(new URL(f, dossier), "utf8")));
  assert.deepEqual(fautes, []);
});

test("le jeton n'apparaît dans aucun motif d'échec (W-10)", async () => {
  const { fake, graph } = scene();
  const motifs: string[] = [];
  for (const [status, code] of [[401, 190], [400, 131047], [500, 131000], [429, 130429]] as const) {
    fake.failNext = { status, code };
    await envoyerMessage(graph, fake.phoneId, { to: "237699123456", type: "text", text: { body: "x" } }).catch((e: Error) => motifs.push(e.message));
  }
  assert.equal(motifs.length, 4);
  assert.ok(motifs.every((m) => !m.includes("jeton-secret-123")));
});

test("le jeton ne part que vers l'adresse de l'API : adresse étrangère refusée sans requête, redirection jamais suivie", async () => {
  const { fake, vus, graph } = scene();
  for (const ailleurs of ["https://ailleurs.example/v1/x", "http://graph.facebook.com.evil.example/x", `${GRAPH_BASE}.evil.example/x`, "ftp://exemple.com/x"]) {
    await assert.rejects(appel(graph, "GET", ailleurs, undefined, 1000, {}), (e) => e instanceof PermanentError && raison(e) === "Réponse inattendue de Meta.", ailleurs);
  }
  assert.equal(vus.length, 0);
  assert.deepEqual(fake.calls, []);
  // Redirection : un vrai serveur local renvoie vers un second serveur, qui ne doit rien recevoir.
  const recus: string[] = [];
  const cible = createServer((req, res) => { recus.push(req.headers.authorization ?? "sans"); res.writeHead(200).end("{}"); });
  await new Promise<void>((ok) => cible.listen(0, "127.0.0.1", ok));
  const portCible = (cible.address() as { port: number }).port;
  const source = createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${portCible}/x` }).end(); });
  await new Promise<void>((ok) => source.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
  try {
    await assert.rejects(appel({ jeton: "jeton-secret-123", base }, "GET", "/123", undefined, 2000, {}), (e) => e instanceof TemporaryError);
    assert.deepEqual(recus, []);
  } finally {
    source.close();
    cible.close();
  }
});
