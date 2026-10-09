import assert from "node:assert/strict";
import { generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { connect } from "node:tls";
import { test } from "node:test";
import { generateIdentity, identityToRecipient } from "age-encryption";
import { appBundle, bundleOf, setupApp } from "../test-support.ts";
import { USB_MARKER } from "../backup/backup.ts";
import { fabriquerCertificats, lancer, opensslManquant } from "./essai-certificats.ts";
import { CLE_HTTPS_DEPUIS, FENETRE_PASSAGE_HTTPS_MS, noterPassageHttps } from "../auth/passage-https.ts";
import { ALERTE_ECHEANCE_JOURS, echeanceDe, lirePaire, signaturePaire, surveillerPaire, type PaireTls } from "./contexte.ts";

// boot.ts importe index.ts, dont les imports internes finissent en .js : on le charge assemblé, comme en production.
const { readConfig, shutdown, start } = await import(await bundleOf("./boot.ts"));

/**
 * lama en HTTPS (distribution D-06 à D-08) : écoute https avec le certificat
 * de `LAMA_TLS_DIR`, écoute http limitée à la page du certificat, 301 pour le
 * reste, http seul sans certificat lisible, rechargement à chaud, cookies
 * `Secure` en https. Les essais qui fabriquent un certificat sont sautés,
 * avec le motif, si `openssl` ne sait pas le faire.
 */

const skip = opensslManquant() ?? false;
type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

/** Requête https vers 127.0.0.1 en vérifiant le certificat comme un appareil qui a approuvé l'autorité (nom lama.local). */
function viaHttps(port: number, ca: Buffer, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = httpsRequest({ host: "127.0.0.1", port, servername: "lama.local", ca, path, method: init.method ?? "GET", headers: { host: "lama.local", ...init.headers }, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (d) => (body += d)).on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end(init.body);
  });
}

function viaHttp(port: number, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: { host: "lama.local", ...init.headers }, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (d) => (body += d)).on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end(init.body);
  });
}

/** Numéro de série du certificat présenté par le serveur à une nouvelle connexion (vérifié par l'autorité). */
function serieServie(port: number, ca: Buffer): Promise<string> {
  return new Promise((done, fail) => {
    const socket = connect({ host: "127.0.0.1", port, servername: "lama.local", ca }, () => {
      done(socket.getPeerCertificate().serialNumber);
      socket.end();
    });
    socket.on("error", fail);
  });
}

const INSTALL = { method: "POST", headers: { "content-type": "application/json", "X-Lama": "1" }, body: JSON.stringify({ display_name: "Dan", login: "dan", password: "motdepasse10" }) };

/** Démarre lama sur des ports libres avec le dossier de certificat donné, en capturant le journal. */
async function demarrer(tlsDir: string | null, httpPort: number | null = 0) {
  const dir = mkdtempSync(join(tmpdir(), "lama-https-"));
  const journal: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => { journal.push(args.join(" ")); };
  try {
    const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb"), tlsDir, httpPort });
    return { running, journal };
  } finally {
    console.log = log;
  }
}

test("configuration : 443 et 80 en service avec /etc/lama/tls, 8787 sans https en développement, http coupé par LAMA_HTTP_PORT=aucun", () => {
  const prod = readConfig({});
  assert.deepEqual([prod.port, prod.httpPort, prod.tlsDir], [443, 80, "/etc/lama/tls"]);
  const dev = readConfig({ LAMA_DEV: "1" });
  assert.deepEqual([dev.port, dev.httpPort, dev.tlsDir], [8787, null, null]);
  const formation = readConfig({ LAMA_PORT: "8443", LAMA_HTTP_PORT: "aucun", LAMA_TLS_DIR: "/etc/lama/tls" });
  assert.deepEqual([formation.port, formation.httpPort, formation.tlsDir], [8443, null, "/etc/lama/tls"]);
  assert.equal(readConfig({ LAMA_HTTP_PORT: "8080" }).httpPort, 8080);
});

