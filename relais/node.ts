import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { creerApp } from "./app.ts";
import { configDepuis, type VariablesRelais } from "./config.ts";
import { purgerTout } from "./stockage/depot.ts";
import { baseSqlite, migrerSqlite } from "./stockage/sqlite.ts";

const JOUR_MS = 24 * 60 * 60 * 1000;

type EnvNode = VariablesRelais & {
  RELAIS_BASE?: string;
  RELAIS_PORT?: string;
  RELAIS_HOTE?: string;
  RELAIS_DIST?: string;
  /** « 1 » : le relais est derrière un proxy de confiance (x-forwarded-for et x-forwarded-proto sont ceux du proxy). */
  RELAIS_PROXY_DE_CONFIANCE?: string;
};

type EnTetes = { get(nom: string): string | null };

/**
 * Adresse de la cliente sur Node. Par défaut, celle de la connexion. Derrière un proxy de confiance seulement,
 * la dernière entrée de `x-forwarded-for` (celle que le proxy a ajoutée ; les précédentes sont falsifiables),
 * à défaut l'adresse de la connexion. Jamais `cf-connecting-ip` ici.
 */
export function adresseClient(entetes: EnTetes, adresseConnexion: string | undefined, proxyDeConfiance: boolean): string {
  if (proxyDeConfiance) {
    const derniere = entetes.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (derniere) return derniere;
  }
  return adresseConnexion ?? "inconnue";
}

/** Requête en https ? Derrière un proxy de confiance, `x-forwarded-proto: https` ; sinon le protocole de l'adresse de la requête. */
export function estHttpsNode(entetes: EnTetes, urlRequete: string, proxyDeConfiance: boolean): boolean {
  if (proxyDeConfiance && entetes.get("x-forwarded-proto")?.split(",").at(-1)?.trim().toLowerCase() === "https") return true;
  return new URL(urlRequete).protocol === "https:";
}

/** Lance une purge sans jamais rejeter : l'erreur est journalisée (en français), le processus continue. */
export async function purgeSure(purger: () => Promise<unknown>, journal: (message: string) => void = console.error): Promise<void> {
  try {
    await purger();
  } catch (e) {
    journal(`Purge quotidienne en échec\u00a0: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Relais sur un serveur ordinaire, ou pour les essais : node:sqlite et les fichiers de la page construite. */
export function demarrerRelais(env: EnvNode = process.env as EnvNode, port = Number(env.RELAIS_PORT ?? 8790)) {
  const chemin = env.RELAIS_BASE ?? "relais-donnees.db";
  const proxy = env.RELAIS_PROXY_DE_CONFIANCE === "1";
  const config = configDepuis(env);
  if (chemin !== ":memory:") mkdirSync(dirname(resolve(chemin)), { recursive: true });
  const db = new DatabaseSync(chemin);
  migrerSqlite(db);
  const base = baseSqlite(db);
  const dist = resolve(env.RELAIS_DIST ?? fileURLToPath(new URL("./dist/", import.meta.url)));
  const app = creerApp({
    base,
    config,
    ipDe: (c) => adresseClient(c.req.raw.headers, getConnInfo(c).remote.address, proxy),
    estHttps: (c) => estHttpsNode(c.req.raw.headers, c.req.url, proxy),
    page: (nom) => readFile(join(dist, nom), "utf8").catch(() => null),
  });
  // Fichiers de la page (assets, integrer.js) : servis s'ils existent ; sans eux, l'API seule (essais).
  // Seulement /assets/* et /integrer.js : les pages (index.html, gestion.html) passent par l'application (salon vérifié, no-cache).
  if (existsSync(dist)) {
    const statique = serveStatic({ root: relative(process.cwd(), dist) });
    app.use("/assets/*", statique);
    app.use("/integrer.js", statique);
  }
  // Effacement à 30 jours : une fois au démarrage, puis chaque jour.
  const purger = () => purgeSure(() => purgerTout(base, Date.now()));
  void purger();
  const purge = setInterval(() => void purger(), JOUR_MS);
  purge.unref();
  const serveur = serve({ fetch: app.fetch, port, hostname: env.RELAIS_HOTE ?? "127.0.0.1" });
  return {
    serveur,
    base,
    fermer: () => new Promise<void>((fin) => {
      clearInterval(purge);
      serveur.close(() => {
        db.close();
        fin();
      });
      if ("closeAllConnections" in serveur) serveur.closeAllConnections();
    }),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let serveur;
  try {
    ({ serveur } = demarrerRelais());
  } catch (e) {
    // Configuration refusée : le message seul, sans trace de pile.
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  serveur.on("listening", () => console.log(`Relais à l'écoute sur ${JSON.stringify(serveur.address())}`));
}
