import assert from "node:assert/strict";
import { test } from "node:test";
import { dispoEssai, MAINTENANT, offreEssai } from "./essais/donnees.ts";
import { relaisEssai } from "./essais/relais.ts";
import { turnstileCloudflare } from "./services.ts";
import { Offre } from "./noyau/contrat.ts";
import { Depot } from "./stockage/depot.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Relais = Awaited<ReturnType<typeof relaisEssai>>;
const PLAGES = { p1: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] }, p2: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] } };

/** Relais d'essai dont le salon `eclat` a publié offre et plages ; l'heure et l'adresse de la cliente sont réglables. */
async function monter(o: Parameters<typeof relaisEssai>[0] = {}) {
  const etat = { maintenant: MAINTENANT, ip: "203.0.113.7" };
  const r = await relaisEssai({ etat: "actif", maintenant: () => etat.maintenant, ipDe: () => etat.ip, ...o });
  const depot = new Depot(r.base, "eclat");
  await depot.ecrireDocument("offre", 1, offreEssai(1), MAINTENANT);
  await depot.ecrireDocument("disponibilites", 1, dispoEssai(PLAGES), MAINTENANT);
  return { ...r, depot, etat };
}

async function lire(r: Relais, chemin: string, entetes: Record<string, string> = {}) {
  const res = await r.app.request(chemin, { headers: entetes });
  return { statut: res.status, json: (await res.json().catch(() => null)) as Json, entetes: res.headers };
}

async function suivre(r: Relais, salon: string, jeton: unknown) {
  const res = await r.app.request(`/api/${salon}/suivi`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jeton }) });
  return { statut: res.status, json: (await res.json().catch(() => null)) as Json, entetes: res.headers };
}

async function envoyer(r: Relais, corps: unknown, salon = "eclat") {
  const res = await r.app.request(`/api/${salon}/demandes`, { method: "POST", headers: { "content-type": "application/json" }, body: typeof corps === "string" ? corps : JSON.stringify(corps) });
  return { statut: res.status, json: (await res.json()) as Json };
}

const demande = (o: Record<string, unknown> = {}) => ({
  type: "creneau", prestation: "s60", praticienne: null, date: "2026-10-21", heure: "09:00", souhait: null,
  cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" }, note: "", accord: true, ...o,
});
const rappel = (telephone = "+237699123456") => demande({
  type: "rappel", date: null, heure: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" },
  cliente: { nom: "Mireille Ngo", telephone, langue: "fr" },
});

test("vitrine : état, institut, prestations, aujourd'hui dans le fuseau de l'institut, jamais en cache", async () => {
  const r = await monter();
  const v = await lire(r, "/api/eclat/vitrine");
  assert.equal(v.entetes.get("cache-control"), "no-store");
  assert.equal(v.json.etat, "ouvert");
  assert.equal(v.json.institut.nom, "Institut Éclat");
  assert.deepEqual(v.json.institut.devise, { code: "XAF", decimales: 0, symbole: "F", position: "apres" });
  assert.equal(v.json.prestations.length, 2);
  assert.deepEqual([v.json.aujourdhui, v.json.du, v.json.au, v.json.turnstile], ["2026-10-20", "2026-10-20", "2026-10-31", null]);
});

test("salon inconnu : 404 ; salon sans offre : fermé, sans institut", async () => {
  const r = await monter();
  assert.equal((await lire(r, "/api/inconnu/vitrine")).statut, 404);
  assert.equal((await envoyer(r, demande(), "inconnu")).statut, 404);
  const v = await lire(r, "/api/voisin/vitrine");
  assert.deepEqual([v.json.etat, v.json.institut, v.json.prestations], ["ferme", null, []]);
});

test("salon suspendu : vitrine fermée avec le nom de l'institut, aucun créneau, demande refusée (409 ferme)", async () => {
  const r = await monter();
  await r.salons.modifier("eclat", { etat: "suspendu" });
  const v = await lire(r, "/api/eclat/vitrine");
  assert.deepEqual([v.json.etat, v.json.institut.nom], ["ferme", "Institut Éclat"]);
  assert.deepEqual((await lire(r, "/api/eclat/jours?prestation=s60")).json, { jours: [], prochains: [] });
  const d = await envoyer(r, demande());
  assert.deepEqual([d.statut, d.json.erreur.code], [409, "ferme"]);
});

