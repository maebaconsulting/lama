import assert from "node:assert/strict";
import { test } from "node:test";
import { DemandeEntrante } from "./noyau/contrat.ts";
import { signer } from "./noyau/signature.ts";
import { dispoEssai, MAINTENANT, offreEssai } from "./essais/donnees.ts";
import { appelSigne, relaisEssai } from "./essais/relais.ts";
import { CONFIG_ESSAI } from "./essais/relais.ts";
import { deposer, duSalon, services } from "./services.ts";
import { Depot, VERIFICATION_MS } from "./stockage/depot.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Relais = Awaited<ReturnType<typeof relaisEssai>>;

const PLAGES = { p1: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] } };
const creneau = (o: Record<string, unknown> = {}) => ({
  type: "creneau", prestation: "s60", praticienne: "p1", date: "2026-10-21", heure: "09:00", souhait: null,
  cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" }, note: "Première visite", ...o,
});
/** Appel signé du salon `eclat` avec sa clé. */
const appel = (r: Relais, methode: string, chemin: string, corps?: unknown) => appelSigne(r.app, r.cles.eclat, "eclat", methode, chemin, corps);
async function publier(r: Relais) {
  assert.equal((await appel(r, "PUT", "/lama/v1/offre", offreEssai(1))).statut, 200);
  assert.equal((await appel(r, "PUT", "/lama/v1/disponibilites", dispoEssai(PLAGES))).statut, 200);
}

test("état : appel signé, rien de publié, appel noté pour la gestion", async () => {
  const r = await relaisEssai();
  const e = await appel(r, "GET", "/lama/v1/etat");
  assert.equal(e.statut, 200);
  assert.deepEqual(e.json, { contrat: "v1", application: { nom: "lama-relais", version: "1.0.0" }, version_offre: null, version_disponibilites: null, demandes_en_attente: 0, mode_essai: true });
  assert.equal((await r.salons.lire("eclat"))?.dernier_appel_le, MAINTENANT);
});

test("signature : clé fausse, clé d'un autre salon, salon inconnu, horodatage décalé, en-têtes absents (401)", async () => {
  const r = await relaisEssai();
  const fausse = await appelSigne(r.app, "d".repeat(64), "eclat", "GET", "/lama/v1/etat");
  assert.deepEqual([fausse.statut, fausse.json.erreur.code], [401, "signature"]);
  assert.equal((await appelSigne(r.app, r.cles.voisin, "eclat", "GET", "/lama/v1/etat")).statut, 401);
  const inconnu = await appelSigne(r.app, r.cles.eclat, "inconnu", "GET", "/lama/v1/etat");
  assert.deepEqual([inconnu.statut, inconnu.json.erreur.code], [401, "signature"]);
  const h = await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/etat", undefined, MAINTENANT - 300_001);
  assert.deepEqual([h.statut, h.json.erreur.code], [401, "horodatage"]);
  assert.equal((await r.app.request("/lama/v1/etat")).status, 401);
  assert.equal((await r.salons.lire("eclat"))?.dernier_appel_le, null, "aucun appel refusé n'est noté");
});

test("salon suspendu : 403 suspendu si la signature est bonne, 401 sinon", async () => {
  const r = await relaisEssai({ etat: "suspendu" });
  const ok = await appel(r, "GET", "/lama/v1/etat");
  assert.deepEqual([ok.statut, ok.json.erreur.code], [403, "suspendu"]);
  assert.equal((await appelSigne(r.app, "d".repeat(64), "eclat", "GET", "/lama/v1/etat")).statut, 401);
});

test("offre : publiée, même version acceptée, version plus ancienne refusée (409), version lue par l'état", async () => {
  const r = await relaisEssai();
  assert.deepEqual(await appel(r, "PUT", "/lama/v1/offre", offreEssai(3)), { statut: 200, json: { version: 3 } });
  assert.equal((await appel(r, "PUT", "/lama/v1/offre", offreEssai(3))).statut, 200);
  const ancienne = await appel(r, "PUT", "/lama/v1/offre", offreEssai(2));
  assert.deepEqual([ancienne.statut, ancienne.json.erreur.code], [409, "version_ancienne"]);
  assert.equal((await appel(r, "GET", "/lama/v1/etat")).json.version_offre, 3);
});

