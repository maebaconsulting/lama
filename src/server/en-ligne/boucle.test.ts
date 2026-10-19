import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { initDB } from "@clawnify/db";
import { MAINTENANT, offreEssai } from "../../../relais/essais/donnees.ts";
import { relaisEssai } from "../../../relais/essais/relais.ts";
import { Depot } from "../../../relais/stockage/depot.ts";
import { decode } from "../messages.ts";
import { publish } from "../realtime.ts";
import { setMasterKey, setSetting } from "../settings.ts";
import { sqliteStorage } from "../storage.ts";
import { startEnLigne, tour, type DependancesTour } from "./boucle.ts";
import { baseEssai, insererDemande } from "./essais-en-ligne.ts";
import { lireEtat } from "./etat-liaison.ts";

/** Lama (base d'essai) relié au relais de référence en mémoire, salon `eclat` actif ; même horloge des deux côtés (mardi 20/10/2026, 08:00 à Douala). */
async function scene() {
  const db = baseEssai();
  const storage = sqliteStorage(db);
  initDB({ STORAGE: storage });
  setMasterKey(new Uint8Array(32).fill(7));
  const horloge = { t: MAINTENANT };
  const r = await relaisEssai({ etat: "actif", maintenant: () => horloge.t });
  await setSetting("institut.nom", "Institut Éclat", null, 0);
  await setSetting("en_ligne.active", true, null, 0);
  await setSetting("en_ligne.adresse", "https://relais.exemple", null, 0);
  await setSetting("en_ligne.salon", "eclat", null, 0);
  await setSetting("en_ligne.cle", r.cles.eclat, null, 0);
  const appels: string[] = [];
  const panne = { si: (_url: string, _init: RequestInit) => false };
  const signaux: string[] = [];
  const deps: DependancesTour = {
    storage, maintenant: () => horloge.t, enLigne: () => true, signaler: (s) => signaux.push(s),
    fetch: async (url, init) => {
      appels.push(`${init.method} ${new URL(url).pathname.replace("/lama/v1", "")}`);
      if (panne.si(url, init)) throw new Error("réseau coupé");
      return r.app.fetch(new Request(url, init));
    },
  };
  const deposer = async (corps: Record<string, unknown>) => {
    const res = await r.app.request("/api/eclat/demandes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      type: "creneau", prestation: "s1", praticienne: "p1", date: "2026-10-21", heure: "10:00", souhait: null,
      cliente: { nom: "Mireille Ngo", telephone: "+237699000111", langue: "fr" }, note: "", accord: true, ...corps,
    }) });
    return (await res.json()) as { jeton: string };
  };
  const etat = () => storage.transaction!((x) => lireEtat(x));
  return { db, r, horloge, appels, panne, signaux, deps, deposer, etat, depot: new Depot(r.base, "eclat") };
}

const demandeDe = (db: ReturnType<typeof baseEssai>) => db.prepare("SELECT * FROM demandes_en_ligne ORDER BY id").all() as Record<string, unknown>[];

test("liaison non réglée : aucun appel au relais", async () => {
  const s = await scene();
  await setSetting("en_ligne.salon", "", null, 0);
  assert.deepEqual(await tour(s.deps), { statut: "non_reglee", nouvelles: 0 });
  assert.deepEqual(s.appels, []);
});

test("premier tour : état, offre et plages publiées, relevé ; le tour suivant ne republie rien", async () => {
  const s = await scene();
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 0 });
  assert.deepEqual(s.appels, ["GET /etat", "PUT /offre", "PUT /disponibilites", "GET /demandes"]);
  assert.equal(await s.depot.versionDocument("offre"), MAINTENANT);
  assert.equal(await s.depot.versionDocument("disponibilites"), MAINTENANT);
  assert.deepEqual([s.etat().dernier_succes_le, s.etat().derniere_erreur], [MAINTENANT, null]);
  s.appels.length = 0;
  await tour(s.deps);
  assert.deepEqual(s.appels, ["GET /etat", "GET /demandes"]);
});

