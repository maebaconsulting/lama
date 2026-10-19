import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Offre } from "./noyau/contrat.ts";
import { SALONS_RESERVES } from "./noyau/salon.ts";
import { pageAvecTheme } from "./noyau/theme.ts";
import { routesLama } from "./routes-lama.ts";
import { routesPubliques } from "./routes-publiques.ts";
import { routesGestion } from "./routes-gestion.ts";
import { duSalon, erreur, services, type Dependances, type Page } from "./services.ts";

export type { Config, Dependances } from "./services.ts";

/** Application du relais, indépendante de l'hébergeur (worker.ts, node.ts) : API du contrat sous /lama/v1, API publique sous /api/<salon>, API de gestion sous /gestion/api, pages /<salon>/ et /gestion/. */
export function creerApp(deps: Dependances): OpenAPIHono {
  const s = services(deps);
  const app = new OpenAPIHono();
  app.route("/lama/v1", routesLama(s));
  app.route("/api", routesPubliques(s));
  app.route("/gestion/api", routesGestion(s));
  // Pages construites (relais/dist) : la gestion, et la page de réservation de chaque salon (/<salon>/).
  const servir = async (c: Context, nom: Page, statut: 200 | 404 = 200, habiller: (html: string) => string = (html) => html) => {
    const html = await s.page(nom);
    if (!html) return c.json(erreur("introuvable", "page non construite"), 404);
    c.header("cache-control", "no-cache");
    return c.html(habiller(html), statut);
  };
  app.get("/gestion", (c) => c.redirect("/gestion/", 301));
  // La gestion ne s'affiche jamais dans un cadre (détournement de clics) ; la page de réservation, si (integrer.js).
  app.get("/gestion/", (c) => {
    c.header("content-security-policy", "frame-ancestors 'none'");
    c.header("x-content-type-options", "nosniff");
    return servir(c, "gestion.html");
  });
  // `/` et un identifiant sans salon : la page de réservation elle-même, en 404, qui affiche « adresse incomplète ou inconnue » (pas du JSON brut devant une cliente).
  app.get("/", (c) => servir(c, "index.html", 404));
  app.get("/:salon{[a-z0-9][a-z0-9-]*}", (c) => {
    const id = c.req.param("salon");
    return SALONS_RESERVES.includes(id) ? c.json(erreur("introuvable", "adresse inconnue"), 404) : c.redirect(`/${id}/`, 301);
  });
  app.get("/:salon{[a-z0-9][a-z0-9-]*}/", async (c) => {
    const id = c.req.param("salon");
    if (SALONS_RESERVES.includes(id)) return c.json(erreur("introuvable", "adresse inconnue"), 404);
    const salon = await s.salons.lire(id);
    if (!salon) return servir(c, "index.html", 404);
    // Thème du salon posé dans la page par le serveur (spec § 9.5) : aucune page ne change de couleurs après coup.
    const offre = await duSalon(s, salon).depot.lireDocument<Offre>("offre");
    return servir(c, "index.html", 200, (html) => pageAvecTheme(html, offre?.institut.theme));
  });
  app.notFound((c) => c.json(erreur("introuvable", "adresse inconnue"), 404));
  app.onError((e, c) => {
    console.error(e);
    return c.json(erreur("interne", "erreur interne"), 500);
  });
  return app;
}