test("sans certificat lisible : toute l'application en http sur le port http, le journal le dit, cookies sans Secure", async () => {
  const vide = mkdtempSync(join(tmpdir(), "lama-sans-tls-"));
  const { running, journal } = await demarrer(vide);
  try {
    assert.equal(running.secure, false);
    assert.equal(running.db.prepare("SELECT value FROM settings WHERE key = ?").get(CLE_HTTPS_DEPUIS), undefined, "http seul : pas de premier service en https noté");
    assert.equal(running.http, null);
    assert.ok(journal.some((l) => l.startsWith(`Certificat illisible dans ${vide} (ENOENT)\u00a0: lama démarre en HTTP seul`)), journal.join("\n"));
    const state = await viaHttp(running.port, "/api/auth/state");
    assert.equal(state.status, 200);
    // Un client qui prétend être en https n'y change rien : l'en-tête interne est toujours écrasé.
    const install = await viaHttp(running.port, "/api/auth/install", { ...INSTALL, headers: { ...INSTALL.headers, "x-lama-https": "1" } });
    assert.equal(install.status, 201);
    const cookies = install.headers["set-cookie"] ?? [];
    assert.ok(cookies.length > 0);
    for (const cookie of cookies) {
      assert.match(cookie, /^lama_session=/, "nom nu en http");
      assert.doesNotMatch(cookie, /;\s*Secure/i, cookie);
    }
    assert.equal((await viaHttp(running.port, "/certificat")).status, 503, "page du certificat : pas encore fabriqué");
  } finally {
    await shutdown(running);
  }
});

test("avec certificat : https vérifié pour lama.local, page du certificat en http, tout le reste en 301 vers https, sans HSTS", { skip }, async () => {
  const tls = fabriquerCertificats(mkdtempSync(join(tmpdir(), "lama-tls-")));
  const ca = readFileSync(join(tls, "autorite.crt"));
  const { running, journal } = await demarrer(tls);
  try {
    assert.equal(running.secure, true);
    const depuis = running.db.prepare("SELECT value FROM settings WHERE key = ?").get(CLE_HTTPS_DEPUIS) as { value: string } | undefined;
    assert.ok(depuis && Math.abs(Number(depuis.value) - Date.now()) < 60_000, "premier service en https noté au démarrage");
    const fin = echeanceDe(readFileSync(join(tls, "serveur.crt")));
    assert.ok(journal.some((l) => l.startsWith("Certificat du serveur valable jusqu'au ") && l.includes(String(fin.getUTCFullYear()))), journal.join("\n"));
    assert.ok(!journal.some((l) => l.startsWith("Attention")), "certificat neuf : aucun avertissement d'échéance");
    assert.ok(journal.some((l) => l === `lama à l'écoute en HTTPS sur le port ${running.port}, page du certificat en HTTP sur le port ${running.httpPort}`), journal.join("\n"));
    const state = await viaHttps(running.port, ca, "/api/auth/state");
    assert.equal(state.status, 200, "certificat accepté par un client qui a approuvé l'autorité, nom lama.local");
    assert.equal(state.headers["strict-transport-security"], undefined, "pas de HSTS");
    assert.ok(state.headers.date, "en-tête Date (contrôle de l'heure, D-11)");

    const page = await viaHttp(running.httpPort, "/certificat", { headers: { "accept-language": "fr" } });
    assert.equal(page.status, 200, "un appareil qui n'a pas encore approuvé l'autorité ouvre la page en http, sans redirection");
    assert.ok(page.body.includes(new X509Certificate(ca).fingerprint256));
    assert.ok(page.body.includes(`href="https://lama.local:${running.port}/certificat/ok?lang=fr"`), "lien « Vérifier » vers https, langue transmise (tâche 2)");
    for (const path of ["/certificat/autorite.crt", "/certificat/lama.mobileconfig", "/certificat/qr.svg"]) assert.equal((await viaHttp(running.httpPort, path)).status, 200, path);

    for (const [method, path] of [["GET", "/"], ["GET", "/agenda?jour=2026-10-05"], ["GET", "/certificat/ok"], ["POST", "/api/auth/login"], ["GET", "/api/auth/state"]]) {
      const r = await viaHttp(running.httpPort, path, { method });
      assert.equal(r.status, 301, `${method} ${path}`);
      assert.equal(r.headers.location, `https://lama.local:${running.port}${path}`);
      assert.equal(r.headers["cache-control"], "no-store", "redirection jamais gardée par le navigateur");
    }
    assert.equal((await viaHttp(running.httpPort, "/", { headers: { host: "192.168.1.50" } })).headers.location, `https://192.168.1.50:${running.port}/`);

    const ok = await viaHttps(running.port, ca, "/certificat/ok", { headers: { "accept-language": "fr" } });
    assert.match(ok.body, /Connexion sécurisée/);
  } finally {
    await shutdown(running);
  }
  await assert.rejects(viaHttp(running.httpPort, "/certificat"), "l'arrêt ferme aussi l'écoute http");
});