test("offre invalide refusée (422) avec le chemin de l'écart ; corps de plus de 1 Mo refusé (413)", async () => {
  const r = await relaisEssai();
  const inv = await appel(r, "PUT", "/lama/v1/offre", { version: 4 });
  assert.deepEqual([inv.statut, inv.json.erreur.code], [422, "donnees_invalides"]);
  assert.match(inv.json.erreur.message, /institut/);
  const gros = await appel(r, "PUT", "/lama/v1/offre", { ...offreEssai(5), bourrage: "x".repeat(1_100_000) });
  assert.deepEqual([gros.statut, gros.json.erreur.code], [413, "corps_trop_gros"]);
});

test("plages : publiées, version plus ancienne refusée", async () => {
  const r = await relaisEssai();
  assert.deepEqual(await appel(r, "PUT", "/lama/v1/disponibilites", dispoEssai(PLAGES, { version: 7 })), { statut: 200, json: { version: 7 } });
  assert.equal((await appel(r, "PUT", "/lama/v1/disponibilites", dispoEssai(PLAGES, { version: 6 }))).statut, 409);
  assert.equal((await appel(r, "GET", "/lama/v1/etat")).json.version_disponibilites, 7);
});

test("relevé : ordre, limite, reprise après un curseur, curseur rendu quand il n'y a plus rien", async () => {
  const r = await relaisEssai();
  await publier(r);
  for (const heure of ["09:00", "10:00", "11:00"]) {
    const d = await appel(r, "POST", "/lama/v1/essai/demande", creneau({ heure }));
    assert.equal(d.statut, 201);
    assert.match(d.json.id, /^d_[A-Za-z0-9_-]{20,}$/);
    assert.match(d.json.jeton, /^[A-Za-z0-9_-]{30,}$/);
  }
  const toutes = await appel(r, "GET", "/lama/v1/demandes");
  assert.deepEqual(toutes.json.demandes.map((d: Json) => d.heure), ["09:00", "10:00", "11:00"]);
  assert.equal(toutes.json.curseur, toutes.json.demandes[2].curseur);
  assert.deepEqual(toutes.json.demandes[0].cliente, { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" });
  assert.equal(toutes.json.demandes[0].acompte, null);
  const [a, b, c] = toutes.json.demandes.map((d: Json) => d.curseur);
  const suite = await appel(r, "GET", `/lama/v1/demandes?apres=${a}&limite=1`);
  assert.deepEqual([suite.json.demandes.map((d: Json) => d.curseur), suite.json.curseur], [[b], b]);
  assert.deepEqual((await appel(r, "GET", `/lama/v1/demandes?apres=${c}`)).json, { demandes: [], curseur: c });
  assert.equal((await appel(r, "GET", "/lama/v1/demandes?limite=500")).statut, 422);
  assert.equal((await appel(r, "GET", "/lama/v1/etat")).json.demandes_en_attente, 3);
});

test("accusé : la demande n'est plus relevée, ses données sont effacées ; idempotent ; demande inconnue (404)", async () => {
  const r = await relaisEssai();
  await publier(r);
  const { id } = (await appel(r, "POST", "/lama/v1/essai/demande", creneau())).json;
  assert.deepEqual(await appel(r, "POST", `/lama/v1/demandes/${id}/accuse`), { statut: 200, json: { id } });
  assert.deepEqual((await appel(r, "GET", "/lama/v1/demandes")).json.demandes, []);
  const essai = await appel(r, "GET", `/lama/v1/essai/demande/${id}`);
  assert.deepEqual([essai.json.cliente, essai.json.note, essai.json.accusee_le], [null, null, MAINTENANT]);
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${id}/accuse`)).statut, 200);
  const inconnue = await appel(r, "POST", "/lama/v1/demandes/d_inconnue/accuse");
  assert.deepEqual([inconnue.statut, inconnue.json.erreur.code], [404, "introuvable"]);
});

test("décision : rendue, répétée sans effet, remplacée, inconnue (404), invalide (422)", async () => {
  const r = await relaisEssai();
  await publier(r);
  const { id } = (await appel(r, "POST", "/lama/v1/essai/demande", creneau())).json;
  assert.deepEqual(await appel(r, "POST", `/lama/v1/demandes/${id}/decision`, { decision: "acceptee" }), { statut: 200, json: { id, decision: "acceptee" } });
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${id}/decision`, { decision: "acceptee" })).statut, 200);
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${id}/decision`, { decision: "refusee", message: { fr: "Complet.", en: "Full." } })).statut, 200);
  assert.equal((await appel(r, "GET", `/lama/v1/essai/demande/${id}`)).json.decision.decision, "refusee");
  assert.equal((await appel(r, "POST", "/lama/v1/demandes/d_inconnue/decision", { decision: "refusee" })).statut, 404);
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${id}/decision`, { decision: "autre_horaire" })).statut, 422);
});