test("demande déposée : relevée, enregistrée, accusée, signalée ; relevée une seconde fois, jamais en double", async () => {
  const s = await scene();
  await tour(s.deps);
  await s.deposer({});
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 1 });
  assert.deepEqual(s.signaux, ["demandes_en_ligne"]);
  const [d] = demandeDe(s.db);
  assert.deepEqual([d.etat, d.staff_id, d.cliente_nom], ["a_confirmer", 1, "Mireille Ngo"]);
  assert.ok(typeof d.accusee_le === "number");
  assert.equal(await s.depot.enAttente(), 0);
  assert.equal((await s.depot.pourEssai(String(d.contrat_id)))?.cliente, null, "données de la cliente effacées sur le relais");
  // L'agenda a changé (demande à confirmer) : le tour suivant republie les plages.
  s.appels.length = 0;
  await tour(s.deps);
  assert.ok(s.appels.includes("PUT /disponibilites"));
  // Le relais la renvoie (accusé perdu de son côté) et lama a perdu son curseur : enregistrée une seule fois, accusée à nouveau.
  await s.r.base.executer("UPDATE demandes SET accusee_le = NULL, cliente = ?, note = '' WHERE salon = 'eclat'", [JSON.stringify({ nom: "Mireille Ngo", telephone: "+237699000111", langue: "fr" })]);
  s.db.prepare("UPDATE en_ligne_etat SET curseur = NULL").run();
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 0 });
  assert.equal(demandeDe(s.db).length, 1);
  assert.equal(await s.depot.enAttente(), 0);
});

test("plantage entre l'enregistrement et l'accusé : la demande est accusée au tour suivant", async () => {
  const s = await scene();
  await tour(s.deps);
  await s.deposer({});
  s.panne.si = (url, init) => init.method === "POST" && url.endsWith("/accuse");
  assert.equal((await tour(s.deps)).statut, "erreur");
  assert.equal(demandeDe(s.db)[0].accusee_le, null);
  assert.equal(decode("fr", s.etat().derniere_erreur!), "Relais injoignable\u00a0: réseau coupé");
  assert.equal(await s.depot.enAttente(), 1);
  s.panne.si = () => false;
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.ok(typeof demandeDe(s.db)[0].accusee_le === "number");
  assert.equal(await s.depot.enAttente(), 0);
  assert.equal(demandeDe(s.db).length, 1);
});

test("coupure d'internet : aucun appel, erreur notée ; clé refusée : erreur nommée", async () => {
  const s = await scene();
  assert.deepEqual(await tour({ ...s.deps, enLigne: () => false }), { statut: "hors_ligne", nouvelles: 0 });
  assert.deepEqual(s.appels, []);
  assert.equal(s.etat().derniere_erreur, "@en_ligne.pas_internet");
  await setSetting("en_ligne.cle", "0".repeat(64), null, 0);
  assert.equal((await tour(s.deps)).statut, "erreur");
  assert.equal(s.etat().derniere_erreur, "@en_ligne.refus_signature");
  assert.match(decode("fr", s.etat().derniere_erreur!), /clé partagée/);
});

test("version plus récente sur le relais (relais restauré) ou relais vidé : lama republie et dépasse sa version", async () => {
  const s = await scene();
  const ancienne = MAINTENANT + 10_000_000;
  await s.depot.ecrireDocument("offre", ancienne, offreEssai(ancienne), MAINTENANT);
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.equal(await s.depot.versionDocument("offre"), ancienne + 1);
  await s.r.base.executer("DELETE FROM documents WHERE salon = 'eclat'");
  s.appels.length = 0;
  await tour(s.deps);
  assert.deepEqual(s.appels.filter((a) => a.startsWith("PUT")), ["PUT /offre", "PUT /disponibilites"], "relais vidé : tout est republié");
});

test("fraîcheur : les plages sont republiées au moins toutes les 15 minutes, l'offre seulement si elle change", async () => {
  const s = await scene();
  await tour(s.deps);
  s.horloge.t += 14 * 60_000;
  s.appels.length = 0;
  await tour(s.deps);
  assert.equal(s.appels.filter((a) => a.startsWith("PUT")).length, 0);
  s.horloge.t += 60_000;
  s.appels.length = 0;
  await tour(s.deps);
  assert.deepEqual(s.appels.filter((a) => a.startsWith("PUT")), ["PUT /disponibilites"]);
});