test("cookies en https : préfixe __Host-, Secure, Path=/, sans Domain, mêmes durées", { skip }, async () => {
  const tls = fabriquerCertificats(mkdtempSync(join(tmpdir(), "lama-tls-")));
  const ca = readFileSync(join(tls, "autorite.crt"));
  const { running } = await demarrer(tls);
  try {
    const install = await viaHttps(running.port, ca, "/api/auth/install", INSTALL);
    assert.equal(install.status, 201);
    const cookies = install.headers["set-cookie"] ?? [];
    assert.ok(cookies.length > 0);
    for (const cookie of cookies) {
      assert.match(cookie, /^__Host-lama_session=/);
      assert.match(cookie, /; Max-Age=1209600;/);
      assert.match(cookie, /; Path=\/(;|$)/);
      assert.doesNotMatch(cookie, /; Domain=/i);
      assert.match(cookie, /; Secure/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /; SameSite=Strict/);
    }
  } finally {
    await shutdown(running);
  }
});

test("API : cookies __Host- et Secure seulement quand boot.ts dit https (x-lama-https), noms nus en http", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.seedAccount("admin", "dan");
  const login = async (https: boolean) => (await ctx.raw("POST", "/api/auth/login", { login: admin.login, password: admin.password }, { "X-Lama": "1", "x-lama-https": https ? "1" : "0" })).headers.getSetCookie();
  const secures = await login(true);
  assert.ok(secures.length > 0);
  for (const cookie of secures) {
    assert.match(cookie, /^__Host-lama_session=/, cookie);
    assert.match(cookie, /; Path=\/(;|$)/, cookie);
    assert.doesNotMatch(cookie, /; Domain=/i, cookie);
    assert.match(cookie, /; Secure/, cookie);
  }
  const simples = await login(false);
  assert.ok(simples.length > 0);
  for (const cookie of simples) {
    assert.match(cookie, /^lama_session=/, cookie);
    assert.doesNotMatch(cookie, /Secure/, cookie);
  }
  const call = ctx.anonymous();
  await call("POST", "/api/auth/login", { login: admin.login, password: admin.password }, { "x-lama-https": "1" });
  const poste = await call("POST", "/api/devices", { name: "Comptoir" }, { "x-lama-https": "1" });
  assert.equal(poste.status, 201, JSON.stringify(poste.body));
  const cookie = poste.headers.getSetCookie().find((c) => c.startsWith("__Host-lama_poste="));
  assert.ok(cookie);
  assert.match(cookie, /; Max-Age=34560000; .*Path=\/.*Secure/);
  assert.doesNotMatch(cookie, /; Domain=/i);
  // Le poste est reconnu en https par son cookie __Host-.
  assert.equal((await call("GET", "/api/auth/state", undefined, { "x-lama-https": "1" })).body.device?.name, "Comptoir");
  const sortie = await call("POST", "/api/auth/logout", undefined, { "x-lama-https": "1" });
  assert.match(sortie.headers.getSetCookie().join("\n"), /^__Host-lama_session=; Max-Age=0; .*Path=\/.*Secure/m);
});