test("route d'essai : créneau hors découpage (409 indisponible), réservation fermée (409 ferme)", async () => {
  const r = await relaisEssai();
  const f = await appel(r, "POST", "/lama/v1/essai/demande", creneau());
  assert.deepEqual([f.statut, f.json.erreur.code], [409, "ferme"]);
  await publier(r);
  const d = await appel(r, "POST", "/lama/v1/essai/demande", creneau({ heure: "09:10" }));
  assert.deepEqual([d.statut, d.json.erreur.code], [409, "indisponible"]);
});

test("salon actif (pas en essai) : les routes d'essai n'existent pas (404 en JSON)", async () => {
  const r = await relaisEssai({ etat: "actif" });
  const d = await appel(r, "POST", "/lama/v1/essai/demande", creneau());
  assert.deepEqual([d.statut, d.json.erreur.code], [404, "introuvable"]);
});

test("deux salons : chacun ne voit, ne relève et n'accuse que ses propres données", async () => {
  const r = await relaisEssai();
  await publier(r);
  const { id } = (await appel(r, "POST", "/lama/v1/essai/demande", creneau())).json;
  const voisin = (methode: string, chemin: string, corps?: unknown) => appelSigne(r.app, r.cles.voisin, "voisin", methode, chemin, corps);
  const etat = await voisin("GET", "/lama/v1/etat");
  assert.deepEqual([etat.json.version_offre, etat.json.version_disponibilites, etat.json.demandes_en_attente], [null, null, 0]);
  assert.deepEqual((await voisin("GET", "/lama/v1/demandes")).json.demandes, []);
  assert.equal((await voisin("POST", `/lama/v1/demandes/${id}/accuse`)).statut, 404);
  assert.equal((await voisin("POST", `/lama/v1/demandes/${id}/decision`, { decision: "refusee" })).statut, 404);
  assert.equal((await voisin("PUT", "/lama/v1/offre", offreEssai(1))).statut, 200, "versions propres à chaque salon");
  assert.equal((await appel(r, "GET", "/lama/v1/demandes")).json.demandes.length, 1);
});

test("deux salons : le voisin en essai ne lit pas la demande d'eclat et ne change pas sa décision", async () => {
  const r = await relaisEssai();
  await publier(r);
  const { id } = (await appel(r, "POST", "/lama/v1/essai/demande", creneau())).json;
  await appel(r, "POST", `/lama/v1/demandes/${id}/decision`, { decision: "acceptee" });
  await r.salons.modifier("voisin", { etat: "essai" });
  const voisin = (methode: string, chemin: string, corps?: unknown) => appelSigne(r.app, r.cles.voisin, "voisin", methode, chemin, corps);
  assert.equal((await voisin("GET", `/lama/v1/essai/demande/${id}`)).statut, 404);
  assert.equal((await voisin("POST", `/lama/v1/demandes/${id}/decision`, { decision: "refusee" })).statut, 404);
  assert.equal((await appel(r, "GET", `/lama/v1/essai/demande/${id}`)).json.decision.decision, "acceptee");
});

test("route inconnue, même bien signée : 404 introuvable en JSON", async () => {
  const r = await relaisEssai();
  const x = await appel(r, "GET", "/lama/v1/inconnue");
  assert.deepEqual([x.statut, x.json.erreur.code], [404, "introuvable"]);
});

test("salon inconnu et mauvaise clé : réponses identiques, horodatage frais ou périmé", async () => {
  const r = await relaisEssai();
  for (const h of [MAINTENANT, MAINTENANT - 400_000]) {
    const inconnu = await appelSigne(r.app, r.cles.eclat, "inconnu", "GET", "/lama/v1/etat", undefined, h);
    const fausse = await appelSigne(r.app, "d".repeat(64), "eclat", "GET", "/lama/v1/etat", undefined, h);
    assert.deepEqual(inconnu, fausse);
    assert.equal(inconnu.statut, 401);
  }
});