test("relais injoignable puis revenu : la décision part une seule fois, aucun message ajouté par les essais", async () => {
  const s = await scene();
  await tour(s.deps);
  await s.deposer({});
  await tour(s.deps);
  const [d] = demandeDe(s.db);
  s.db.prepare("UPDATE demandes_en_ligne SET etat = 'refusee', decision = ?, decidee_le = ? WHERE id = ?")
    .run(JSON.stringify({ decision: "refusee", horaire: null, message: { fr: "Complet ce jour-là.", en: "Fully booked that day." } }), MAINTENANT, d.id as number);
  const messages = () => (s.db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n;
  const avant = messages();
  s.panne.si = () => true;
  assert.equal((await tour(s.deps)).statut, "erreur");
  assert.equal((await tour(s.deps)).statut, "erreur");
  assert.equal(demandeDe(s.db)[0].decision_envoyee_le, null);
  s.panne.si = () => false;
  s.appels.length = 0;
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.equal(s.appels.filter((a) => a.endsWith("/decision")).length, 1);
  assert.ok(typeof demandeDe(s.db)[0].decision_envoyee_le === "number");
  assert.equal((await s.depot.pourEssai(String(d.contrat_id)))?.decision?.decision, "refusee");
  s.appels.length = 0;
  await tour(s.deps);
  assert.equal(s.appels.filter((a) => a.endsWith("/decision")).length, 0, "déjà envoyée");
  assert.equal(messages(), avant, "la boucle n'écrit aucun message");
});

test("décision d'une demande retirée du relais (404) : notée envoyée, le tour reste réussi", async () => {
  const s = await scene();
  insererDemande(s.db, { contrat_id: "d_retiree", etat: "refusee", decision: JSON.stringify({ decision: "refusee", horaire: null, message: null }), decidee_le: 1 });
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.ok(typeof (s.db.prepare("SELECT decision_envoyee_le FROM demandes_en_ligne WHERE contrat_id = 'd_retiree'").get() as { decision_envoyee_le: number | null }).decision_envoyee_le === "number");
});

test("interrupteur coupé : offre vide publiée une fois, plus de plages ; la page du relais est fermée", async () => {
  const s = await scene();
  await tour(s.deps);
  await setSetting("en_ligne.active", false, null, 0);
  s.appels.length = 0;
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.deepEqual(s.appels.filter((a) => a.startsWith("PUT")), ["PUT /offre"]);
  const vitrine = await (await s.r.app.request("/api/eclat/vitrine")).json() as { etat: string };
  assert.equal(vitrine.etat, "ferme");
  s.appels.length = 0;
  await tour(s.deps);
  assert.deepEqual(s.appels, ["GET /etat", "GET /demandes"], "rien à republier, le relevé continue");
});

test("un changement d'agenda réveille la boucle en quelques secondes, plusieurs changements regroupés en un tour", async (t) => {
  const s = await scene();
  const etats = () => s.appels.filter((a) => a === "GET /etat").length;
  const stop = startEnLigne({ ...s.deps, intervalMs: 3_600_000, regroupementMs: 20 });
  t.after(stop);
  for (let i = 0; i < 100 && etats() < 1; i++) await sleep(10);
  await sleep(30);
  assert.equal(etats(), 1, "premier tour au démarrage");
  publish({ resource: "appointments" });
  publish({ resource: "blocked_slots" });
  publish({ resource: "appointments" });
  for (let i = 0; i < 100 && etats() < 2; i++) await sleep(10);
  await sleep(60);
  assert.equal(etats(), 2, "un seul tour pour trois changements");
  publish({ resource: "outbox" });
  await sleep(60);
  assert.equal(etats(), 2, "un envoi de message ne touche pas l'agenda");
});

/** Enveloppe du `fetch` d'une scène : réponses imposées pour certains appels, le reste passe au relais de référence. */
function imposer(s: Awaited<ReturnType<typeof scene>>, regle: (methode: string, chemin: string) => Response | null) {
  const reel = s.deps.fetch!;
  s.deps.fetch = async (url, init) => {
    const imposee = regle(String(init.method), new URL(url).pathname.replace("/lama/v1", ""));
    if (!imposee) return reel(url, init);
    s.appels.push(`${init.method} ${new URL(url).pathname.replace("/lama/v1", "")}`);
    return imposee;
  };
}
const refus = (statut: number) => new Response(JSON.stringify({ erreur: { message: "refusé" } }), { status: statut, headers: { "content-type": "application/json" } });
const decisionRefusee = JSON.stringify({ decision: "refusee", horaire: null, message: null });

test("décision refusée en 413 devant une décision valide : la seconde part, la première est close, l'erreur est notée", async () => {
  const s = await scene();
  insererDemande(s.db, { contrat_id: "d_grosse", etat: "refusee", decision: decisionRefusee, decidee_le: 1 });
  insererDemande(s.db, { contrat_id: "d_valide", etat: "refusee", decision: decisionRefusee, decidee_le: 2 });
  imposer(s, (m, c) => (m === "POST" && c === "/demandes/d_grosse/decision" ? refus(413) : null));
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.deepEqual(s.appels.filter((a) => a.endsWith("/decision")), ["POST /demandes/d_grosse/decision", "POST /demandes/d_valide/decision"]);
  assert.deepEqual(demandeDe(s.db).map((d) => typeof d.decision_envoyee_le), ["number", "number"]);
  assert.equal(s.etat().derniere_erreur, "@en_ligne.trop_gros");
});

test("accusé en retard refusé en 500 : l'offre, les plages, le relevé et les décisions du tour se font quand même", async () => {
  const s = await scene();
  insererDemande(s.db, { contrat_id: "d_retard", accusee_le: null });
  insererDemande(s.db, { contrat_id: "d_decidee", etat: "refusee", decision: decisionRefusee, decidee_le: 1 });
  imposer(s, (m, c) => (m === "POST" && c === "/demandes/d_retard/accuse" ? refus(500) : null));
  assert.equal((await tour(s.deps)).statut, "erreur");
  assert.deepEqual(s.appels, ["GET /etat", "POST /demandes/d_retard/accuse", "PUT /offre", "PUT /disponibilites", "GET /demandes", "POST /demandes/d_decidee/decision"]);
  assert.equal(demandeDe(s.db)[0].accusee_le, null);
  assert.match(s.etat().derniere_erreur!, /^@en_ligne.statut /);
});

test("décision illisible : passée sans bloquer la suivante", async (t) => {
  const s = await scene();
  t.mock.method(console, "error", () => undefined);
  insererDemande(s.db, { contrat_id: "d_abimee", etat: "refusee", decision: "{pas du json", decidee_le: 1 });
  insererDemande(s.db, { contrat_id: "d_saine", etat: "refusee", decision: decisionRefusee, decidee_le: 2 });
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.deepEqual(demandeDe(s.db).map((d) => typeof d.decision_envoyee_le), ["object", "number"]);
});

test("demandes illisibles (champ manquant, téléphone mal formé) : ni enregistrées ni accusées, le curseur passe outre", async (t) => {
  const s = await scene();
  t.mock.method(console, "error", () => undefined);
  const valide = { type: "creneau", recue_le: MAINTENANT, prestation: "s1", praticienne: "p1", date: "2026-10-21", heure: "10:00", souhait: null, note: "" };
  imposer(s, (m, c) => (m === "GET" && c === "/demandes"
    ? new Response(JSON.stringify({ demandes: [
      { id: "d_sans_cliente", curseur: "c1", ...valide },
      { id: "d_mauvais_tel", curseur: "c2", ...valide, cliente: { nom: "Mireille Ngo", telephone: "699000111", langue: "fr" } },
    ], curseur: "c2" }), { status: 200, headers: { "content-type": "application/json" } })
    : null));
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 0 });
  assert.equal(demandeDe(s.db).length, 0);
  assert.equal(s.appels.filter((a) => a.endsWith("/accuse")).length, 0);
  assert.equal(s.etat().curseur, "c2");
});