test("repli en http : un poste qui tient une session https se reconnecte en http et obtient une session qui marche", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.seedAccount("admin", "dan");
  const call = ctx.anonymous();
  const https = { "x-lama-https": "1" };
  const http = { "x-lama-https": "0" };
  assert.equal((await call("POST", "/api/auth/login", { login: admin.login, password: admin.password }, https)).status, 200);
  assert.equal((await call("GET", "/api/devices", undefined, https)).status, 200, "session https valable en https");
  // lama retombe en http (certificat illisible) : le cookie __Host- n'est pas celui de l'écoute http.
  assert.equal((await call("GET", "/api/devices", undefined, http)).status, 401);
  const relogin = await call("POST", "/api/auth/login", { login: admin.login, password: admin.password }, http);
  assert.equal(relogin.status, 200, JSON.stringify(relogin.body));
  const cookies = relogin.headers.getSetCookie();
  assert.ok(cookies.length > 0);
  assert.ok(cookies.every((c) => c.startsWith("lama_session=") && !/Secure/.test(c)), cookies.join("\n"));
  assert.equal((await call("GET", "/api/devices", undefined, http)).status, 200, "session http qui marche");
  assert.equal((await call("GET", "/api/auth/state", undefined, http)).body.account?.login, admin.login);
});

/** Valeur d'un cookie dans les en-têtes Set-Cookie, `undefined` s'il n'y est pas. */
function valeur(lignes: string[], nom: string): string | undefined {
  const ligne = lignes.find((l) => l.startsWith(`${nom}=`));
  return ligne === undefined ? undefined : ligne.slice(nom.length + 1).split(";")[0];
}

/**
 * Contexte d'un passage en https : poste (facultatif) et session ouverts en
 * http, puis premier service en https noté une minute plus tard (ou une
 * minute plus tôt avec `apres`, pour simuler des cookies créés après coup).
 */
async function passage(t: { after: (fn: () => void) => void }, o: { poste?: boolean; apres?: boolean } = {}) {
  const ctx = await setupApp(t);
  const admin = await ctx.seedAccount("admin", "dan");
  const call = ctx.anonymous();
  const http = { "x-lama-https": "0" };
  if (o.apres) noterPassageHttps(ctx.db, ctx.clock.now - 60_000);
  const login = await call("POST", "/api/auth/login", { login: admin.login, password: admin.password }, http);
  assert.equal(login.status, 200);
  const session = valeur(login.headers.getSetCookie(), "lama_session")!;
  let poste: string | undefined;
  if (o.poste) {
    const declare = await call("POST", "/api/devices", { name: "Comptoir" }, http);
    assert.equal(declare.status, 201, JSON.stringify(declare.body));
    poste = valeur(declare.headers.getSetCookie(), "lama_poste")!;
  }
  if (!o.apres) noterPassageHttps(ctx.db, ctx.clock.now + 60_000);
  ctx.clock.now += 120_000;
  return { ctx, admin, call, session, poste };
}

/** Le cookie nu est effacé par la réponse : Max-Age=0, Path=/, sans Secure. */
function nuEfface(cookies: string[], nom: string): void {
  const efface = cookies.find((l) => l.startsWith(`${nom}=`));
  assert.ok(efface, cookies.join("\n"));
  assert.match(efface, new RegExp(`^${nom}=; Max-Age=0; .*Path=/`), efface);
  assert.doesNotMatch(efface, /Secure/, efface);
}

const HTTPS = { "x-lama-https": "1" };