test("jours, prochaines disponibilités et créneaux d'un jour", async () => {
  const r = await monter();
  assert.deepEqual((await lire(r, "/api/eclat/jours?prestation=s60")).json, {
    jours: ["2026-10-21"], prochains: [{ date: "2026-10-21", heure: "09:00" }, { date: "2026-10-21", heure: "09:15" }, { date: "2026-10-21", heure: "09:30" }],
  });
  const avecBella = await lire(r, "/api/eclat/creneaux?prestation=s60&date=2026-10-21&praticienne=p2");
  assert.equal(avecBella.json.creneaux.length, 9);
  assert.deepEqual(avecBella.json.creneaux[0], { heure: "09:00", praticiennes: ["p2"] });
  assert.equal((await lire(r, "/api/eclat/creneaux?prestation=s60&date=21-10-2026")).statut, 422);
});

test("deux envois identiques : le second est refusé (409 indisponible), jamais enregistré deux fois", async () => {
  const r = await monter();
  const premier = await envoyer(r, demande({ praticienne: "p1" }));
  assert.equal(premier.statut, 201);
  assert.match(premier.json.jeton, /^[A-Za-z0-9_-]{30,}$/);
  const second = await envoyer(r, demande({ praticienne: "p1" }));
  assert.deepEqual([second.statut, second.json.erreur.code], [409, "indisponible"]);
  assert.equal(await r.depot.enAttente(), 1);
});

test("suivi : sans nom ni téléphone ; nom de la prestation gardé après son retrait ; jeton inconnu ou d'un autre salon (404)", async () => {
  const r = await monter();
  const { jeton } = (await envoyer(r, demande({ praticienne: "p1" }))).json;
  assert.deepEqual((await suivre(r, "eclat", jeton)).json, { type: "creneau", prestation: { fr: "Soin visage", en: "Facial" }, date: "2026-10-21", heure: "09:00", souhait: null, etat: "en_attente", horaire: null, message: null, issue: null });
  const sansSoin = Offre.parse({ ...offreEssai(2), prestations: offreEssai().prestations.filter((p) => p.id === "s30"), praticiennes: [{ id: "p1", prenom: "Awa", prestations: ["s30"] }] });
  await r.depot.ecrireDocument("offre", 2, sansSoin, MAINTENANT);
  assert.deepEqual((await suivre(r, "eclat", jeton)).json.prestation, { fr: "Soin visage", en: "Facial" });
  assert.equal((await suivre(r, "eclat", "inconnu")).statut, 404);
  assert.equal((await r.app.request(`/api/eclat/suivi/${jeton}`)).status, 404, "plus de route GET : le jeton ne passe jamais dans l'adresse");
  assert.equal((await suivre(r, "eclat", 42)).statut, 404);
  assert.equal((await suivre(r, "eclat", jeton)).entetes.get("cache-control"), "no-store");
  assert.equal((await suivre(r, "voisin", jeton)).statut, 404);
});

test("accord non coché, téléphone mal formé, corps illisible : 422", async () => {
  const r = await monter();
  assert.equal((await envoyer(r, demande({ accord: false }))).statut, 422);
  assert.equal((await envoyer(r, demande({ cliente: { nom: "Mireille", telephone: "699 12 34 56", langue: "fr" } }))).statut, 422);
  assert.equal((await envoyer(r, "pas du json")).statut, 422);
});

test("champ piège rempli : faux accusé de réception, rien d'enregistré", async () => {
  const r = await monter();
  assert.equal((await envoyer(r, demande({ piege: "http://exemple.invalid" }))).statut, 201);
  assert.equal(await r.depot.enAttente(), 0);
});

test("au plus trois demandes en attente par numéro et par salon, compteur libéré par une décision", async () => {
  const r = await monter();
  await new Depot(r.base, "voisin").ecrireDocument("offre", 1, offreEssai(1), MAINTENANT);
  for (let i = 0; i < 3; i++) assert.equal((await envoyer(r, rappel())).statut, 201);
  const quatrieme = await envoyer(r, rappel());
  assert.deepEqual([quatrieme.statut, quatrieme.json.erreur.code], [429, "trop_de_demandes_telephone"]);
  assert.equal((await envoyer(r, rappel(), "voisin")).statut, 201, "le même numéro chez un autre salon");
  assert.equal((await envoyer(r, rappel("+237677000000"))).statut, 201);
  const [premiere] = await r.depot.nonAccusees(null, 1);
  await r.depot.decider(premiere.id, { decision: "traitee", horaire: null, message: null }, MAINTENANT);
  assert.equal((await envoyer(r, rappel())).statut, 201);
});

