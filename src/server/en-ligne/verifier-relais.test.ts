import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { relaisEssai, MAITRE, CONFIG_ESSAI } from "../../../relais/essais/relais.ts";
import { dispoEssai, offreEssai } from "../../../relais/essais/donnees.ts";
import { demarrerRelais } from "../../../relais/node.ts";
import { signer } from "../../../relais/noyau/signature.ts";
import { Depot } from "../../../relais/stockage/depot.ts";
import { Salons } from "../../../relais/stockage/salons.ts";
import { cliBundle } from "../test-support.ts";
import { clientRelais } from "./client-relais.ts";
import { signerAppel } from "./signature.ts";
import { verifierRelais, type Point } from "./verifier-relais.ts";

const ADRESSE = "https://relais.exemple";

/** Relais d'essai à l'heure réelle : salon `eclat` en essai, salon `voisin` actif. */
async function relais() {
  const r = await relaisEssai({ maintenant: Date.now });
  const versApp = async (url: string, init: RequestInit) => r.app.fetch(new Request(url, init));
  return { ...r, versApp, eclat: { adresse: ADRESSE, institut: "eclat", cle: r.cles.eclat } };
}

test("la signature de lama est celle que le relais attend", async () => {
  const cle = "k".repeat(64);
  assert.equal(signerAppel(cle, "1792170000000", "put", "/lama/v1/offre", '{"a":1}'), await signer(cle, "1792170000000", "PUT", "/lama/v1/offre", '{"a":1}'));
  const hex = "0123456789abcdef".repeat(4);
  const corps = JSON.stringify({ nom: "Éclat é" });
  assert.equal(signerAppel(hex, "1792170000001", "POST", "/lama/v1/demandes/d_é?x=é", corps), await signer(hex, "1792170000001", "POST", "/lama/v1/demandes/d_é?x=é", corps));
});

test("le relais de référence est conforme au contrat v1, la vérification se rejoue, et l'autre salon n'est pas touché", async () => {
  const r = await relais();
  const voisin = new Depot(r.base, "voisin");
  await voisin.ecrireDocument("offre", 7, offreEssai(7), Date.now());
  const journal: Point[] = [];
  const v = await verifierRelais({ ...r.eclat, fetch: r.versApp, journal: (p) => journal.push(p) });
  assert.equal(v.ok, true, JSON.stringify(v.points.filter((p) => !p.ok)));
  assert.equal(v.points.length, 28);
  assert.deepEqual(journal, v.points);
  const encore = await verifierRelais({ ...r.eclat, fetch: r.versApp });
  assert.equal(encore.ok, true, JSON.stringify(encore.points.filter((p) => !p.ok)));
  assert.equal(await voisin.versionDocument("offre"), 7, "l'offre de l'autre salon est intacte");
});

test("une application qui ne vérifie pas la signature est déclarée non conforme, au premier écart", async () => {
  const r = await relais();
  // Mandataire complaisant : il re-signe chaque appel avec la bonne clé, la signature fausse passe donc.
  const complaisant = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const h = new Headers(init.headers);
    h.set("x-lama-signature", signerAppel(r.cles.eclat, h.get("x-lama-horodatage") ?? "", init.method ?? "GET", u.pathname + u.search, typeof init.body === "string" ? init.body : ""));
    return r.app.fetch(new Request(url, { ...init, headers: h }));
  };
  const v = await verifierRelais({ ...r.eclat, fetch: complaisant });
  assert.equal(v.ok, false);
  assert.equal(v.points.length, 3);
  assert.deepEqual(v.points[2], { nom: "Signature fausse refusée", ok: false, detail: "401 attendu, 200 reçu" });
});

