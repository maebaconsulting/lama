import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  activerNouvelleVersion, doitEnregistrer, doitRechargerEcranPerime, enregistrerServiceWorker, nouvelleVersionVisible, onNouvelleVersion,
  oublierPourEssai, rechargerEcranPerime, surChangementDeControleur, type InscriptionSW, type TravailleurSW,
} from "./mise-a-jour.ts";

/** Service worker vu de l'écran (PWA, P-03, P-05) : enregistrement, nouvelle version, rechargements. */
beforeEach(() => oublierPourEssai());

class FauxTravailleur implements TravailleurSW {
  state = "installing";
  messages: unknown[] = [];
  private ecouteurs: (() => void)[] = [];
  postMessage(message: unknown) { this.messages.push(message); }
  addEventListener(_type: "statechange", ecouteur: () => void) { this.ecouteurs.push(ecouteur); }
  passer(state: string) { this.state = state; for (const e of this.ecouteurs) e(); }
}

function fauxNavigateur(o: { controleur: boolean; enAttente?: FauxTravailleur }) {
  const ecouteurs: Record<string, (() => void)[]> = {};
  const inscription: InscriptionSW & { trouver(t: FauxTravailleur): void } = {
    waiting: o.enAttente ?? null,
    installing: null,
    update: async () => undefined,
    addEventListener: (type, ecouteur) => { (ecouteurs[type] ??= []).push(ecouteur); },
    trouver(t) { this.installing = t; for (const e of ecouteurs.updatefound ?? []) e(); },
  };
  const enregistres: string[] = [];
  const conteneur = {
    controller: o.controleur ? {} : null,
    register: async (url: string, options: { scope: string }) => { enregistres.push(`${url} ${options.scope}`); return inscription; },
    addEventListener: (type: "controllerchange", ecouteur: () => void) => { (ecouteurs[type] ??= []).push(ecouteur); },
    changer() { this.controller = {}; for (const e of ecouteurs.controllerchange ?? []) e(); },
  };
  let recharges = 0;
  return { inscription, conteneur, enregistres, recharger: () => { recharges++; }, recharges: () => recharges };
}

test("enregistrement : contexte sécurisé, hors développement, navigateur capable ; sinon rien", () => {
  assert.equal(doitEnregistrer({ securise: true, dev: false, disponible: true }), true);
  assert.equal(doitEnregistrer({ securise: false, dev: false, disponible: true }), false, "http://lama.local : pas de service worker");
  assert.equal(doitEnregistrer({ securise: true, dev: true, disponible: true }), false, "pnpm dev");
  assert.equal(doitEnregistrer({ securise: true, dev: false, disponible: false }), false);
});

test("enregistrement : /sw.js de portée « / », et rien hors contexte sécurisé ou sans navigator.serviceWorker", async () => {
  const nav = fauxNavigateur({ controleur: false });
  assert.equal(await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: false, dev: false, recharger: nav.recharger }), null);
  assert.equal(await enregistrerServiceWorker({ conteneur: undefined, securise: true, dev: false, recharger: nav.recharger }), null);
  assert.equal(await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: true, dev: true, recharger: nav.recharger }), null);
  assert.deepEqual(nav.enregistres, []);
  assert.ok(await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: true, dev: false, recharger: nav.recharger }));
  assert.deepEqual(nav.enregistres, ["/sw.js /"]);
});

test("changement de contrôleur : un seul rechargement après l'appui, proposition si un autre onglet a activé, rien à la première installation", () => {
  assert.equal(surChangementDeControleur({ demande: true, dejaRecharge: false, avaitControleur: true }), "recharger");
  assert.equal(surChangementDeControleur({ demande: true, dejaRecharge: true, avaitControleur: true }), "rien", "jamais de boucle");
  assert.equal(surChangementDeControleur({ demande: false, dejaRecharge: false, avaitControleur: true }), "proposer");
  assert.equal(surChangementDeControleur({ demande: false, dejaRecharge: false, avaitControleur: false }), "rien");
});