test("limite par numéro : des créneaux relevés mais jamais décidés ne comptent plus une fois leur date passée", async () => {
  const r = await monter();
  for (const heure of ["09:00", "10:00", "11:00"]) assert.equal((await envoyer(r, demande({ praticienne: "p1", heure }))).statut, 201, heure);
  for (const d of await r.depot.nonAccusees(null, 10, MAINTENANT)) await r.depot.accuser(d.id, MAINTENANT);
  assert.equal((await envoyer(r, rappel())).statut, 429);
  // Le 21 octobre est passé à l'institut (le 22 à 00:30 à Douala) : les trois créneaux ne comptent plus.
  r.etat.maintenant = Date.UTC(2026, 9, 21, 23, 30);
  assert.equal((await envoyer(r, rappel())).statut, 201);
});

test("limite par adresse IP et par heure", async () => {
  const r = await monter({ config: { demandesParHeureParIp: 2 } });
  assert.equal((await envoyer(r, rappel("+237670000001"))).statut, 201);
  assert.equal((await envoyer(r, rappel("+237670000002"))).statut, 201);
  const trop = await envoyer(r, rappel("+237670000003"));
  assert.deepEqual([trop.statut, trop.json.erreur.code], [429, "trop_de_demandes"]);
  r.etat.ip = "198.51.100.9";
  assert.equal((await envoyer(r, rappel("+237670000004"))).statut, 201);
  r.etat.ip = "203.0.113.7";
  r.etat.maintenant += 60 * 60 * 1000;
  assert.equal((await envoyer(r, rappel("+237670000005"))).statut, 201);
});

test("limite par adresse : le compteur est propre à chaque salon", async () => {
  const r = await monter({ config: { demandesParHeureParIp: 1 } });
  await new Depot(r.base, "voisin").ecrireDocument("offre", 1, offreEssai(1), MAINTENANT);
  assert.equal((await envoyer(r, rappel("+237670000001"))).statut, 201);
  assert.equal((await envoyer(r, rappel("+237670000002"))).statut, 429);
  assert.equal((await envoyer(r, rappel("+237670000002"), "voisin")).statut, 201, "même adresse, autre salon");
});

test("dépôts « sans préférence » en série : la capacité s'épuise, l'adresse plafonne les essais, le numéro plafonne les rappels", async () => {
  const r = await monter({ config: { demandesParHeureParIp: 3 } });
  const statuts = [];
  for (let i = 0; i < 5; i++) statuts.push((await envoyer(r, demande({ cliente: { nom: "Robot", telephone: `+23767000010${i}`, langue: "fr" } }))).statut);
  // Deux praticiennes : deux créneaux retenus au plus ; l'essai refusé compte aussi pour l'adresse, puis plus rien ne passe.
  assert.deepEqual(statuts, [201, 201, 409, 429, 429]);
  assert.equal(await r.depot.enAttente(), 2);
  // Un même numéro, même en changeant d'adresse, ne garde pas plus de MAX_PAR_TELEPHONE demandes en attente.
  const r2 = await monter();
  const rappels = [];
  for (let i = 0; i < 5; i++) {
    r2.etat.ip = `198.51.100.${i}`;
    rappels.push((await envoyer(r2, rappel())).statut);
  }
  assert.deepEqual(rappels, [201, 201, 201, 429, 429]);
});

test("Turnstile réglé : jeton refusé (422 verification), jeton accepté, clé du site publiée", async () => {
  const r = await monter({ config: { turnstile: { cleSite: "cle-site", secret: "secret" } }, verifierTurnstile: async (jeton) => jeton === "bon" });
  assert.equal((await lire(r, "/api/eclat/vitrine")).json.turnstile, "cle-site");
  const refus = await envoyer(r, demande({ turnstile: "mauvais" }));
  assert.deepEqual([refus.statut, refus.json.erreur.code], [422, "verification"]);
  assert.equal((await envoyer(r, demande({ turnstile: "bon" }))).statut, 201);
});

