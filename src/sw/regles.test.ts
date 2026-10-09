import assert from "node:assert/strict";
import { test } from "node:test";
import { cachesPerimes, DEMANDE_ACTIVATION, estDemandeActivation, fichiersEnveloppe, jamaisEnCache, nomCache, strategie } from "./regles.ts";

/** Règles du service worker (PWA, P-03), en fonctions pures. */
const ORIGINE = "https://lama.local";
const ENVELOPPE = new Set(["/index.html", "/assets/index-abc.js", "/icones/lama-192.png"]);
const choix = (chemin: string, o: { method?: string; mode?: string; origine?: string } = {}) =>
  strategie({ method: o.method ?? "GET", url: `${o.origine ?? ORIGINE}${chemin}`, mode: o.mode ?? "no-cors" }, ORIGINE, ENVELOPPE);

test("jamais en cache : API, photos de produits, logos, PDF, certificat, manifeste, service worker", () => {
  for (const chemin of [
    "/api", "/api/auth/state", "/api/products/12/image", "/api/institut/logos/clair", "/api/invoices/3/pdf",
    "/certificat", "/certificat/autorite.crt", "/certificat/lama.mobileconfig", "/manifest.webmanifest", "/sw.js",
    "/docs/guide.pdf", "/GUIDE.PDF",
  ]) assert.equal(jamaisEnCache(chemin), true, chemin);
  for (const chemin of ["/", "/index.html", "/assets/index-abc.js", "/icones/lama-192.png", "/apiculture", "/certificats-anciens"]) {
    assert.equal(jamaisEnCache(chemin), false, chemin);
  }
});

test("stratégie : navigation réseau d'abord, enveloppe et fichiers à empreinte en cache d'abord, tout le reste au réseau", () => {
  assert.equal(choix("/", { mode: "navigate" }), "navigation");
  assert.equal(choix("/fr/caisse?jour=2026-10-05", { mode: "navigate" }), "navigation");
  assert.equal(choix("/assets/index-abc.js"), "cache-d-abord");
  assert.equal(choix("/assets/autre-chunk-def.js"), "cache-d-abord", "fichier à empreinte absent de la liste : cache puis réseau");
  assert.equal(choix("/icones/lama-192.png"), "cache-d-abord");
  assert.equal(choix("/icones/lama-192.png?v=2"), "reseau");
  assert.equal(choix("/llms.txt"), "reseau");
});

test("stratégie : toute requête autre que GET, d'une autre origine ou interdite passe au réseau, même en navigation", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"]) assert.equal(choix("/assets/index-abc.js", { method }), "reseau", method);
  assert.equal(choix("/api/auth/state", { mode: "cors" }), "reseau");
  assert.equal(choix("/api/invoices/3/pdf", { mode: "navigate" }), "reseau", "PDF ouvert dans un onglet");
  assert.equal(choix("/certificat", { mode: "navigate" }), "reseau", "page du certificat toujours du serveur");
  assert.equal(choix("/manifest.webmanifest"), "reseau");
  assert.equal(choix("/assets/index-abc.js", { origine: "https://cdn.exemple.com" }), "reseau");
  assert.equal(choix("/", { mode: "navigate", origine: "http://lama.local" }), "reseau", "même hôte en http : autre origine");
  assert.equal(strategie({ method: "GET", url: "pas une adresse", mode: "navigate" }, ORIGINE, ENVELOPPE), "reseau");
});

test("caches : nom par version et empreinte, seules les anciennes enveloppes de lama sont supprimées", () => {
  const actuel = nomCache("1.0.0", "c0fe41726d50");
  assert.equal(actuel, "lama-enveloppe-1.0.0-c0fe41726d50");
  assert.deepEqual(
    cachesPerimes(["lama-enveloppe-1.0.0-aaaaaaaaaaaa", actuel, "autre-cache", "lama-enveloppe-0.9.0-bbbbbbbbbbbb"], actuel),
    ["lama-enveloppe-1.0.0-aaaaaaaaaaaa", "lama-enveloppe-0.9.0-bbbbbbbbbbbb"],
  );
  assert.deepEqual(cachesPerimes([], actuel), []);
});

test("demande d'activation : le seul message de l'écran que le service worker écoute", () => {
  assert.equal(estDemandeActivation(DEMANDE_ACTIVATION), true);
  assert.equal(estDemandeActivation({ type: "lama-activer", autre: 1 }), true);
  for (const donnee of [null, undefined, "lama-activer", { type: "SKIP_WAITING" }, 42]) assert.equal(estDemandeActivation(donnee), false, String(donnee));
});

test("enveloppe : index.html, scripts, styles, woff2 et images du manifeste de Vite, icônes ; pas de woff, ni doublon", () => {
  const manifeste = {
    "index.html": { file: "assets/index-abc.js", css: ["assets/index-def.css"], assets: ["assets/jost-latin-400-normal-x1.woff2", "assets/jost-latin-400-normal-x2.woff", "assets/icon-y.svg"] },
    "icon.svg": { file: "assets/icon-y.svg" },
  };
  assert.deepEqual(fichiersEnveloppe(manifeste, ["/icones/lama-192.png"]), [
    "/assets/icon-y.svg", "/assets/index-abc.js", "/assets/index-def.css", "/assets/jost-latin-400-normal-x1.woff2", "/icones/lama-192.png", "/index.html",
  ]);
});
