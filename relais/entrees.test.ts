import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { configDepuis } from "./config.ts";
import { adresseClient, demarrerRelais, estHttpsNode, purgeSure } from "./node.ts";
import { signer } from "./noyau/signature.ts";
import { d1Simule } from "./stockage/d1-simule.ts";
import { baseD1 } from "./stockage/d1.ts";
import { CONSERVATION_MS, Depot } from "./stockage/depot.ts";
import { Salons } from "./stockage/salons.ts";
import { baseSqlite, migrerSqlite } from "./stockage/sqlite.ts";
import worker from "./worker.ts";

const MAITRE = "m".repeat(48);
const MDP = "mot-de-passe-d-essai";
const VARIABLES = { RELAIS_CLE_MAITRE: MAITRE, RELAIS_ADMIN_MOT_DE_PASSE: MDP };

async function entetes(cle: string, salon: string, chemin: string) {
  const h = String(Date.now());
  return { "x-lama-institut": salon, "x-lama-horodatage": h, "x-lama-signature": await signer(cle, h, "GET", chemin, "") };
}

test("configuration : clé générale et mot de passe obligatoires ; limite et Turnstile facultatifs", () => {
  assert.throws(() => configDepuis({}), /RELAIS_CLE_MAITRE/);
  assert.throws(() => configDepuis({ RELAIS_CLE_MAITRE: "m".repeat(31), RELAIS_ADMIN_MOT_DE_PASSE: MDP }), /RELAIS_CLE_MAITRE/);
  assert.throws(() => configDepuis({ RELAIS_CLE_MAITRE: MAITRE, RELAIS_ADMIN_MOT_DE_PASSE: "m".repeat(11) }), /RELAIS_ADMIN_MOT_DE_PASSE/);
  assert.throws(() => configDepuis({ RELAIS_CLE_MAITRE: MAITRE, RELAIS_ADMIN_MOT_DE_PASSE: "court" }), /RELAIS_ADMIN_MOT_DE_PASSE/);
  assert.deepEqual(configDepuis(VARIABLES), { cleMaitre: MAITRE, motDePasseGestion: MDP, demandesParHeureParIp: 10, turnstile: null });
  assert.deepEqual(
    configDepuis({ ...VARIABLES, RELAIS_DEMANDES_PAR_HEURE: "5", TURNSTILE_CLE_SITE: "s", TURNSTILE_SECRET: "x" }),
    { cleMaitre: MAITRE, motDePasseGestion: MDP, demandesParHeureParIp: 5, turnstile: { cleSite: "s", secret: "x" } },
  );
  assert.equal(configDepuis({ ...VARIABLES, RELAIS_DEMANDES_PAR_HEURE: "abc" }).demandesParHeureParIp, 10);
  assert.equal(configDepuis({ ...VARIABLES, TURNSTILE_CLE_SITE: "s" }).turnstile, null);
});