test("plages de plus de 2 heures : créneau refusé (409 rappel_seulement), rappel accepté", async () => {
  const r = await monter();
  r.etat.maintenant += 3 * 60 * 60 * 1000;
  const d = await envoyer(r, demande());
  assert.deepEqual([d.statut, d.json.erreur.code], [409, "rappel_seulement"]);
  assert.equal((await envoyer(r, rappel())).statut, 201);
});

test("CORS : origine autorisée servie, autre origine sans en-têtes, requête préalable OPTIONS", async () => {
  const r = await monter();
  await r.salons.modifier("eclat", { origines: ["https://www.eclat.cm"] });
  const permise = await lire(r, "/api/eclat/vitrine", { origin: "https://www.eclat.cm" });
  assert.equal(permise.entetes.get("access-control-allow-origin"), "https://www.eclat.cm");
  assert.equal(permise.entetes.get("vary"), "Origin");
  const autre = await lire(r, "/api/eclat/vitrine", { origin: "https://pirate.exemple" });
  assert.equal(autre.entetes.get("access-control-allow-origin"), null);
  const prealable = await r.app.request("/api/eclat/demandes", { method: "OPTIONS", headers: { origin: "https://www.eclat.cm", "access-control-request-method": "POST" } });
  assert.equal(prealable.status, 204);
  assert.equal(prealable.headers.get("access-control-allow-methods"), "GET, POST");
  assert.equal(prealable.headers.get("access-control-allow-headers"), "content-type");
  assert.equal((await lire(r, "/api/voisin/vitrine", { origin: "https://www.eclat.cm" })).entetes.get("access-control-allow-origin"), null, "origines propres à chaque salon");
});

test("corps de plus de 16 Ko : 413 corps_trop_gros, avec ou sans content-length", async () => {
  const r = await monter();
  const gros = JSON.stringify(demande({ note: "x".repeat(20 * 1024) }));
  const avec = await r.app.request("/api/eclat/demandes", { method: "POST", headers: { "content-type": "application/json", "content-length": String(gros.length) }, body: gros });
  assert.deepEqual([avec.status, ((await avec.json()) as Json).erreur.code], [413, "corps_trop_gros"]);
  const flux = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(gros)); c.close(); } });
  const sans = await r.app.request("/api/eclat/demandes", { method: "POST", headers: { "content-type": "application/json" }, body: flux, duplex: "half" } as RequestInit);
  assert.deepEqual([sans.status, ((await sans.json()) as Json).erreur.code], [413, "corps_trop_gros"]);
  assert.equal(await r.depot.enAttente(), 0);
});

test("champ piège trop long : faux accusé quand même, rien d'enregistré", async () => {
  const r = await monter();
  assert.equal((await envoyer(r, demande({ piege: "x".repeat(500) }))).statut, 201);
  assert.equal(await r.depot.enAttente(), 0);
});

test("jamais en cache ni sans Vary, même pour un salon inconnu ; salon suspendu : pas de dates", async () => {
  const r = await monter();
  const inconnu = await lire(r, "/api/inconnu/vitrine");
  assert.deepEqual([inconnu.statut, inconnu.entetes.get("cache-control"), inconnu.entetes.get("vary")], [404, "no-store", "Origin"]);
  const sansOrigine = await lire(r, "/api/eclat/vitrine");
  assert.equal(sansOrigine.entetes.get("vary"), "Origin");
  await r.salons.modifier("eclat", { etat: "suspendu" });
  const v = await lire(r, "/api/eclat/vitrine");
  assert.deepEqual([v.json.du, v.json.au], [null, null]);
});

test("Turnstile réglé et aucun jeton envoyé : refusé", async () => {
  const r = await monter({ config: { turnstile: { cleSite: "cle-site", secret: "secret" } }, verifierTurnstile: async (jeton) => jeton === "bon" });
  const d = await envoyer(r, demande());
  assert.deepEqual([d.statut, d.json.erreur.code], [422, "verification"]);
  assert.equal(await r.depot.enAttente(), 0);
});

