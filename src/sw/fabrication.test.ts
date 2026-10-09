import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { fabriquerServiceWorker } from "./fabrication.ts";

/** Fabrication de dist/sw.js (PWA, P-03) et comportement du service worker assemblé, exécuté avec un faux navigateur. */
function fausseFabrication(): string {
  const dist = mkdtempSync(join(tmpdir(), "lama-fab-sw-"));
  mkdirSync(join(dist, ".vite"), { recursive: true });
  mkdirSync(join(dist, "assets"));
  mkdirSync(join(dist, "icones"));
  writeFileSync(join(dist, "index.html"), "<!DOCTYPE html><title>lama</title>");
  for (const f of ["index-abc.js", "index-def.css", "jost-x1.woff2", "jost-x2.woff"]) writeFileSync(join(dist, "assets", f), f);
  writeFileSync(join(dist, "icones", "lama-192.png"), "png");
  writeFileSync(join(dist, ".vite", "manifest.json"), JSON.stringify({
    "index.html": { file: "assets/index-abc.js", css: ["assets/index-def.css"], assets: ["assets/jost-x1.woff2", "assets/jost-x2.woff"] },
  }));
  return dist;
}

type Ecouteur = (e: Record<string, unknown>) => void;

/** Exécute dist/sw.js dans un contexte isolé : portée, caches et réseau simulés. */
function executer(dist: string, reseau: "ok" | "coupe") {
  const ecouteurs: Record<string, Ecouteur> = {};
  const stockes = new Map<string, Map<string, string>>([["lama-enveloppe-0.9.0-ancienne", new Map()], ["autre-cache", new Map()]]);
  const appels: string[] = [];
  const fetch = async (r: { url: string } | string) => {
    const url = typeof r === "string" ? r : r.url;
    appels.push(url);
    if (reseau === "coupe") throw new TypeError("Failed to fetch");
    return `réseau:${url}`;
  };
  const caches = {
    open: async (nom: string) => {
      if (!stockes.has(nom)) stockes.set(nom, new Map());
      const cache = stockes.get(nom)!;
      return { addAll: async (requetes: { url: string }[]) => { for (const r of requetes) cache.set(r.url, `cache:${r.url}`); } };
    },
    keys: async () => [...stockes.keys()],
    delete: async (nom: string) => stockes.delete(nom),
    match: async (r: { url: string } | string, o: { cacheName: string }) => {
      const url = typeof r === "string" ? r : new URL(r.url).pathname;
      return stockes.get(o.cacheName)?.get(url);
    },
  };
  let attente = 0;
  let reclames = 0;
  const self = {
    location: { origin: "https://lama.local" },
    skipWaiting: async () => { attente++; },
    clients: { claim: async () => { reclames++; } },
    addEventListener: (type: string, f: Ecouteur) => { ecouteurs[type] = f; },
  };
  class Request {
    url: string;
    cache: string;
    constructor(url: string, init: { cache: string }) { this.url = url; this.cache = init.cache; }
  }
  runInNewContext(readFileSync(join(dist, "sw.js"), "utf8"), { self, caches, fetch, Request, URL, Promise, Set });
  const declencher = async (type: string, e: Record<string, unknown>) => {
    let promesse: Promise<unknown> | undefined;
    ecouteurs[type]({ ...e, waitUntil: (p: Promise<unknown>) => { promesse = p; }, respondWith: (p: Promise<unknown>) => { promesse = p; } });
    return promesse === undefined ? "non intercepté" : await promesse;
  };
  return { declencher, stockes, appels, etat: () => ({ attente, reclames }) };
}

