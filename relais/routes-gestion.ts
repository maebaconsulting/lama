import { z } from "@hono/zod-openapi";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { egal } from "./noyau/coffre.ts";
import type { Disponibilites } from "./noyau/contrat.ts";
import { FRAICHEUR_MS } from "./noyau/creneaux.ts";
import { EtatSalon, IdSalon, NomSalon, Origine } from "./noyau/salon.ts";
import { sha256Hex, signer } from "./noyau/signature.ts";
import { ecarts, erreur, lireTexte, TROP_GROS, type Services } from "./services.ts";
import { Depot } from "./stockage/depot.ts";

/** Interface de gestion des salons (spec § 5, « Interface de gestion ») : API réservée à l'exploitant. */

export const DUREE_SESSION_MS = 12 * 60 * 60 * 1000;
/** Essais de connexion permis par adresse et par quart d'heure. */
export const ESSAIS_CONNEXION = 5;
export const COOKIE_GESTION = "relais_gestion";
const QUART_MS = 15 * 60 * 1000;
const TAILLE_MAX = 16 * 1024;

const Creation = z.object({ id: IdSalon, nom: NomSalon });
const Modification = z.object({ nom: NomSalon.optional(), etat: EtatSalon.optional(), origines: z.array(Origine).max(20).optional() });
const Suppression = z.object({ confirmation: z.string() });

/** Session sans état : `<expiration>.<HMAC>`, signée par la clé générale et le mot de passe (changer l'un ferme les sessions). */
async function signerSession(s: Services, expire: number): Promise<string> {
  return `${expire}.${await signer(`${s.config.cleMaitre}\n${s.config.motDePasseGestion}`, String(expire), "SESSION", "/gestion", "")}`;
}

/**
 * Instant de la dernière déconnexion, gardé dans `limites` (clé `_gestion:deconnexion`, fenêtre = instant). Une session dure
 * 12 h et la tâche quotidienne n'efface un compteur qu'après 24 h : aucune session émise avant la déconnexion ne survit à la purge.
 * Un seul compte d'exploitant : la déconnexion ferme toutes les sessions.
 */
const CLE_DECONNEXION = "deconnexion";

async function derniereDeconnexion(s: Services): Promise<number> {
  return (await s.base.premier<{ fenetre: number }>("SELECT fenetre FROM limites WHERE cle = ?", [`_gestion:${CLE_DECONNEXION}`]))?.fenetre ?? 0;
}

async function sessionValide(s: Services, valeur: string | undefined): Promise<boolean> {
  const m = /^(\d{1,16})\.[0-9a-f]{64}$/.exec(valeur ?? "");
  if (!m || Number(m[1]) <= s.maintenant()) return false;
  if (Number(m[1]) - DUREE_SESSION_MS <= (await derniereDeconnexion(s))) return false;
  return egal(await signerSession(s, Number(m[1])), valeur!);
}

const trop = (c: Context) => c.json(erreur("corps_trop_gros", "16 Ko au plus"), 413);

/** Corps JSON, `null` s'il est illisible ; `TROP_GROS` s'il dépasse la limite. Les erreurs de lecture autres remontent. */
async function corpsJson(c: Context): Promise<unknown> {
  const texte = await lireTexte(c);
  if (texte === TROP_GROS) return TROP_GROS;
  try {
    return JSON.parse(texte);
  } catch {
    return null;
  }
}

