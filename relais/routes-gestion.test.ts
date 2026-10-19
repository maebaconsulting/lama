import assert from "node:assert/strict";
import { test } from "node:test";
import { dispoEssai, MAINTENANT, offreEssai } from "./essais/donnees.ts";
import { appelSigne, CONFIG_ESSAI, relaisEssai } from "./essais/relais.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Relais = Awaited<ReturnType<typeof relaisEssai>>;
const MDP = CONFIG_ESSAI.motDePasseGestion;

async function monter() {
  const etat = { maintenant: MAINTENANT };
  const r = await relaisEssai({ etat: "actif", maintenant: () => etat.maintenant, ipDe: () => "203.0.113.7" });
  return { ...r, etat };
}

async function connecter(r: Relais, motDePasse = MDP, o: { entete?: boolean; adresse?: string } = {}) {
  return r.app.request(o.adresse ?? "/gestion/api/connexion", {
    method: "POST",
    headers: { "content-type": "application/json", ...(o.entete === false ? {} : { "x-relais-gestion": "1" }) },
    body: JSON.stringify({ mot_de_passe: motDePasse }),
  });
}

/** Valeur du cookie de session posé par une réponse (`relais_gestion=…`). */
function cookieDe(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

async function session(r: Relais): Promise<string> {
  const res = await connecter(r);
  assert.equal(res.status, 204);
  return cookieDe(res);
}

async function gestion(r: Relais, cookie: string, methode: string, chemin: string, corps?: unknown) {
  const res = await r.app.request(`/gestion/api${chemin}`, {
    method: methode,
    headers: { cookie, "x-relais-gestion": "1", "content-type": "application/json" },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  return { statut: res.status, json: (await res.json().catch(() => null)) as Json };
}

test("connexion : mot de passe refusé, en-tête de l'interface exigé, cookie de session protégé", async () => {
  const r = await monter();
  const faux = await connecter(r, "mauvais");
  assert.equal(faux.status, 401);
  assert.equal(((await faux.json()) as Json).erreur.code, "mot_de_passe");
  assert.equal((await connecter(r, MDP, { entete: false })).status, 403);
  const ok = await connecter(r);
  assert.equal(ok.status, 204);
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^relais_gestion=\d+\.[0-9a-f]{64};/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/gestion/);
  assert.doesNotMatch(cookie, /Secure/);
  assert.match((await connecter(r, MDP, { adresse: "https://relais.exemple/gestion/api/connexion" })).headers.get("set-cookie") ?? "", /Secure/);
});

test("connexion : plus de 5 essais par quart d'heure bloqués, même avec le bon mot de passe", async () => {
  const r = await monter();
  for (let i = 0; i < 5; i++) assert.equal((await connecter(r, "mauvais")).status, 401);
  const bloque = await connecter(r);
  assert.equal(bloque.status, 429);
  assert.equal(((await bloque.json()) as Json).erreur.code, "trop_d_essais");
  r.etat.maintenant += 15 * 60 * 1000;
  assert.equal((await connecter(r)).status, 204);
});

test("session exigée : absente, contrefaite, expirée ou fermée", async () => {
  const r = await monter();
  assert.deepEqual((await gestion(r, "", "GET", "/salons")).json.erreur.code, "session");
  assert.equal((await gestion(r, `relais_gestion=${MAINTENANT + 1000}.${"0".repeat(64)}`, "GET", "/salons")).statut, 401);
  const cookie = await session(r);
  assert.equal((await gestion(r, cookie, "GET", "/salons")).statut, 200);
  const sortie = await r.app.request("/gestion/api/deconnexion", { method: "POST", headers: { cookie, "x-relais-gestion": "1" } });
  assert.equal(sortie.status, 204);
  assert.match(sortie.headers.get("set-cookie") ?? "", /relais_gestion=;.*Max-Age=0/);
  r.etat.maintenant += 12 * 60 * 60 * 1000 + 1;
  assert.equal((await gestion(r, cookie, "GET", "/salons")).statut, 401, "session expirée");
});

test("liste des salons avec l'état de la liaison", async () => {
  const r = await monter();
  const cookie = await session(r);
  await appelSigne(r.app, r.cles.eclat, "eclat", "PUT", "/lama/v1/offre", offreEssai(4));
  await appelSigne(r.app, r.cles.eclat, "eclat", "PUT", "/lama/v1/disponibilites", dispoEssai({ p1: { "2026-10-21": [["09:00", "12:00"]] } }));
  const liste = (await gestion(r, cookie, "GET", "/salons")).json.salons;
  assert.deepEqual(liste.map((s: Json) => s.id), ["eclat", "voisin"]);
  assert.deepEqual(
    [liste[0].etat, liste[0].dernier_appel_le, liste[0].version_offre, liste[0].plages_generees_le, liste[0].plages_a_jour, liste[0].demandes_en_attente],
    ["actif", MAINTENANT, 4, MAINTENANT - 60_000, true, 0],
  );
  assert.deepEqual([liste[1].dernier_appel_le, liste[1].version_offre, liste[1].plages_a_jour], [null, null, false]);
  assert.equal("cle" in liste[0], false, "la clé n'est jamais renvoyée par la liste");
});

test("création : clé rendue une fois et aussitôt valable pour lama ; identifiant pris, réservé ou mal formé refusé", async () => {
  const r = await monter();
  const cookie = await session(r);
  const cree = await gestion(r, cookie, "POST", "/salons", { id: "nouveau", nom: "Nouveau salon" });
  assert.equal(cree.statut, 201);
  assert.match(cree.json.cle, /^[0-9a-f]{64}$/);
  assert.equal(cree.json.salon.etat, "actif");
  assert.equal((await appelSigne(r.app, cree.json.cle, "nouveau", "GET", "/lama/v1/etat")).statut, 200);
  assert.equal((await gestion(r, cookie, "POST", "/salons", { id: "nouveau", nom: "Autre" })).statut, 409);
  assert.equal((await gestion(r, cookie, "POST", "/salons", { id: "api", nom: "Réservé" })).statut, 422);
  assert.equal((await gestion(r, cookie, "POST", "/salons", { id: "Mauvais Id", nom: "x" })).statut, 422);
  assert.equal((await gestion(r, "", "POST", "/salons", { id: "sans-session", nom: "x" })).statut, 401);
});

test("modification : suspendre ferme la liaison, origines vérifiées, salon inconnu", async () => {
  const r = await monter();
  const cookie = await session(r);
  const suspendu = await gestion(r, cookie, "PUT", "/salons/eclat", { etat: "suspendu" });
  assert.deepEqual([suspendu.statut, suspendu.json.salon.etat], [200, "suspendu"]);
  assert.equal((await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/etat")).statut, 403);
  const origines = await gestion(r, cookie, "PUT", "/salons/eclat", { origines: ["https://www.eclat.cm", "https://www.eclat.cm"] });
  assert.deepEqual(origines.json.salon.origines, ["https://www.eclat.cm"], "doublons retirés");
  assert.equal((await gestion(r, cookie, "PUT", "/salons/eclat", { origines: ["www.eclat.cm"] })).statut, 422);
  assert.equal((await gestion(r, cookie, "PUT", "/salons/eclat", { etat: "ferme" })).statut, 422);
  assert.equal((await gestion(r, cookie, "PUT", "/salons/inconnu", { nom: "x" })).statut, 404);
});

test("clé remplacée : l'ancienne est refusée, la nouvelle acceptée", async () => {
  const r = await monter();
  const cookie = await session(r);
  const { cle } = (await gestion(r, cookie, "POST", "/salons/eclat/cle")).json;
  assert.match(cle, /^[0-9a-f]{64}$/);
  assert.equal((await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/etat")).statut, 401);
  assert.equal((await appelSigne(r.app, cle, "eclat", "GET", "/lama/v1/etat")).statut, 200);
  assert.equal((await gestion(r, cookie, "POST", "/salons/inconnu/cle")).statut, 404);
});

test("suppression : confirmation exigée, puis le salon et ses données disparaissent", async () => {
  const r = await monter();
  const cookie = await session(r);
  await appelSigne(r.app, r.cles.eclat, "eclat", "PUT", "/lama/v1/offre", offreEssai(1));
  assert.equal((await gestion(r, cookie, "DELETE", "/salons/eclat", { confirmation: "voisin" })).statut, 422);
  assert.equal((await gestion(r, cookie, "DELETE", "/salons/eclat", { confirmation: "eclat" })).statut, 204);
  assert.equal((await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/etat")).statut, 401);
  assert.equal((await r.app.request("/api/eclat/vitrine")).status, 404);
  assert.deepEqual((await gestion(r, cookie, "GET", "/salons")).json.salons.map((s: Json) => s.id), ["voisin"]);
  assert.equal((await gestion(r, cookie, "DELETE", "/salons/eclat", { confirmation: "eclat" })).statut, 404);
});

test("corps trop gros : 413 corps_trop_gros", async () => {
  const r = await monter();
  const cookie = await session(r);
  const res = await r.app.request("/gestion/api/salons", {
    method: "POST",
    headers: { cookie, "x-relais-gestion": "1", "content-type": "application/json" },
    body: JSON.stringify({ id: "gros", nom: "x".repeat(20_000) }),
  });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as Json).erreur.code, "corps_trop_gros");
});

test("déconnexion sans l'en-tête de l'interface : refusée ; session fermée si le mot de passe de gestion change", async () => {
  const r = await monter();
  const cookie = await session(r);
  assert.equal((await r.app.request("/gestion/api/deconnexion", { method: "POST", headers: { cookie } })).status, 403);
  assert.equal((await r.app.request("/gestion/api/salons", { method: "PUT", headers: { cookie } })).status, 403);
  const autre = await relaisEssai({ config: { motDePasseGestion: "autre-mot-de-passe" } });
  assert.equal((await gestion(autre, cookie, "GET", "/salons")).statut, 401, "cookie signé avec un autre mot de passe");
});

test("la clé n'apparaît ni dans la liste ni dans la modification", async () => {
  const r = await monter();
  const cookie = await session(r);
  const cree = await gestion(r, cookie, "POST", "/salons", { id: "nouveau", nom: "Nouveau salon" });
  const brut = JSON.stringify([(await gestion(r, cookie, "GET", "/salons")).json, (await gestion(r, cookie, "PUT", "/salons/nouveau", { nom: "Renommé" })).json]);
  assert.equal(brut.includes(cree.json.cle), false);
});

test("déconnexion : un cookie copié avant est refusé, une nouvelle connexion fonctionne", async () => {
  const r = await monter();
  const copie = await session(r);
  assert.equal((await r.app.request("/gestion/api/deconnexion", { method: "POST", headers: { cookie: copie, "x-relais-gestion": "1" } })).status, 204);
  assert.equal((await gestion(r, copie, "GET", "/salons")).json.erreur.code, "session");
  r.etat.maintenant += 1000;
  const neuf = await session(r);
  assert.equal((await gestion(r, neuf, "GET", "/salons")).statut, 200);
  assert.equal((await gestion(r, copie, "GET", "/salons")).statut, 401, "l'ancien reste refusé");
});

test("jeton réel dont l'expiration est modifiée avec son HMAC d'origine : refusé", async () => {
  const r = await monter();
  const [nom, valeur] = (await session(r)).split("=");
  const [expire, hmac] = valeur.split(".");
  const res = await gestion(r, `${nom}=${Number(expire) + 3600_000}.${hmac}`, "GET", "/salons");
  assert.deepEqual([res.statut, res.json.erreur.code], [401, "session"]);
});

test("session fermée si la clé générale change", async () => {
  const r = await monter();
  const cookie = await session(r);
  const autre = await relaisEssai({ config: { cleMaitre: "z".repeat(48) } });
  assert.equal((await gestion(autre, cookie, "GET", "/salons")).statut, 401);
});

test("réponses de gestion jamais mises en cache", async () => {
  const r = await monter();
  assert.equal((await connecter(r, "mauvais")).headers.get("cache-control"), "no-store");
  const cookie = await session(r);
  const res = await r.app.request("/gestion/api/salons", { headers: { cookie } });
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal((await r.app.request("/gestion/api/salons")).headers.get("cache-control"), "no-store", "refus de session compris");
});

test("déconnexion sans session valide : cookie effacé, mais la session de l'exploitant reste valable", async () => {
  const r = await monter();
  const cookie = await session(r);
  for (const c of ["", `relais_gestion=${MAINTENANT + 1000}.${"0".repeat(64)}`]) {
    const res = await r.app.request("/gestion/api/deconnexion", { method: "POST", headers: { cookie: c, "x-relais-gestion": "1" } });
    assert.equal(res.status, 204);
    assert.match(res.headers.get("set-cookie") ?? "", /Max-Age=0/);
  }
  r.etat.maintenant += 1000;
  assert.equal((await gestion(r, cookie, "GET", "/salons")).statut, 200);
});