test("worker : contrat signé avec la clé du salon, pages servies depuis les fichiers construits, purge planifiée", async () => {
  const db = new DatabaseSync(":memory:");
  migrerSqlite(db);
  const cree = await new Salons(baseD1(d1Simule(db)), MAITRE).creer("eclat", "Institut Éclat", Date.now());
  assert.notEqual(cree, "existe");
  if (cree === "existe") return;
  const ASSETS = { fetch: async (r: Request) => new URL(r.url).pathname === "/index.html" ? new Response("<!doctype html><title>page</title>") : new Response("absent", { status: 404 }) };
  const env = { BASE: d1Simule(db), ASSETS, ...VARIABLES };
  const etat = await worker.fetch(new Request("https://reserver.exemple.com/lama/v1/etat", { headers: await entetes(cree.cle, "eclat", "/lama/v1/etat") }), env);
  assert.equal(etat.status, 200);
  const page = await worker.fetch(new Request("https://reserver.exemple.com/eclat/"), env);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>page<\/title>/);
  assert.equal(page.headers.get("cache-control"), "no-cache");
  const redirection = await worker.fetch(new Request("https://reserver.exemple.com/eclat"), env);
  assert.deepEqual([redirection.status, redirection.headers.get("location")], [301, "/eclat/"]);
  for (const chemin of ["/inconnu/", "/"]) {
    const inconnue = await worker.fetch(new Request(`https://reserver.exemple.com${chemin}`), env);
    assert.equal(inconnue.status, 404, chemin);
    assert.match(await inconnue.text(), /<title>page<\/title>/, `${chemin} : page de réservation en 404`);
    assert.equal(inconnue.headers.get("cache-control"), "no-cache");
  }
  assert.equal((await worker.fetch(new Request("https://reserver.exemple.com/api/"), env)).headers.get("content-type")?.includes("json"), true);
  assert.equal((await worker.fetch(new Request("https://reserver.exemple.com/gestion/"), env)).status, 404, "gestion.html absente des fichiers : 404");
  const depot = new Depot(baseSqlite(db), "eclat");
  await depot.ajouterDemande({
    id: "d_vieille", jeton: "j_vieille", type: "rappel", prestation: "s60", prestation_nom: { fr: "Soin", en: "Care" }, praticienne: null,
    date: null, debut: null, fin: null, souhait: { jours: [], moments: [], precision: "" },
    cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" }, note: "", telephone_empreinte: "e", recue_le: Date.now() - CONSERVATION_MS - 1,
  });
  await worker.scheduled({}, env);
  assert.equal(await depot.enAttente(), 0);
});

test("node : contrat, API publique, pages d'un salon et de la gestion, 404 en JSON ailleurs", async () => {
  const dist = mkdtempSync(join(tmpdir(), "relais-dist-"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>reservation</title>");
  writeFileSync(join(dist, "gestion.html"), "<!doctype html><title>gestion</title>");
  const relais = demarrerRelais({ ...VARIABLES, RELAIS_BASE: ":memory:", RELAIS_DIST: dist }, 0);
  if (!relais.serveur.listening) await once(relais.serveur, "listening");
  const adresse = `http://127.0.0.1:${(relais.serveur.address() as AddressInfo).port}`;
  try {
    const cree = await new Salons(relais.base, MAITRE).creer("eclat", "Institut Éclat", Date.now());
    if (cree === "existe") throw new Error("salon déjà créé");
    assert.equal((await fetch(`${adresse}/lama/v1/etat`, { headers: await entetes(cree.cle, "eclat", "/lama/v1/etat") })).status, 200);
    assert.equal(((await (await fetch(`${adresse}/api/eclat/vitrine`)).json()) as { etat: string }).etat, "ferme");
    assert.match(await (await fetch(`${adresse}/eclat/`)).text(), /reservation/);
    const gestion = await fetch(`${adresse}/gestion/`);
    assert.match(await gestion.text(), /gestion/);
    assert.equal(gestion.headers.get("content-security-policy"), "frame-ancestors 'none'", "gestion jamais dans un cadre");
    assert.equal(gestion.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${adresse}/eclat/`)).headers.get("content-security-policy"), null, "la page de réservation reste intégrable");
    assert.equal((await fetch(`${adresse}/api/`, { redirect: "manual" })).status, 404, "adresse réservée, jamais un salon");
    const ailleurs = await fetch(`${adresse}/api/eclat/inexistant`);
    assert.equal(ailleurs.status, 404);
    assert.equal(((await ailleurs.json()) as { erreur: { code: string } }).erreur.code, "introuvable");
  } finally {
    await relais.fermer();
  }
});

test("node : adresse de la cliente, connexion par défaut, dernière entrée de x-forwarded-for derrière un proxy de confiance seulement", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  const falsifie = h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9", "cf-connecting-ip": "7.7.7.7" });
  assert.equal(adresseClient(falsifie, "10.0.0.1", false), "10.0.0.1", "sans proxy de confiance : adresse de la connexion");
  assert.equal(adresseClient(falsifie, "10.0.0.1", true), "203.0.113.9", "avec proxy : dernière entrée, jamais la première ni cf-connecting-ip");
  assert.equal(adresseClient(h({ "cf-connecting-ip": "7.7.7.7" }), "10.0.0.1", true), "10.0.0.1", "cf-connecting-ip ignoré sur Node");
  assert.equal(adresseClient(h({}), "10.0.0.1", true), "10.0.0.1", "repli sur la connexion");
  assert.equal(adresseClient(h({}), undefined, false), "inconnue");
});

test("node : estHttps suit x-forwarded-proto seulement derrière un proxy de confiance", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  const https = h({ "x-forwarded-proto": "https" });
  assert.equal(estHttpsNode(https, "http://relais.local/x", true), true);
  assert.equal(estHttpsNode(https, "http://relais.local/x", false), false);
  assert.equal(estHttpsNode(h({}), "http://relais.local/x", true), false);
  assert.equal(estHttpsNode(h({}), "https://relais.local/x", false), true);
});

test("node : cookie de gestion Secure derrière un proxy TLS de confiance, pas sans", async () => {
  const cookie = async (env: Record<string, string>, entetes: Record<string, string>) => {
    const relais = demarrerRelais({ ...VARIABLES, RELAIS_BASE: ":memory:", ...env }, 0);
    if (!relais.serveur.listening) await once(relais.serveur, "listening");
    try {
      const r = await fetch(`http://127.0.0.1:${(relais.serveur.address() as AddressInfo).port}/gestion/api/connexion`, {
        method: "POST", headers: { "content-type": "application/json", "x-relais-gestion": "1", ...entetes }, body: JSON.stringify({ mot_de_passe: MDP }),
      });
      assert.equal(r.status, 204);
      return r.headers.get("set-cookie") ?? "";
    } finally {
      await relais.fermer();
    }
  };
  assert.match(await cookie({ RELAIS_PROXY_DE_CONFIANCE: "1" }, { "x-forwarded-proto": "https" }), /Secure/);
  assert.doesNotMatch(await cookie({}, { "x-forwarded-proto": "https" }), /Secure/);
  assert.doesNotMatch(await cookie({ RELAIS_PROXY_DE_CONFIANCE: "1" }, {}), /Secure/);
});