test("rejeu : la même requête signée utilisée une seconde fois est refusée (401 signature)", async () => {
  const r = await relaisEssai();
  const requete = { method: "GET", headers: { "x-lama-institut": "eclat", "x-lama-horodatage": String(MAINTENANT), "x-lama-signature": await signer(r.cles.eclat, String(MAINTENANT), "GET", "/lama/v1/etat", "") } };
  assert.equal((await r.app.request("/lama/v1/etat", requete)).status, 200);
  const rejeu = await r.app.request("/lama/v1/etat", requete);
  assert.equal(rejeu.status, 401);
  assert.equal(((await rejeu.json()) as Json).erreur.code, "signature");
  assert.equal((await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/etat", undefined, MAINTENANT)).statut, 401, "même horodatage, même signature : c'est la même requête");
  const autre = await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/etat", undefined, MAINTENANT + 100_000);
  assert.equal(autre.statut, 200, "nouvel horodatage : nouvelle signature");
});

test("corps trop gros : refusé (413) sans content-length comme avec", async () => {
  const r = await relaisEssai();
  const gros = JSON.stringify({ ...offreEssai(5), bourrage: "x".repeat(1_100_000) });
  const h = String(MAINTENANT);
  const entetes = { "content-type": "application/json", "x-lama-institut": "eclat", "x-lama-horodatage": h, "x-lama-signature": await signer(r.cles.eclat, h, "PUT", "/lama/v1/offre", gros) };
  const flux = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(gros)); c.close(); } });
  // @ts-expect-error duplex est requis par Node pour un corps en flux
  const sans = await r.app.request("/lama/v1/offre", { method: "PUT", headers: entetes, body: flux, duplex: "half" });
  assert.equal(sans.status, 413);
  assert.equal(((await sans.json()) as Json).erreur.code, "corps_trop_gros");
  const avec = await r.app.request("/lama/v1/offre", { method: "PUT", headers: { ...entetes, "content-length": String(gros.length) }, body: gros });
  assert.equal(avec.status, 413);
});

test("demande insérée mais pas contrôlée : invisible pour lama, retient les suivantes ; périmée, elle est purgée", async () => {
  let horloge = MAINTENANT;
  const r = await relaisEssai({ maintenant: () => horloge });
  await publier(r);
  const depot = new Depot(r.base, "eclat");
  const brute = (id: string, heure: number, recue_le: number) => ({
    id, jeton: `j_${id}`, type: "creneau" as const, prestation: "s60", prestation_nom: { fr: "Soin visage", en: "Facial" }, praticienne: "p1",
    date: "2026-10-21", debut: heure, fin: heure + 60, souhait: null, cliente: { nom: "A", telephone: "+237699123456", langue: "fr" as const },
    note: "", telephone_empreinte: "e", recue_le,
  });
  await depot.ajouterDemande(brute("d_a", 540, MAINTENANT));
  await depot.ajouterDemande(brute("d_b", 660, MAINTENANT));
  await depot.confirmer("d_b");
  assert.deepEqual((await appel(r, "GET", "/lama/v1/demandes")).json, { demandes: [], curseur: null }, "d_b est retenue derrière d_a");
  assert.equal((await appel(r, "GET", "/lama/v1/etat")).json.demandes_en_attente, 1);
  assert.equal((await appel(r, "POST", "/lama/v1/demandes/d_a/accuse")).statut, 404);
  // Plus d'une minute après : d_a, jamais contrôlée, est abandonnée et ne retient plus d_b.
  horloge = MAINTENANT + VERIFICATION_MS + 1;
  const suite = await appelSigne(r.app, r.cles.eclat, "eclat", "GET", "/lama/v1/demandes", undefined, horloge);
  assert.deepEqual(suite.json.demandes.map((d: Json) => d.id), ["d_b"]);
  assert.equal(await depot.suivi("j_d_a"), null);
});

test("deux appels signés identiques, l'un après l'autre par l'aide d'essai : les deux réussissent", async () => {
  const r = await relaisEssai();
  const a = await appel(r, "GET", "/lama/v1/etat");
  const b = await appel(r, "GET", "/lama/v1/etat");
  assert.deepEqual([a.statut, b.statut], [200, 200]);
});