test("page pleine sans curseur qui avance : le relevé du tour s'arrête après une page", async (t) => {
  const s = await scene();
  t.mock.method(console, "error", () => undefined);
  imposer(s, (m, c) => (m === "GET" && c === "/demandes"
    ? new Response(JSON.stringify({ demandes: Array.from({ length: 50 }, (_, i) => ({ id: `d_${i}` })), curseur: "" }), { status: 200, headers: { "content-type": "application/json" } })
    : null));
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.equal(s.appels.filter((a) => a === "GET /demandes").length, 1);
});

/** Remplace le relais de la scène par un relais de référence neuf (base vide) ; rend de quoi y déposer une demande et les adresses appelées. */
async function nouveauRelais(s: Awaited<ReturnType<typeof scene>>) {
  const r = await relaisEssai({ etat: "actif", maintenant: () => s.horloge.t });
  await setSetting("en_ligne.cle", r.cles.eclat, null, 0);
  const adresses: string[] = [];
  s.deps.fetch = async (url, init) => {
    adresses.push(`${init.method} ${url}`);
    return r.app.fetch(new Request(url, init));
  };
  const deposer = async (heure: string) => {
    const res = await r.app.request("/api/eclat/demandes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      type: "creneau", prestation: "s1", praticienne: "p1", date: "2026-10-21", heure, souhait: null,
      cliente: { nom: "Mireille Ngo", telephone: "+237699000111", langue: "fr" }, note: "", accord: true,
    }) });
    assert.equal(res.status, 201);
  };
  return { r, adresses, deposer };
}