test("passage en https : un poste déclaré avant est reconnu, avec un jeton neuf sous __Host- ; l'ancien ne vaut plus rien", async (t) => {
  const { ctx, call, poste } = await passage(t, { poste: true });
  const etat = await call("GET", "/api/auth/state", undefined, HTTPS);
  assert.equal(etat.body.device?.name, "Comptoir", "poste reconnu en https sans nouvelle déclaration");
  const cookies = etat.headers.getSetCookie();
  const neuf = valeur(cookies, "__Host-lama_poste");
  assert.ok(neuf);
  assert.notEqual(neuf, poste, "jeton du poste changé au passage");
  assert.match(cookies.find((l) => l.startsWith("__Host-lama_poste="))!, /; Max-Age=34560000; .*Path=\/.*Secure/);
  nuEfface(cookies, "lama_poste");

  // Requête suivante : seul le cookie __Host- est envoyé, le poste reste reconnu, plus rien à faire passer.
  const ensuite = await call("GET", "/api/auth/state", undefined, HTTPS);
  assert.equal(ensuite.body.device?.name, "Comptoir");
  assert.equal(valeur(ensuite.headers.getSetCookie(), "lama_poste"), undefined);
  // L'ancien jeton ne désigne plus aucun poste, ni en http ni en https.
  assert.equal((await ctx.raw("GET", "/api/auth/state", undefined, { cookie: `lama_poste=${poste}`, "x-lama-https": "0" })).body.device, null);
  assert.equal((await ctx.raw("GET", "/api/auth/state", undefined, { cookie: `lama_poste=${poste}`, ...HTTPS })).body.device, null);
});

test("passage en https : une session ouverte avant reste ouverte, avec un jeton neuf sous __Host- ; l'ancien ne vaut plus rien", async (t) => {
  const { ctx, admin, call, session } = await passage(t);
  const liste = await call("GET", "/api/devices", undefined, HTTPS);
  assert.equal(liste.status, 200, "toujours connecté en https");
  const cookies = liste.headers.getSetCookie();
  const neuf = valeur(cookies, "__Host-lama_session");
  assert.ok(neuf);
  assert.notEqual(neuf, session, "jeton de session changé au passage");
  assert.match(cookies.find((l) => l.startsWith("__Host-lama_session="))!, /; Max-Age=1209600; .*Path=\/.*Secure/);
  nuEfface(cookies, "lama_session");

  assert.equal((await call("GET", "/api/devices", undefined, HTTPS)).status, 200, "session gardée sous le seul cookie __Host-");
  assert.equal((await call("GET", "/api/auth/state", undefined, HTTPS)).body.account?.login, admin.login);
  assert.equal((await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}`, "x-lama-https": "0" })).status, 401, "ancien jeton révoqué");
  // La déconnexion en https ferme la session promue.
  await call("POST", "/api/auth/logout", undefined, HTTPS);
  assert.equal((await ctx.raw("GET", "/api/devices", undefined, { cookie: `__Host-lama_session=${neuf}`, ...HTTPS })).status, 401);
});

test("passage en https : la déconnexion à la toute première requête https ferme la session promue", async (t) => {
  const { ctx, session } = await passage(t);
  const sortie = await ctx.raw("POST", "/api/auth/logout", undefined, { "X-Lama": "1", cookie: `lama_session=${session}`, ...HTTPS });
  assert.equal(sortie.status, 200);
  const derniere = sortie.headers.getSetCookie().filter((l) => l.startsWith("__Host-lama_session=")).at(-1)!;
  assert.match(derniere, /^__Host-lama_session=; Max-Age=0/, "le cookie promu est effacé par la déconnexion");
  assert.equal((await ctx.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 0, "aucune session restante");
});

test("passage en https : cookies nus créés après le premier service en https ignorés et effacés (cookie injecté en http)", async (t) => {
  const { ctx, call, session, poste } = await passage(t, { poste: true, apres: true });
  const etat = await call("GET", "/api/auth/state", undefined, HTTPS);
  assert.equal(etat.body.account, null, "session non reprise");
  assert.equal(etat.body.device, null, "poste non repris");
  const cookies = etat.headers.getSetCookie();
  assert.equal(valeur(cookies, "__Host-lama_session"), undefined);
  assert.equal(valeur(cookies, "__Host-lama_poste"), undefined);
  nuEfface(cookies, "lama_session");
  nuEfface(cookies, "lama_poste");
  const refus = await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}; lama_poste=${poste}`, ...HTTPS });
  assert.equal(refus.status, 401);
  assert.equal(refus.body.code, "connexion");
  // Les jetons ne sont pas changés : rien n'a été promu.
  assert.equal((await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}`, "x-lama-https": "0" })).status, 200);
});

test("passage en https : sans premier service en https noté, aucun cookie nu n'est promu", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.seedAccount("admin", "dan");
  const login = await ctx.raw("POST", "/api/auth/login", { login: admin.login, password: admin.password }, { "X-Lama": "1", "x-lama-https": "0" });
  const session = valeur(login.headers.getSetCookie(), "lama_session")!;
  assert.equal((await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}`, ...HTTPS })).status, 401);
});

