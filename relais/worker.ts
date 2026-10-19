// Réglages wrangler obligatoires pour les fichiers statiques (Workers Static Assets):
//   assets.html_handling = "none"      sans cela, ASSETS.fetch("/index.html") répond une redirection 307 (auto-trailing-slash)
//                                      et aucune page n'est servie;
//   assets.run_worker_first = true     sans cela, `/` et `/gestion` seraient servis directement par les fichiers, sans passer
//                                      par le Worker (salon non vérifié, pas de no-cache). Toute requête arrive donc au Worker,
//                                      qui renvoie lui-même `/assets/*` et `/integrer.js` aux fichiers statiques (voir `fetch`).
import { creerApp } from "./app.ts";
import { configDepuis, type VariablesRelais } from "./config.ts";
import type { Page } from "./services.ts";
import { baseD1, type D1Like } from "./stockage/d1.ts";
import { purgerTout } from "./stockage/depot.ts";

/** Liaisons du Worker : la base D1 `BASE`, les fichiers de la page `ASSETS` (Workers Static Assets), les variables et secrets. */
export type Env = VariablesRelais & { BASE: D1Like; ASSETS?: { fetch(requete: Request): Promise<Response> } };

/** Page construite lue dans les fichiers statiques du Worker. */
function pages(env: Env) {
  return async (nom: Page): Promise<string | null> => {
    const r = await env.ASSETS?.fetch(new Request(`https://fichiers.invalid/${nom}`));
    if (r && r.status >= 300 && r.status < 400) {
      console.error("Fichiers statiques\u00a0: redirection reçue pour une page, régler assets.html_handling = \"none\" dans wrangler");
      return null;
    }
    return r && r.ok ? r.text() : null;
  };
}

/** Point d'entrée Cloudflare Workers. Les fichiers (`/assets/…`, `/integrer.js`) sont servis par Static Assets. */
export default {
  async fetch(requete: Request, env: Env): Promise<Response> {
    const chemin = new URL(requete.url).pathname;
    if ((requete.method === "GET" || requete.method === "HEAD") && env.ASSETS && (chemin.startsWith("/assets/") || chemin === "/integrer.js")) {
      return env.ASSETS.fetch(requete);
    }
    return creerApp({ base: baseD1(env.BASE), config: configDepuis(env), page: pages(env) }).fetch(requete);
  },
  /** Tâche planifiée quotidienne (Cron Trigger) : effacement à 30 jours, tous salons. */
  async scheduled(_evenement: unknown, env: Env): Promise<void> {
    await purgerTout(baseD1(env.BASE), Date.now());
  },
};