test("changement de relais : le curseur de l'ancien relais est oublié, la demande du nouveau est relevée", async () => {
  const s = await scene();
  await tour(s.deps);
  await s.deposer({});
  await tour(s.deps);
  assert.equal(demandeDe(s.db).length, 1);
  assert.notEqual(s.etat().curseur, null);
  const n = await nouveauRelais(s);
  await setSetting("en_ligne.adresse", "https://autre-relais.exemple", null, 0);
  assert.equal((await tour(s.deps)).statut, "ok");
  assert.ok(n.adresses.some((a) => a === "GET https://autre-relais.exemple/lama/v1/demandes?limite=50"), "relevé sans curseur sur le nouveau relais");
  await n.deposer("14:00");
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 1 });
  assert.equal(demandeDe(s.db).length, 2);
  // Changement de salon : le curseur repart aussi de zéro.
  assert.notEqual(s.etat().curseur, null);
  await setSetting("en_ligne.salon", "autre", null, 0);
  await tour(s.deps);
  assert.equal(s.etat().curseur, null);
});

test("filet : relais remplacé à la même adresse, demandes annoncées mais relevé vide avec le curseur : relu une fois sans curseur", async () => {
  const s = await scene();
  await tour(s.deps);
  await s.deposer({});
  await tour(s.deps);
  const n = await nouveauRelais(s);
  await tour(s.deps);
  await n.deposer("14:00");
  n.adresses.length = 0;
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 1 });
  assert.deepEqual(n.adresses.filter((a) => a.includes("/demandes?")).map((a) => a.replace("GET https://relais.exemple/lama/v1", "")), ["/demandes?limite=50&apres=000000000001", "/demandes?limite=50"]);
  assert.equal(demandeDe(s.db).length, 2);
  n.adresses.length = 0;
  await tour(s.deps);
  assert.equal(n.adresses.filter((a) => a.includes("/demandes?")).length, 1, "rien en attente : pas de seconde lecture");
});

test("nom de l'institut vide : l'offre n'est pas publiée, mais la demande est quand même relevée et une décision part", async () => {
  const s = await scene();
  await tour(s.deps);
  await s.deposer({});
  insererDemande(s.db, { contrat_id: "d_decidee", etat: "refusee", decision: decisionRefusee, decidee_le: 1 });
  s.db.prepare("UPDATE settings SET value = '\"\"' WHERE key = 'institut.nom'").run();
  s.appels.length = 0;
  assert.deepEqual(await tour(s.deps), { statut: "erreur", nouvelles: 1 });
  assert.ok(s.appels.includes("GET /demandes"));
  assert.ok(s.appels.includes("POST /demandes/d_decidee/decision"));
  assert.ok(!s.appels.includes("PUT /offre"));
  assert.equal(s.etat().derniere_erreur, "@en_ligne.nom_manquant");
  assert.equal(demandeDe(s.db).filter((d) => d.contrat_id !== "d_decidee").length, 1);
});

test("publication des plages refusée en 413 : le relevé et les décisions se font quand même", async () => {
  const s = await scene();
  insererDemande(s.db, { contrat_id: "d_decidee", etat: "refusee", decision: decisionRefusee, decidee_le: 1 });
  imposer(s, (m, c) => (m === "PUT" && c === "/disponibilites" ? refus(413) : null));
  assert.equal((await tour(s.deps)).statut, "erreur");
  assert.deepEqual(s.appels, ["GET /etat", "PUT /offre", "PUT /disponibilites", "GET /demandes", "POST /demandes/d_decidee/decision"]);
  assert.equal(s.etat().derniere_erreur, "@en_ligne.trop_gros");
});

test("une demande qui fait échouer l'enregistrement est passée : les autres de la page sont enregistrées et accusées, le curseur avance", async (t) => {
  const s = await scene();
  const journal = t.mock.method(console, "error", () => undefined);
  await tour(s.deps);
  await s.deposer({ heure: "10:00" });
  await s.deposer({ heure: "11:00", cliente: { nom: "Awa Fautive", telephone: "+237699000222", langue: "fr" } });
  await s.deposer({ heure: "12:00", cliente: { nom: "Grace Mbida", telephone: "+237699000333", langue: "fr" } });
  s.db.exec("CREATE TRIGGER essai_panne BEFORE INSERT ON demandes_en_ligne WHEN NEW.cliente_nom = 'Awa Fautive' BEGIN SELECT RAISE(ABORT, 'panne d''essai'); END");
  assert.deepEqual(await tour(s.deps), { statut: "ok", nouvelles: 2 });
  assert.deepEqual(demandeDe(s.db).map((d) => d.cliente_nom), ["Mireille Ngo", "Grace Mbida"]);
  assert.equal(s.appels.filter((a) => a.endsWith("/accuse")).length, 2, "la demande fautive n'est pas accusée");
  assert.equal(s.etat().curseur, "000000000003");
  assert.ok(journal.mock.calls.some((c) => String(c.arguments[0]).startsWith("Réservation en ligne, demande non enregistrée")));
});