test("fabrication : sw.js écrit avec le nom du cache et la liste de l'enveloppe, dist/.vite retiré", async () => {
  const dist = fausseFabrication();
  try {
    const { cache, fichiers } = await fabriquerServiceWorker(dist, "1.0.0");
    assert.match(cache, /^lama-enveloppe-1\.0\.0-[0-9a-f]{12}$/);
    assert.deepEqual(fichiers, ["/assets/index-abc.js", "/assets/index-def.css", "/assets/jost-x1.woff2", "/icones/lama-192.png", "/index.html"]);
    const sw = readFileSync(join(dist, "sw.js"), "utf8");
    assert.ok(sw.includes(cache));
    assert.doesNotMatch(sw, /__LAMA_ENVELOPPE__|\bimport\b/, "un seul fichier, sans import");
    assert.equal(existsSync(join(dist, ".vite")), false);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("fabrication : l'empreinte change avec le contenu de index.html ou d'une icône, pas d'une fabrication à l'autre", async () => {
  const dist = fausseFabrication();
  try {
    const manifeste = readFileSync(join(dist, ".vite", "manifest.json"), "utf8");
    const premier = (await fabriquerServiceWorker(dist, "1.0.0")).cache;
    const refaire = async () => { mkdirSync(join(dist, ".vite")); writeFileSync(join(dist, ".vite", "manifest.json"), manifeste); return (await fabriquerServiceWorker(dist, "1.0.0")).cache; };
    assert.equal(await refaire(), premier);
    writeFileSync(join(dist, "index.html"), "<!DOCTYPE html><title>lama 2</title>");
    const second = await refaire();
    assert.notEqual(second, premier);
    writeFileSync(join(dist, "icones", "lama-192.png"), "png 2");
    assert.notEqual(await refaire(), second);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("service worker : installe l'enveloppe sans s'activer, supprime les anciennes à l'activation, s'active sur demande", async () => {
  const dist = fausseFabrication();
  try {
    const { cache } = await fabriquerServiceWorker(dist, "1.0.0");
    const sw = executer(dist, "ok");
    await sw.declencher("install", {});
    assert.deepEqual([...sw.stockes.get(cache)!.keys()].sort(), ["/assets/index-abc.js", "/assets/index-def.css", "/assets/jost-x1.woff2", "/icones/lama-192.png", "/index.html"]);
    assert.deepEqual(sw.etat(), { attente: 0, reclames: 0 }, "en attente : jamais de bascule sans appui");
    await sw.declencher("activate", {});
    assert.deepEqual([...sw.stockes.keys()].sort(), ["autre-cache", cache]);
    assert.equal(sw.etat().reclames, 1);
    await sw.declencher("message", { data: { type: "autre" } });
    assert.equal(sw.etat().attente, 0);
    await sw.declencher("message", { data: { type: "lama-activer" } });
    assert.equal(sw.etat().attente, 1);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("service worker : serveur coupé, la navigation rend index.html de l'enveloppe ; l'API n'est jamais interceptée", async () => {
  const dist = fausseFabrication();
  try {
    await fabriquerServiceWorker(dist, "1.0.0");
    const coupe = executer(dist, "coupe");
    await coupe.declencher("install", {});
    const requete = (chemin: string, mode: string, method = "GET") => ({ request: { url: `https://lama.local${chemin}`, mode, method } });
    assert.equal(await coupe.declencher("fetch", requete("/fr/caisse", "navigate")), "cache:/index.html");
    assert.equal(await coupe.declencher("fetch", requete("/assets/index-abc.js", "cors")), "cache:/assets/index-abc.js");
    assert.equal(await coupe.declencher("fetch", requete("/api/auth/state", "cors")), "non intercepté");
    assert.equal(await coupe.declencher("fetch", requete("/api/sales", "cors", "POST")), "non intercepté");
    assert.equal(await coupe.declencher("fetch", requete("/certificat", "navigate")), "non intercepté");
    assert.deepEqual(coupe.appels, ["https://lama.local/fr/caisse"], "seule la navigation a tenté le réseau ; ressources du cache et requêtes non interceptées n'ont jamais atteint le fetch du service worker");
    const ok = executer(dist, "ok");
    await ok.declencher("install", {});
    assert.equal(await ok.declencher("fetch", requete("/fr/caisse", "navigate")), "réseau:https://lama.local/fr/caisse", "réseau d'abord");
    assert.equal(await ok.declencher("fetch", requete("/assets/autre-xyz.js", "cors")), "réseau:https://lama.local/assets/autre-xyz.js");
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
