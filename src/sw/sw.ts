/**
 * Service worker de lama (PWA, P-03, P-05), écrit à la main. Assemblé par
 * esbuild dans `dist/sw.js` (`fabrication.ts`), qui y inscrit le nom du cache
 * et la liste des fichiers de l'enveloppe à la place de `__LAMA_ENVELOPPE__`.
 * L'enveloppe (écrans, polices, icônes) s'ouvre sans serveur ; les données
 * viennent toujours du serveur.
 */
import { cachesPerimes, estDemandeActivation, strategie } from "./regles.ts";

declare const __LAMA_ENVELOPPE__: { cache: string; fichiers: string[] };

interface EvenementAttente extends Event {
  waitUntil(promesse: Promise<unknown>): void;
}
interface EvenementFetch extends EvenementAttente {
  request: Request;
  respondWith(reponse: Promise<Response>): void;
}
interface EvenementMessage extends Event {
  data: unknown;
}
/** Ce que ce service worker utilise de sa portée (le type `ServiceWorkerGlobalScope` n'est pas dans la bibliothèque DOM du projet). */
interface Portee {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", ecouteur: (e: EvenementAttente) => void): void;
  addEventListener(type: "fetch", ecouteur: (e: EvenementFetch) => void): void;
  addEventListener(type: "message", ecouteur: (e: EvenementMessage) => void): void;
}

const portee = self as unknown as Portee;
const { cache: CACHE, fichiers: FICHIERS } = __LAMA_ENVELOPPE__;
const ENVELOPPE = new Set(FICHIERS);

// Installation : l'enveloppe de cette version, demandée au serveur sans passer par le cache HTTP.
// Pas de skipWaiting : la nouvelle version attend l'appui sur « Recharger » ou le prochain lancement.
portee.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FICHIERS.map((fichier) => new Request(fichier, { cache: "reload" })))));
});

// Activation : anciennes enveloppes supprimées, puis les écrans ouverts passent sous cette version.
portee.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(cachesPerimes(noms, CACHE).map((nom) => caches.delete(nom))))
      .then(() => portee.clients.claim()),
  );
});

portee.addEventListener("message", (e) => {
  if (estDemandeActivation(e.data)) void portee.skipWaiting();
});

portee.addEventListener("fetch", (e) => {
  const choix = strategie({ method: e.request.method, url: e.request.url, mode: e.request.mode }, portee.location.origin, ENVELOPPE);
  if (choix === "navigation") e.respondWith(navigation(e.request));
  else if (choix === "cache-d-abord") e.respondWith(cacheDAbord(e.request));
});

/** Réseau d'abord ; serveur injoignable : `index.html` de l'enveloppe, qui dira « Serveur injoignable ». */
async function navigation(requete: Request): Promise<Response> {
  try {
    return await fetch(requete);
  } catch (erreur) {
    const page = await caches.match("/index.html", { cacheName: CACHE });
    if (page) return page;
    throw erreur;
  }
}

/** Fichier à empreinte (le nom change avec le contenu) : le cache, sinon le réseau. */
async function cacheDAbord(requete: Request): Promise<Response> {
  return (await caches.match(requete, { cacheName: CACHE })) ?? fetch(requete);
}