const JOUR_MS = 24 * 60 * 60_000;

/**
 * Avance l'horloge de `jours` après le passage noté (une minute après la
 * session), en gardant la session personnelle en vie par une requête http
 * tous les 10 jours : seule la fenêtre de passage peut alors la refuser.
 */
async function avancerDepuisPassage(ctx: { clock: { now: number }; raw: (...a: any[]) => Promise<{ status: number }> }, session: string, jours: number): Promise<void> {
  const cible = ctx.clock.now - 60_000 + jours * JOUR_MS;
  while (ctx.clock.now < cible) {
    ctx.clock.now = Math.min(cible, ctx.clock.now + 10 * JOUR_MS);
    assert.equal((await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}`, "x-lama-https": "0" })).status, 200, "session gardée en vie en http");
  }
}

test("passage en https : fenêtre de 30 jours, la promotion marche encore au 29e jour", async (t) => {
  assert.equal(FENETRE_PASSAGE_HTTPS_MS, 30 * JOUR_MS);
  const { ctx, session, poste } = await passage(t, { poste: true });
  await avancerDepuisPassage(ctx, session, 29);
  const reponse = await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}; lama_poste=${poste}`, ...HTTPS });
  assert.equal(reponse.status, 200, "session promue dans la fenêtre");
  const cookies = reponse.headers.getSetCookie();
  assert.ok(valeur(cookies, "__Host-lama_session"));
  assert.ok(valeur(cookies, "__Host-lama_poste"));
  nuEfface(cookies, "lama_session");
  nuEfface(cookies, "lama_poste");
});