test("première installation : aucun bandeau, aucun rechargement", async () => {
  const nav = fauxNavigateur({ controleur: false });
  await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: true, dev: false, recharger: nav.recharger });
  const premier = new FauxTravailleur();
  nav.inscription.trouver(premier);
  premier.passer("installed");
  nav.conteneur.changer();
  assert.equal(nouvelleVersionVisible(), false);
  assert.equal(nav.recharges(), 0);
});

test("nouvelle version : bandeau quand elle attend, activation sur appui puis un seul rechargement", async () => {
  const nav = fauxNavigateur({ controleur: true });
  const vus: boolean[] = [];
  onNouvelleVersion((v) => vus.push(v));
  await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: true, dev: false, recharger: nav.recharger });
  const nouveau = new FauxTravailleur();
  nav.inscription.trouver(nouveau);
  nouveau.passer("installed");
  assert.equal(nouvelleVersionVisible(), true);
  assert.deepEqual(vus, [true]);
  assert.equal(nav.recharges(), 0, "jamais de rechargement sans appui");
  activerNouvelleVersion();
  assert.deepEqual(nouveau.messages, [{ type: "lama-activer" }]);
  assert.equal(nav.recharges(), 0, "le rechargement attend l'activation");
  nav.conteneur.changer();
  nav.conteneur.changer();
  assert.equal(nav.recharges(), 1, "un seul rechargement, même si l'événement revient");
});

test("nouvelle version déjà en attente au lancement : bandeau tout de suite ; activée par un autre onglet : l'appui recharge", async () => {
  const attente = new FauxTravailleur();
  attente.state = "installed";
  const nav = fauxNavigateur({ controleur: true, enAttente: attente });
  await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: true, dev: false, recharger: nav.recharger });
  assert.equal(nouvelleVersionVisible(), true);
  nav.conteneur.changer();
  assert.equal(nav.recharges(), 0, "activée ailleurs : pas de rechargement surprise ici");
  assert.equal(nouvelleVersionVisible(), true);
  activerNouvelleVersion();
  assert.equal(nav.recharges(), 1);
  assert.deepEqual(attente.messages, []);
});

test("écran périmé : rechargé au plus une fois par minute, jamais sans stockage (aucune boucle)", async () => {
  assert.equal(doitRechargerEcranPerime(null, 1_000_000), true);
  assert.equal(doitRechargerEcranPerime(1_000_000, 1_030_000), false);
  assert.equal(doitRechargerEcranPerime(1_000_000, 1_060_000), true);
  assert.equal(doitRechargerEcranPerime(2_000_000, 1_000_000), true, "horloge de l'appareil reculée");
  const valeurs = new Map<string, string>();
  const store = { getItem: (k: string) => valeurs.get(k) ?? null, setItem: (k: string, v: string) => { valeurs.set(k, v); } };
  let recharges = 0;
  const nav = fauxNavigateur({ controleur: false });
  await enregistrerServiceWorker({ conteneur: nav.conteneur, securise: true, dev: false, recharger: () => { recharges++; } });
  assert.equal(rechargerEcranPerime(1_000_000, store), true);
  assert.equal(valeurs.get("lama.rechargement"), "1000000");
  assert.equal(rechargerEcranPerime(1_010_000, store), false);
  assert.equal(recharges, 1);
  const refuse = { getItem: () => { throw new Error("refusé"); }, setItem: () => { throw new Error("refusé"); } };
  assert.equal(rechargerEcranPerime(5_000_000, refuse), false);
  assert.equal(rechargerEcranPerime(5_000_000, null), false);
  assert.equal(recharges, 1);
});

test("écran : bandeau « Nouvelle version disponible : Recharger » rechargé sur appui seulement, enregistrement au démarrage", async () => {
  const { readFileSync } = await import("node:fs");
  const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
  const bandeaux = lire("../components/bandeaux.tsx");
  assert.match(bandeaux, /<BandeauNouvelleVersion \/>/);
  assert.match(bandeaux, /onClick=\{activerNouvelleVersion\}>\{t\("bandeau\.recharger"\)\}/);
  assert.doesNotMatch(bandeaux, /location\.reload/);
  const main = lire("../main.tsx");
  assert.match(main, /enregistrerServiceWorker\(\{\s*conteneur: navigator\.serviceWorker,\s*securise: window\.isSecureContext,\s*dev: import\.meta\.env\.DEV,/);
});