export function routesGestion(s: Services): Hono {
  const app = new Hono();

  // Corps de 16 Ko au plus, compté pendant la lecture.
  app.use("*", bodyLimit({ maxSize: TAILLE_MAX, onError: trop }));

  // Jamais de cache ; toute action exige l'en-tête de l'interface (avec SameSite=Strict, un autre site ne peut rien déclencher).
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    if (c.req.method !== "GET" && c.req.header("x-relais-gestion") !== "1") return c.json(erreur("en_tete", "en-tête X-Relais-Gestion attendu"), 403);
    await next();
  });

  app.post("/connexion", async (c) => {
    const ip = s.ipDe(c);
    const maintenant = s.maintenant();
    const essais = await new Depot(s.base, "_gestion").compterAppel(`connexion:${await sha256Hex(`${s.config.cleMaitre}\n${ip}`)}`, Math.floor(maintenant / QUART_MS) * QUART_MS);
    if (essais > ESSAIS_CONNEXION) return c.json(erreur("trop_d_essais", "trop d'essais, réessayez dans un quart d'heure"), 429);
    const corps = await corpsJson(c);
    if (corps === TROP_GROS) return trop(c);
    const saisi = typeof (corps as { mot_de_passe?: unknown } | null)?.mot_de_passe === "string" ? (corps as { mot_de_passe: string }).mot_de_passe : "";
    // Empreintes comparées en temps constant : la durée ne dit rien du mot de passe.
    if (!egal(await sha256Hex(saisi), await sha256Hex(s.config.motDePasseGestion))) return c.json(erreur("mot_de_passe", "mot de passe refusé"), 401);
    const expire = maintenant + DUREE_SESSION_MS;
    // Secure quand la requête arrive en https (le Worker voit l'adresse publique ; derrière un relais TLS en http, le cookie reste sans Secure).
    setCookie(c, COOKIE_GESTION, await signerSession(s, expire), {
      path: "/gestion", httpOnly: true, sameSite: "Strict", secure: s.estHttps(c), maxAge: DUREE_SESSION_MS / 1000,
    });
    return c.body(null, 204);
  });

  app.post("/deconnexion", async (c) => {
    // Seule une session valide révoque : sans elle, la déconnexion n'efface que le cookie (sinon n'importe qui, muni de l'en-tête, fermerait la session de l'exploitant).
    if (await sessionValide(s, getCookie(c, COOKIE_GESTION))) await new Depot(s.base, "_gestion").compterAppel(CLE_DECONNEXION, s.maintenant());
    deleteCookie(c, COOKIE_GESTION, { path: "/gestion" });
    return c.body(null, 204);
  });

  // Toutes les routes suivantes exigent une session valide.
  app.use("*", async (c, next) => {
    if (!(await sessionValide(s, getCookie(c, COOKIE_GESTION)))) return c.json(erreur("session", "connexion requise"), 401);
    await next();
  });

  app.get("/salons", async (c) => {
    const maintenant = s.maintenant();
    const salons = await Promise.all((await s.salons.lister()).map(async (salon) => {
      const depot = new Depot(s.base, salon.id);
      const [versionOffre, dispo, attente] = await Promise.all([depot.versionDocument("offre"), depot.lireDocument<Disponibilites>("disponibilites"), depot.enAttente()]);
      return {
        ...salon,
        version_offre: versionOffre,
        plages_generees_le: dispo?.genere_le ?? null,
        plages_a_jour: dispo !== null && maintenant - dispo.genere_le <= FRAICHEUR_MS,
        demandes_en_attente: attente,
      };
    }));
    return c.json({ salons });
  });

  // L'identifiant est validé ici : `Salons.creer` lève une erreur sur un identifiant invalide ou réservé.
  app.post("/salons", async (c) => {
    const corps = await corpsJson(c);
    if (corps === TROP_GROS) return trop(c);
    const lu = Creation.safeParse(corps);
    if (!lu.success) return c.json(erreur("donnees_invalides", ecarts(lu.error)), 422);
    const r = await s.salons.creer(lu.data.id, lu.data.nom, s.maintenant());
    if (r === "existe") return c.json(erreur("existe", "identifiant déjà pris"), 409);
    return c.json(r, 201);
  });

  app.put("/salons/:id", async (c) => {
    const corps = await corpsJson(c);
    if (corps === TROP_GROS) return trop(c);
    const lu = Modification.safeParse(corps);
    if (!lu.success) return c.json(erreur("donnees_invalides", ecarts(lu.error)), 422);
    const { origines, ...reste } = lu.data;
    const salon = await s.salons.modifier(c.req.param("id"), { ...reste, ...(origines ? { origines: [...new Set(origines)] } : {}) });
    return salon ? c.json({ salon }) : c.json(erreur("introuvable", "salon inconnu"), 404);
  });

  app.post("/salons/:id/cle", async (c) => {
    const cle = await s.salons.remplacerCle(c.req.param("id"));
    return cle ? c.json({ cle }) : c.json(erreur("introuvable", "salon inconnu"), 404);
  });

  app.delete("/salons/:id", async (c) => {
    const id = c.req.param("id");
    const corps = await corpsJson(c);
    if (corps === TROP_GROS) return trop(c);
    const lu = Suppression.safeParse(corps);
    if (!lu.success || lu.data.confirmation !== id) return c.json(erreur("confirmation", "recopier l'identifiant du salon pour confirmer"), 422);
    return (await s.salons.supprimer(id)) ? c.body(null, 204) : c.json(erreur("introuvable", "salon inconnu"), 404);
  });

  return app;
}