test("passage en https : 31 jours après le premier service en https, aucun cookie nu n'est promu, il est effacé", async (t) => {
  const { ctx, session, poste } = await passage(t, { poste: true });
  await avancerDepuisPassage(ctx, session, 31);
  const reponse = await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}; lama_poste=${poste}`, ...HTTPS });
  assert.equal(reponse.status, 401);
  assert.equal(reponse.body.code, "connexion");
  const cookies = reponse.headers.getSetCookie();
  assert.equal(valeur(cookies, "__Host-lama_session"), undefined, "session d'avant le passage non promue");
  assert.equal(valeur(cookies, "__Host-lama_poste"), undefined, "poste d'avant le passage non promu");
  nuEfface(cookies, "lama_session");
  nuEfface(cookies, "lama_poste");
  // Rien n'a été tourné : les jetons valent toujours en http.
  assert.equal((await ctx.raw("GET", "/api/devices", undefined, { cookie: `lama_session=${session}`, "x-lama-https": "0" })).status, 200);
  assert.equal((await ctx.raw("GET", "/api/auth/state", undefined, { cookie: `lama_poste=${poste}`, "x-lama-https": "0" })).body.device?.name, "Comptoir");
});

test("passage en https : un cookie nu de session reçu pendant une maintenance n'est pas effacé, la requête suivante le promeut", async (t) => {
  const { ctx, session } = await passage(t);
  const nu = { cookie: `lama_session=${session}`, ...HTTPS };
  // Réponse rendue avant toute tentative de promotion (403 sans X-Lama) : cookie nu laissé.
  const sansXLama = await ctx.raw("POST", "/api/auth/logout", undefined, nu);
  assert.equal(sansXLama.status, 403);
  assert.equal(valeur(sansXLama.headers.getSetCookie(), "lama_session"), undefined, "cookie nu gardé (403)");

  // Maintenance réelle : une restauration la déclenche jusqu'au redémarrage.
  const dir = mkdtempSync(join(tmpdir(), "lama-passage-maintenance-"));
  mkdirSync(join(dir, "usb"));
  writeFileSync(join(dir, "usb", USB_MARKER), "");
  const identity = await generateIdentity();
  Object.assign(ctx.env, {
    BACKUP: {
      usbDir: join(dir, "usb"), tmpDir: join(dir, "attente"), dataDir: join(dir, "data"),
      recipient: await identityToRecipient(identity), exec: async () => ({ code: 0, stderr: "" }), requestRestart: () => {},
    },
  });
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await admin("POST", "/api/backups/run")).status, 200);
  const name = (await admin("GET", "/api/backups")).body.files.quotidiennes[0];
  assert.equal((await admin("POST", "/api/backups/restore", { source: "usb", name, identity })).status, 200);

  const pendant = await ctx.raw("GET", "/api/devices", undefined, nu);
  assert.equal(pendant.status, 503);
  assert.equal(pendant.body.code, "maintenance");
  const cookies = pendant.headers.getSetCookie();
  assert.equal(valeur(cookies, "lama_session"), undefined, "cookie nu gardé pendant la maintenance");
  assert.equal(valeur(cookies, "__Host-lama_session"), undefined);

  // Après le redémarrage (nouvelle instance de l'application sur la même base), le même cookie nu est promu.
  const { default: relance } = await import(`${await appBundle()}#apres-maintenance`);
  const apres = await relance.request("/api/devices", { headers: nu }, ctx.env);
  assert.equal(apres.status, 200, "session promue à la requête suivante");
  const promus = apres.headers.getSetCookie();
  assert.ok(valeur(promus, "__Host-lama_session"));
  assert.notEqual(valeur(promus, "__Host-lama_session"), session);
  nuEfface(promus, "lama_session");
});

test("premier service en https noté une seule fois", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, secret INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, updated_by INTEGER)");
  noterPassageHttps(db, 1000);
  noterPassageHttps(db, 2000);
  assert.deepEqual({ ...db.prepare("SELECT value FROM settings WHERE key = ?").get(CLE_HTTPS_DEPUIS) }, { value: "1000" });
});

test("rechargement à chaud : certificat renouvelé servi aux nouvelles connexions sans redémarrage ; paire mêlée ignorée", { skip }, async () => {
  const tls = fabriquerCertificats(mkdtempSync(join(tmpdir(), "lama-tls-")));
  const ca = readFileSync(join(tls, "autorite.crt"));
  const { running } = await demarrer(tls, null);
  const journal: string[] = [];
  try {
    assert.equal(running.http, null, "sans écoute http (base de formation, vague 3)");
    const avant = await serieServie(running.port, ca);
    assert.equal(avant, new X509Certificate(readFileSync(join(tls, "serveur.crt"))).serialNumber);
    assert.equal(running.reloader.verifier(), false, "rien n'a changé");

    assert.equal(lancer(tls, ["--renouveler", "--forcer"]).status, 0);
    const neuf = new X509Certificate(readFileSync(join(tls, "serveur.crt"))).serialNumber;
    assert.notEqual(neuf, avant);
    const log = console.log;
    console.log = (...args: unknown[]) => { journal.push(args.join(" ")); };
    try {
      assert.equal(running.reloader.verifier(), true);
    } finally {
      console.log = log;
    }
    assert.equal(await serieServie(running.port, ca), neuf);
    assert.equal(journal.length, 1, journal.join("\n"));
    assert.ok(journal[0].startsWith("Certificat du serveur rechargé, valable jusqu'au "), journal[0]);

    // Clé remplacée sans son certificat (instant entre les deux renommages) : l'ancienne paire reste servie.
    writeFileSync(join(tls, "serveur.key"), generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }));
    console.log = (...args: unknown[]) => { journal.push(args.join(" ")); };
    try {
      assert.equal(running.reloader.verifier(), false);
      assert.equal(running.reloader.verifier(), false, "même paire mêlée : refusée une seule fois au journal");
    } finally {
      console.log = log;
    }
    assert.equal(journal.filter((l) => l.startsWith("Nouveau certificat ignoré")).length, 1, journal.join("\n"));
    assert.equal(await serieServie(running.port, ca), neuf);
    const state = await viaHttps(running.port, ca, "/api/auth/state");
    assert.equal(state.status, 200);
  } finally {
    await shutdown(running);
  }
});