test("Turnstile réel : échec réseau ou délai dépassé refusé, adresse transmise seulement si elle en a la forme", async () => {
  assert.equal(await turnstileCloudflare("secret", async () => { throw new Error("réseau"); })("bon", "203.0.113.7"), false);
  assert.equal(await turnstileCloudflare("secret", async () => new Response("{}", { status: 500 }))("bon", "203.0.113.7"), false);
  assert.equal(await turnstileCloudflare("secret", async () => new Response(JSON.stringify({ success: true })))("", "203.0.113.7"), false);
  const vus: { corps: URLSearchParams; signal: AbortSignal | null | undefined }[] = [];
  const faux: typeof fetch = async (_u, init) => {
    vus.push({ corps: init?.body as URLSearchParams, signal: init?.signal });
    return new Response(JSON.stringify({ success: true }));
  };
  const verifier = turnstileCloudflare("secret", faux);
  assert.equal(await verifier("bon", "203.0.113.7"), true);
  assert.equal(await verifier("bon", "inconnue"), true);
  assert.equal(await verifier("bon", "2001:db8::1"), true);
  assert.deepEqual(vus.map((v) => v.corps.get("remoteip")), ["203.0.113.7", null, "2001:db8::1"]);
  assert.ok(vus.every((v) => v.signal instanceof AbortSignal));
});

test("OPTIONS : origine non autorisée sans en-têtes CORS, origine autorisée avec durée de mise en cache", async () => {
  const r = await monter();
  await r.salons.modifier("eclat", { origines: ["https://www.eclat.cm"] });
  const refusee = await r.app.request("/api/eclat/demandes", { method: "OPTIONS", headers: { origin: "https://pirate.exemple", "access-control-request-method": "POST" } });
  assert.equal(refusee.headers.get("access-control-allow-origin"), null);
  assert.equal(refusee.headers.get("access-control-allow-methods"), null);
  const permise = await r.app.request("/api/eclat/demandes", { method: "OPTIONS", headers: { origin: "https://www.eclat.cm", "access-control-request-method": "POST" } });
  assert.equal(permise.headers.get("access-control-max-age"), "600");
});