test("node : seuls /assets/* et /integrer.js sont servis comme fichiers, les pages passent par l'application", async () => {
  const dist = mkdtempSync(join(tmpdir(), "relais-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>reservation</title>");
  writeFileSync(join(dist, "gestion.html"), "<!doctype html><title>gestion</title>");
  writeFileSync(join(dist, "assets", "x.js"), "console.log(1)");
  writeFileSync(join(dist, "integrer.js"), "console.log(2)");
  const relais = demarrerRelais({ ...VARIABLES, RELAIS_BASE: ":memory:", RELAIS_DIST: dist }, 0);
  if (!relais.serveur.listening) await once(relais.serveur, "listening");
  const adresse = `http://127.0.0.1:${(relais.serveur.address() as AddressInfo).port}`;
  try {
    await new Salons(relais.base, MAITRE).creer("eclat", "Institut Éclat", Date.now());
    for (const chemin of ["/index.html", "/gestion.html"]) {
      const r = await fetch(`${adresse}${chemin}`);
      assert.equal(r.status, 404, chemin);
      assert.equal(((await r.json()) as { erreur: { code: string } }).erreur.code, "introuvable", chemin);
    }
    assert.equal((await fetch(`${adresse}/assets/x.js`)).status, 200);
    assert.equal((await fetch(`${adresse}/integrer.js`)).status, 200);
    const page = await fetch(`${adresse}/eclat/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-cache");
    for (const chemin of ["/", "/autre/"]) {
      const inconnue = await fetch(`${adresse}${chemin}`);
      assert.equal(inconnue.status, 404, chemin);
      assert.equal(inconnue.headers.get("cache-control"), "no-cache", chemin);
      assert.match(await inconnue.text(), /reservation/, `${chemin} : la page de réservation, qui affiche l'adresse inconnue`);
    }
    assert.equal((await fetch(`${adresse}/api/`)).status, 404);
    assert.equal(((await (await fetch(`${adresse}/api/`)).json()) as { erreur: { code: string } }).erreur.code, "introuvable");
  } finally {
    await relais.fermer();
  }
});

test("worker : /assets/* et /integrer.js passent par les fichiers statiques, le reste par l'application", async () => {
  const db = new DatabaseSync(":memory:");
  migrerSqlite(db);
  const ASSETS = { fetch: async (r: Request) => new Response(`statique ${new URL(r.url).pathname}`) };
  const env = { BASE: d1Simule(db), ASSETS, ...VARIABLES };
  for (const chemin of ["/assets/x.js", "/integrer.js"]) {
    const r = await worker.fetch(new Request(`https://reserver.exemple.com${chemin}`), env);
    assert.equal(r.status, 200, chemin);
    assert.equal(await r.text(), `statique ${chemin}`);
  }
  const page = await worker.fetch(new Request("https://reserver.exemple.com/index.html"), env);
  assert.equal(page.status, 404);
  assert.equal(((await page.json()) as { erreur: { code: string } }).erreur.code, "introuvable");
  const ecriture = await worker.fetch(new Request("https://reserver.exemple.com/assets/x.js", { method: "POST" }), env);
  assert.equal(ecriture.headers.get("content-type")?.includes("json"), true, "seules les lectures vont aux fichiers");
});

test("worker : un chemin /assets/%2e%2e/ est normalisé puis traité par l'application, jamais par les fichiers", async () => {
  const db = new DatabaseSync(":memory:");
  migrerSqlite(db);
  let fichiers = 0;
  const ASSETS = { fetch: async () => { fichiers++; return new Response("statique"); } };
  const r = await worker.fetch(new Request("https://reserver.exemple.com/assets/%2e%2e/gestion/api/salons"), { BASE: d1Simule(db), ASSETS, ...VARIABLES });
  assert.equal(fichiers, 0);
  assert.equal(r.status, 401);
  assert.equal(((await r.json()) as { erreur: { code: string } }).erreur.code, "session");
});

test("worker : une redirection des fichiers statiques est journalisée et la page répond 404", async () => {
  const db = new DatabaseSync(":memory:");
  migrerSqlite(db);
  await new Salons(baseD1(d1Simule(db)), MAITRE).creer("eclat", "Institut Éclat", Date.now());
  const ASSETS = { fetch: async () => new Response(null, { status: 307, headers: { location: "/" } }) };
  const journal: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => void journal.push(a.join(" "));
  try {
    const r = await worker.fetch(new Request("https://reserver.exemple.com/eclat/"), { BASE: d1Simule(db), ASSETS, ...VARIABLES });
    assert.equal(r.status, 404);
  } finally {
    console.error = original;
  }
  assert.equal(journal.length, 1);
  assert.match(journal[0], /html_handling/);
});

test("node : la purge ne rejette jamais, l'échec est journalisé", async () => {
  const journal: string[] = [];
  await purgeSure(async () => { throw new Error("base verrouillée"); }, (m) => journal.push(m));
  assert.equal(journal.length, 1);
  assert.match(journal[0], /Purge quotidienne en échec.*base verrouillée/);
  let appelee = 0;
  await purgeSure(async () => { appelee++; }, (m) => journal.push(m));
  assert.deepEqual([appelee, journal.length], [1, 1]);
});

test("node : une configuration refusée affiche le message seul et sort avec le code 1", () => {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(import.meta.dirname, "node.ts")], {
    env: { PATH: process.env.PATH, RELAIS_CLE_MAITRE: "courte", RELAIS_ADMIN_MOT_DE_PASSE: MDP, RELAIS_BASE: ":memory:" }, encoding: "utf8",
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /RELAIS_CLE_MAITRE manquante ou trop courte/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});