test("démarrage : un renouvellement tombé entre la signature et la lecture est rechargé au premier tour", { skip }, () => {
  const tls = fabriquerCertificats(mkdtempSync(join(tmpdir(), "lama-tls-")));
  const signature = signaturePaire(tls);
  assert.equal(lancer(tls, ["--renouveler", "--forcer"]).status, 0);
  const lue = lirePaire(tls);
  assert.ok("paire" in lue);
  const posees: PaireTls[] = [];
  const journal: string[] = [];
  const rechargeur = surveillerPaire(tls, { setSecureContext: (p) => posees.push(p) }, { signature, servie: lue.paire, journal: (l) => journal.push(l) });
  try {
    assert.equal(rechargeur.verifier(), true, "la signature d'avant la lecture diffère de la paire présente");
    assert.equal(posees.length, 1);
    assert.equal(rechargeur.verifier(), false, "ensuite, plus rien à recharger");
  } finally {
    rechargeur.arreter();
  }
});

test("échéance : dite au démarrage et à chaque rechargement, avertissement une seule fois à moins de 30 jours", { skip }, () => {
  const tls = fabriquerCertificats(mkdtempSync(join(tmpdir(), "lama-tls-")));
  const lue = lirePaire(tls);
  assert.ok("paire" in lue);
  const fin = echeanceDe(lue.paire.cert).getTime();
  let maintenant = fin - (ALERTE_ECHEANCE_JOURS + 1) * 86_400_000;
  const journal: string[] = [];
  const rechargeur = surveillerPaire(tls, { setSecureContext: () => {} }, { servie: lue.paire, journal: (l) => journal.push(l), maintenant: () => maintenant });
  try {
    assert.equal(journal.length, 1, journal.join("\n"));
    assert.match(journal[0], /^Certificat du serveur valable jusqu'au \d{1,2} \S+ \d{4}/);
    rechargeur.verifier();
    assert.equal(journal.length, 1, "31 jours restants : pas d'avertissement");

    maintenant = fin - 10 * 86_400_000;
    rechargeur.verifier();
    rechargeur.verifier();
    const alertes = journal.filter((l) => l.startsWith("Attention"));
    assert.equal(alertes.length, 1, journal.join("\n"));
    assert.match(alertes[0], /expire le .* \(dans 10 jours\)\. Renouvelez-le avec sudo lama-certificat --renouveler\.$/);

    // Certificat renouvelé : nouvelle échéance au journal, avertissement de nouveau possible.
    assert.equal(lancer(tls, ["--renouveler", "--forcer"]).status, 0);
    maintenant = echeanceDe(readFileSync(join(tls, "serveur.crt"))).getTime() + 86_400_000;
    assert.equal(rechargeur.verifier(), true);
    assert.ok(journal.some((l) => l.startsWith("Certificat du serveur rechargé, valable jusqu'au ")), journal.join("\n"));
    assert.match(journal.at(-1)!, /^Attention\u00a0: le certificat du serveur a expiré le /);
  } finally {
    rechargeur.arreter();
  }
});