test("adresse du client : seul cf-connecting-ip compte, x-forwarded-for est ignoré", async () => {
  const { ipParDefaut } = await import("./services.ts");
  const ctx = (h: Record<string, string>) => ({ req: { header: (n: string) => h[n] } }) as unknown as Parameters<typeof ipParDefaut>[0];
  assert.equal(ipParDefaut(ctx({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" })), "203.0.113.7");
  assert.equal(ipParDefaut(ctx({ "x-forwarded-for": "1.2.3.4" })), "inconnue");
});

/** Dépôt brut : en-têtes au choix (type de contenu, origine), pour les requêtes « simples » d'un autre site. */
async function poster(r: Relais, chemin: string, corps: unknown, entetes: Record<string, string>) {
  const res = await r.app.request(chemin, { method: "POST", headers: entetes, body: JSON.stringify(corps) });
  return { statut: res.status, json: (await res.json().catch(() => null)) as Json };
}

test("dépôt et suivi : corps application/json exigé (415 type_contenu), paramètres du type ignorés", async () => {
  const r = await monter();
  for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const d = await poster(r, "/api/eclat/demandes", rappel(), { "content-type": type });
    assert.deepEqual([d.statut, d.json.erreur.code], [415, "type_contenu"], type);
  }
  assert.deepEqual((await poster(r, "/api/eclat/demandes", rappel(), {})).statut, 415, "sans type");
  const suivi = await poster(r, "/api/eclat/suivi", { jeton: "x" }, { "content-type": "text/plain" });
  assert.deepEqual([suivi.statut, suivi.json.erreur.code], [415, "type_contenu"]);
  assert.equal(await r.depot.enAttente(), 0);
  const accepte = await poster(r, "/api/eclat/demandes", rappel(), { "content-type": "Application/JSON; charset=utf-8" });
  assert.equal(accepte.statut, 201);
});

test("dépôt et suivi : origine étrangère refusée (403 origine) ; origine déclarée, même origine et sans origine acceptées", async () => {
  const r = await monter();
  await r.salons.modifier("eclat", { origines: ["https://www.eclat.cm"] });
  const json = { "content-type": "application/json" };
  for (const origin of ["https://pirate.exemple", "null", "http://localhost.pirate.exemple"]) {
    const d = await poster(r, "/api/eclat/demandes", rappel(), { ...json, origin });
    assert.deepEqual([d.statut, d.json.erreur.code], [403, "origine"], origin);
    const suivi = await poster(r, "/api/eclat/suivi", { jeton: "x" }, { ...json, origin });
    assert.deepEqual([suivi.statut, suivi.json.erreur.code], [403, "origine"], origin);
  }
  assert.equal(await r.depot.enAttente(), 0);
  assert.equal((await poster(r, "/api/eclat/demandes", rappel("+237670000001"), { ...json, origin: "https://www.eclat.cm" })).statut, 201, "déclarée");
  assert.equal((await poster(r, "/api/eclat/demandes", rappel("+237670000002"), { ...json, origin: "http://localhost" })).statut, 201, "même origine");
  assert.equal((await poster(r, "/api/eclat/demandes", rappel("+237670000003"), json)).statut, 201, "sans origine");
  assert.equal((await poster(r, "/api/eclat/suivi", { jeton: "x" }, { ...json, origin: "https://www.eclat.cm" })).statut, 404, "suivi déclaré : jeton inconnu");
});

const THEME = { fond: "#F3EDE3", accent: "#141312", police: "elegante" as const };
const JOUR: [string, string][] = [["09:00", "20:00"]];
const HORAIRES = { lun: JOUR, mar: JOUR, mer: JOUR, jeu: JOUR, ven: JOUR, sam: JOUR, dim: [] as [string, string][] };

test("vitrine : thème et horaires publiés rendus, null sans eux", async () => {
  const r = await monter();
  const sans = await lire(r, "/api/eclat/vitrine");
  assert.deepEqual([sans.json.institut.theme, sans.json.institut.horaires], [null, null]);
  const o = offreEssai(2);
  await r.depot.ecrireDocument("offre", 2, Offre.parse({ ...o, institut: { ...o.institut, theme: THEME, horaires: HORAIRES } }), MAINTENANT);
  const avec = await lire(r, "/api/eclat/vitrine");
  assert.deepEqual(avec.json.institut.theme, THEME);
  assert.deepEqual(avec.json.institut.horaires.mar, [["09:00", "20:00"]]);
});

test("dépôt pendant la fermeture : hors_horaires vrai, dans le fuseau de l'institut ; faux sans horaires ou pendant l'ouverture", async () => {
  const r = await monter();
  const sans = await envoyer(r, demande());
  assert.equal(sans.statut, 201);
  assert.equal(sans.json.hors_horaires, false, "sans horaires publiés : jamais « hors horaires »");
  const o = offreEssai(2);
  await r.depot.ecrireDocument("offre", 2, Offre.parse({ ...o, institut: { ...o.institut, horaires: HORAIRES } }), MAINTENANT);
  // Mardi 08:00 à Douala : l'institut ouvre à 09:00.
  const tot = await envoyer(r, demande({ heure: "10:00" }));
  assert.equal(tot.statut, 201);
  assert.equal(tot.json.hors_horaires, true);
  // 09:30 à Douala (08:30 UTC) : ouvert, plages encore fraîches.
  r.etat.maintenant = Date.UTC(2026, 9, 20, 8, 30);
  const ouvert = await envoyer(r, demande({ heure: "11:00", cliente: { nom: "Brenda Tabi", telephone: "+237699123457", langue: "fr" } }));
  assert.equal(ouvert.statut, 201);
  assert.equal(ouvert.json.hors_horaires, false);
});

test("dépôt : le prénom saisi à part est transmis à lama avec le nom complet ; sans prénom, la demande passe comme avant", async () => {
  const r = await monter();
  const avec = await envoyer(r, demande({ cliente: { prenom: "Mireille", nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" } }));
  assert.equal(avec.statut, 201);
  const sans = await envoyer(r, demande({ heure: "10:00", cliente: { nom: "Brenda Tabi", telephone: "+237655000222", langue: "fr" } }));
  assert.equal(sans.statut, 201);
  const releve = await r.depot.nonAccusees(null, 10, MAINTENANT + 60_000);
  assert.deepEqual(releve.map((d) => d.cliente), [
    { prenom: "Mireille", nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" },
    { nom: "Brenda Tabi", telephone: "+237655000222", langue: "fr" },
  ]);
  const vide = await envoyer(r, demande({ heure: "10:30", cliente: { prenom: " ", nom: "Carine Mbia", telephone: "+237655000333", langue: "fr" } }));
  assert.deepEqual([vide.statut, vide.json.erreur.code], [422, "donnees_invalides"]);
});