test("une application qui accepte n'importe quel créneau est non conforme au découpage", async () => {
  const r = await relais();
  const laxiste = async (url: string, init: RequestInit) => {
    const reponse = await r.app.fetch(new Request(url, init));
    if (url.endsWith("/essai/demande") && reponse.status === 409) {
      return new Response(JSON.stringify({ id: "d_faux", jeton: "j_faux" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return reponse;
  };
  const v = await verifierRelais({ ...r.eclat, fetch: laxiste });
  assert.equal(v.ok, false);
  assert.equal(v.points.at(-1)?.nom, "Découpage\u00a0: début sur le pas");
});

test("salon qui n'est pas en mode essai : l'écart dit de le passer en mode essai", async () => {
  const r = await relais();
  const v = await verifierRelais({ adresse: ADRESSE, institut: "voisin", cle: r.cles.voisin, fetch: r.versApp });
  assert.equal(v.ok, false);
  assert.match(v.points.at(-1)?.detail ?? "", /mode essai/);
});

test("salon actif : la vérification s'arrête à l'étape 2 et l'offre, les plages et les demandes sont inchangées", async () => {
  const r = await relais();
  const voisin = new Depot(r.base, "voisin");
  await voisin.ecrireDocument("offre", 7, offreEssai(7), Date.now());
  await voisin.ecrireDocument("disponibilites", 8, dispoEssai({ p1: { "2026-10-21": [["09:00", "12:00"]] } }, { version: 8 }), Date.now());
  await voisin.ajouterDemande({
    id: "d_reelle", jeton: "j_reel", type: "rappel", prestation: "s60", prestation_nom: { fr: "Soin visage", en: "Facial" }, praticienne: null,
    date: null, debut: null, fin: null, souhait: { jours: ["lun"], moments: ["matin"], precision: "" },
    cliente: { nom: "Cliente réelle", telephone: "+237699111111", langue: "fr" }, note: "", telephone_empreinte: "e", recue_le: Date.now(),
  });
  await voisin.confirmer("d_reelle");
  const avant = JSON.stringify([await voisin.lireDocument("offre"), await voisin.lireDocument("disponibilites"), await voisin.nonAccusees(null, 50, Date.now())]);
  const v = await verifierRelais({ adresse: ADRESSE, institut: "voisin", cle: r.cles.voisin, fetch: r.versApp });
  assert.equal(v.ok, false);
  assert.equal(v.points.length, 2);
  assert.equal(v.points[1].nom, "Salon en mode essai");
  assert.equal(v.points[1].detail, "salon pas en mode essai\u00a0: le passer en mode essai dans la gestion du relais");
  const apres = JSON.stringify([await voisin.lireDocument("offre"), await voisin.lireDocument("disponibilites"), await voisin.nonAccusees(null, 50, Date.now())]);
  assert.equal(apres, avant);
  assert.equal(await voisin.enAttente(), 1);
});

test("le client signe chaque appel avec un horodatage neuf : deux appels identiques de suite passent", async () => {
  const r = await relais();
  const vus: string[] = [];
  const espion = clientRelais({
    ...r.eclat, maintenant: () => 1_000,
    fetch: async (url, init) => { vus.push(new Headers(init.headers).get("x-lama-horodatage") ?? ""); return r.versApp(url, init); },
  });
  // Horloge figée dans le passé : refus d'horodatage, mais chaque appel est signé à nouveau avec un horodatage neuf.
  const premier = await espion.appeler("GET", "/etat");
  const deuxieme = await espion.appeler("GET", "/etat");
  assert.equal(premier.json?.erreur?.code, "horodatage");
  assert.equal(deuxieme.json?.erreur?.code, "horodatage");
  assert.deepEqual(vus, ["1000", "1001"]);
  const reel = clientRelais({ ...r.eclat, fetch: r.versApp });
  assert.equal((await reel.appeler("GET", "/etat")).statut, 200);
  assert.equal((await reel.appeler("GET", "/etat")).statut, 200);
});

test("sortie en anglais : noms et détails dans la langue demandée", async () => {
  const r = await relais();
  const v = await verifierRelais({ adresse: ADRESSE, institut: "voisin", cle: r.cles.voisin, fetch: r.versApp, lang: "en" });
  assert.deepEqual(v.points.map((p) => p.nom), ["Link status", "Salon in trial mode"]);
  assert.match(v.points[1].detail ?? "", /not in trial mode/);
  const complaisant = await verifierRelais({ ...r.eclat, lang: "en", fetch: async (url, init) => {
    const u = new URL(url);
    const h = new Headers(init.headers);
    h.set("x-lama-signature", signerAppel(r.cles.eclat, h.get("x-lama-horodatage") ?? "", init.method ?? "GET", u.pathname + u.search, typeof init.body === "string" ? init.body : ""));
    return r.app.fetch(new Request(url, { ...init, headers: h }));
  } });
  assert.equal(complaisant.points[2].detail, "401 expected, 200 received");
});

test("un relais qui ne répond pas devient un point en échec, sans attente sans fin", async () => {
  const jamais = () => new Promise<Response>(() => {});
  const v = await verifierRelais({ adresse: ADRESSE, institut: "eclat", cle: "a".repeat(64), fetch: jamais, delai: 30 });
  assert.equal(v.ok, false);
  assert.equal(v.points.length, 1);
  assert.equal(v.points[0].nom, "État de la liaison");
  assert.match(v.points[0].detail ?? "", /pas de réponse du relais/);
});

test("une exception qui n'est pas une Error devient un point en échec lisible", async () => {
  const v = await verifierRelais({ adresse: ADRESSE, institut: "eclat", cle: "a".repeat(64), fetch: () => Promise.reject("réseau coupé") });
  assert.equal(v.points[0].detail, "erreur\u00a0: réseau coupé");
});

/** Lance `cli verifier-relais` sans bloquer la boucle d'événements (le relais tourne dans ce processus). */
function lancer(args: string[], entree: string, langue = "fr"): Promise<{ code: number | null; sortie: string; erreurs: string }> {
  const dir = mkdtempSync(join(tmpdir(), "lama-verifier-"));
  const env = { ...process.env, LAMA_DEV: "1", LAMA_LANGUE: langue, LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config") };
  return new Promise((fin) => {
    const enfant = spawn(process.execPath, ["--no-warnings", cliBundle(), "verifier-relais", ...args], { env });
    let sortie = "";
    let erreurs = "";
    enfant.stdout.on("data", (d) => { sortie += d; });
    enfant.stderr.on("data", (d) => { erreurs += d; });
    enfant.on("close", (code) => fin({ code, sortie, erreurs }));
    enfant.stdin.end(entree);
  });
}

test("cli verifier-relais : clé lue sur l'entrée standard, jamais affichée ; conforme (0) ; clé absente (1)", async () => {
  const serveur = demarrerRelais({ RELAIS_BASE: ":memory:", RELAIS_CLE_MAITRE: MAITRE, RELAIS_ADMIN_MOT_DE_PASSE: CONFIG_ESSAI.motDePasseGestion }, 0);
  if (!serveur.serveur.listening) await once(serveur.serveur, "listening");
  const adresse = `http://127.0.0.1:${(serveur.serveur.address() as AddressInfo).port}`;
  const salons = new Salons(serveur.base, MAITRE);
  const cree = await salons.creer("essai-cli", "Salon d'essai", Date.now());
  if (cree === "existe") throw new Error("salon déjà créé");
  await salons.modifier("essai-cli", { etat: "essai" });
  const CLE = cree.cle;
  try {
    const ok = await lancer([adresse, "essai-cli"], `${CLE}\n`);
    assert.equal(ok.code, 0, ok.sortie + ok.erreurs);
    assert.match(ok.sortie, /Conforme au contrat v1 \(28 points vérifiés\)/);
    assert.match(ok.sortie, /^ok {2}État de la liaison$/m);
    assert.doesNotMatch(ok.sortie + ok.erreurs, new RegExp(CLE));
    const sansCle = await lancer([adresse, "essai-cli"], "\n");
    assert.equal(sansCle.code, 1);
    assert.match(sansCle.erreurs, /entrée standard/);
    const courte = await lancer([adresse, "essai-cli"], `${CLE.slice(0, 40)}\n`);
    assert.equal(courte.code, 1, "clé qui n'a pas 64 caractères hexadécimaux");
    const majuscules = await lancer([adresse, "essai-cli"], `${CLE.toUpperCase()}\n`);
    assert.equal(majuscules.code, 1);
    const adresseFausse = await lancer(["pas une adresse", "essai-cli"], `${CLE}\n`);
    assert.equal(adresseFausse.code, 3);
    assert.match(adresseFausse.erreurs, /Adresse du relais invalide/);
    assert.doesNotMatch(adresseFausse.erreurs, /Invalid URL/);
    assert.equal((await lancer(["ftp://relais.exemple", "essai-cli"], `${CLE}\n`)).code, 3);
    const anglais = await lancer([adresse, "essai-cli"], `${CLE}\n`, "en");
    assert.equal(anglais.code, 0, anglais.sortie + anglais.erreurs);
    assert.match(anglais.sortie, /Complies with contract v1 \(28 checks passed\)/);
    assert.match(anglais.sortie, /^ok {2}Link status$/m);
    assert.doesNotMatch(anglais.sortie, /liaison|Conforme/);
    // Salon actif : non conforme, sortie 2.
    const actif = await salons.creer("actif-cli", "Salon actif", Date.now());
    if (actif === "existe") throw new Error("salon déjà créé");
    const nonConforme = await lancer([adresse, "actif-cli"], `${actif.cle}\n`);
    assert.equal(nonConforme.code, 2, nonConforme.sortie + nonConforme.erreurs);
    assert.match(nonConforme.sortie, /ÉCHEC {2}Salon en mode essai \(salon pas en mode essai\u00a0: /);
    assert.match(nonConforme.sortie, /Non conforme au contrat v1\./);
    const nonConformeEn = await lancer([adresse, "actif-cli"], `${actif.cle}\n`, "en");
    assert.equal(nonConformeEn.code, 2);
    assert.match(nonConformeEn.sortie, /FAILED {2}Salon in trial mode \(salon not in trial mode/);
  } finally {
    await serveur.fermer();
  }
});

test("deux clients du même salon et de la même clé : horodatages strictement croissants entre eux", async () => {
  const vus: string[] = [];
  const espion = async (_url: string, init: RequestInit) => {
    vus.push(new Headers(init.headers).get("x-lama-horodatage") ?? "");
    return new Response("{}", { status: 200 });
  };
  // La boucle d'échange et « Tester la liaison » ont chacun leur client : une même milliseconde ne doit jamais signer deux appels.
  const commun = { adresse: "https://relais-partage.exemple", institut: "eclat", cle: "c".repeat(64), fetch: espion, maintenant: () => 5_000 };
  const boucle = clientRelais(commun);
  const essai = clientRelais(commun);
  await boucle.appeler("GET", "/etat");
  await essai.appeler("GET", "/etat");
  await boucle.appeler("GET", "/etat");
  assert.deepEqual(vus, ["5000", "5001", "5002"]);
});

test("une application qui ignore le thème et les horaires reste conforme", async () => {
  const r = await relais();
  // Application d'avant le 18/10/2026 : l'offre lui arrive sans les deux champs (champs inconnus ignorés), signée pour elle.
  const ancienne = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    if (init.method === "PUT" && u.pathname.endsWith("/offre") && typeof init.body === "string") {
      const corps = JSON.parse(init.body) as { institut?: Record<string, unknown> };
      // L'offre invalide (sans institut) passe telle quelle.
      if (corps.institut) {
        delete corps.institut.theme;
        delete corps.institut.horaires;
      }
      const texte = JSON.stringify(corps);
      const h = new Headers(init.headers);
      h.set("x-lama-signature", signerAppel(r.cles.eclat, h.get("x-lama-horodatage") ?? "", "PUT", u.pathname + u.search, texte));
      return r.app.fetch(new Request(url, { ...init, headers: h, body: texte }));
    }
    return r.app.fetch(new Request(url, init));
  };
  const v = await verifierRelais({ ...r.eclat, fetch: ancienne });
  assert.equal(v.ok, true, JSON.stringify(v.points.filter((p) => !p.ok)));
  assert.equal(v.points.length, 28);
});

test("une application qui accepte deux fois la même signature est non conforme au rejeu", async () => {
  const r = await relais();
  // Application sans mémoire des signatures : un appel rejoué reçoit la même réponse que l'original.
  const vues = new Map<string, Response>();
  const sansMemoire = async (url: string, init: RequestInit) => {
    const signature = new Headers(init.headers).get("x-lama-signature") ?? "";
    const deja = vues.get(signature);
    if (deja) return deja.clone();
    const reponse = await r.app.fetch(new Request(url, init));
    vues.set(signature, reponse.clone());
    return reponse;
  };
  const v = await verifierRelais({ ...r.eclat, fetch: sansMemoire });
  assert.equal(v.ok, false);
  assert.equal(v.points.at(-1)?.nom, "Signature rejouée refusée");
  assert.equal(v.points.at(-1)?.detail, "401 attendu, 200 reçu");
});