test("deux envois simultanés sur le même créneau\u00a0: un seul enregistré, l'autre refusé (409 indisponible)", async () => {
  const r = await relaisEssai();
  await publier(r);
  const envoi = () => appel(r, "POST", "/lama/v1/essai/demande", creneau());
  const reponses = await Promise.all([envoi(), envoi()]);
  assert.deepEqual(reponses.map((x) => x.statut).sort(), [201, 409]);
  assert.equal(reponses.find((x) => x.statut === 409)!.json.erreur.code, "indisponible");
  assert.equal((await appel(r, "GET", "/lama/v1/demandes")).json.demandes.length, 1);
  assert.equal((await appel(r, "GET", "/lama/v1/etat")).json.demandes_en_attente, 1);
});

test("deux envois simultanés «\u00a0sans préférence\u00a0» avec une seule praticienne libre\u00a0: un seul enregistré", async () => {
  const r = await relaisEssai();
  await publier(r);
  const envoi = () => appel(r, "POST", "/lama/v1/essai/demande", creneau({ praticienne: null }));
  const reponses = await Promise.all([envoi(), envoi(), envoi()]);
  assert.deepEqual(reponses.map((x) => x.statut).sort(), [201, 409, 409]);
  assert.ok(reponses.filter((x) => x.statut === 409).every((x) => x.json.erreur.code === "indisponible"));
  assert.equal((await appel(r, "GET", "/lama/v1/demandes")).json.demandes.length, 1);
});

test("deux envois simultanés sur deux créneaux qui ne se chevauchent pas\u00a0: les deux sont enregistrés", async () => {
  const r = await relaisEssai();
  await publier(r);
  const reponses = await Promise.all([
    appel(r, "POST", "/lama/v1/essai/demande", creneau({ heure: "09:00" })),
    appel(r, "POST", "/lama/v1/essai/demande", creneau({ heure: "10:00" })),
  ]);
  assert.deepEqual(reponses.map((x) => x.statut), [201, 201]);
});

test("demande purgée entre l'insertion et la confirmation\u00a0: refusée (409 indisponible), jamais un jeton mort", async () => {
  const r = await relaisEssai();
  await publier(r);
  const s = services({ base: r.base, config: CONFIG_ESSAI, maintenant: () => MAINTENANT });
  const du = duSalon(s, (await r.salons.lire("eclat"))!);
  const confirmer = du.depot.confirmer.bind(du.depot);
  du.depot.confirmer = async (id) => {
    await du.depot.purgerNonVerifiees(MAINTENANT + VERIFICATION_MS + 1);
    return confirmer(id);
  };
  const entree = DemandeEntrante.parse(creneau());
  assert.deepEqual(await deposer(s, du, entree), { ok: false, code: "indisponible" });
  assert.equal((await appel(r, "GET", "/lama/v1/demandes")).json.demandes.length, 0);
});

test("décision : l'issue d'un rappel clos est gardée pour la page de suivi ; sans issue (lama plus ancien), suivi inchangé", async () => {
  const r = await relaisEssai();
  await publier(r);
  const rappel = { ...creneau(), type: "rappel", date: null, heure: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" } };
  const a = (await appel(r, "POST", "/lama/v1/essai/demande", rappel)).json;
  const b = (await appel(r, "POST", "/lama/v1/essai/demande", { ...rappel, cliente: { ...rappel.cliente, telephone: "+237655000222" } })).json;
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${a.id}/decision`, { decision: "traitee", issue: "sans_suite" })).statut, 200);
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${b.id}/decision`, { decision: "traitee" })).statut, 200);
  const suivi = async (jeton: string) => (await (await r.app.request("/api/eclat/suivi", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jeton }),
  })).json()) as { etat: string; issue: string | null };
  const sa = await suivi(a.jeton);
  const sb = await suivi(b.jeton);
  assert.deepEqual([sa.etat, sa.issue], ["traitee", "sans_suite"]);
  assert.deepEqual([sb.etat, sb.issue], ["traitee", null]);
  assert.equal((await appel(r, "POST", `/lama/v1/demandes/${a.id}/decision`, { decision: "traitee", issue: "oubliee" })).statut, 422);
});
