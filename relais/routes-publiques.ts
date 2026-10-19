import { z } from "@hono/zod-openapi";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { coherenceDemande, DemandeEntranteBase, type Offre } from "./noyau/contrat.ts";
import { creneaux, etatVitrine, resume } from "./noyau/creneaux.ts";
import { ouvertA } from "./noyau/horaires.ts";
import { sha256Hex } from "./noyau/signature.ts";
import { dateValide, localDe } from "./noyau/temps.ts";
import { aleatoire, contexte, deposer, duSalon, ecarts, empreinteTelephone, erreur, lireTexte, TROP_GROS, type DuSalon, type Services } from "./services.ts";

/** Au plus trois demandes en attente par numéro de téléphone et par salon (protection contre les abus, spec § 3). */
export const MAX_PAR_TELEPHONE = 3;
const HEURE_MS = 60 * 60 * 1000;
/** Corps d'une demande : 16 Ko au plus (route sans signature, ouverte à tous). */
const TAILLE_MAX = 16 * 1024;

/** Demande envoyée par une page : celle du contrat, plus l'accord, le champ piège et le jeton Turnstile. */
export const DemandePublique = DemandeEntranteBase.extend({
  accord: z.literal(true),
  piege: z.string().max(200).default(""),
  turnstile: z.string().max(4096).optional(),
}).superRefine(coherenceDemande);

type Env = { Variables: { du: DuSalon } };

/** Hôte de l'origine envoyée par le navigateur, `null` si elle est illisible (`null`, `file://`…). */
function hoteDe(origine: string): string | null {
  try {
    return new URL(origine).host || null;
  } catch {
    return null;
  }
}

/**
 * Garde des dépôts (POST) contre les requêtes « simples » d'un autre site, qui partent sans requête préalable :
 * corps JSON exigé (`415 type_contenu`), et une origine présente doit être celle du relais (même hôte que la
 * requête) ou une origine déclarée du salon (`403 origine`). Sans en-tête `Origin` (lama, outils), la requête passe.
 */
function garde(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origine = c.req.header("origin");
    if (origine !== undefined && !c.get("du").salon.origines.includes(origine)) {
      const hote = hoteDe(origine);
      const siens = [new URL(c.req.url).host, c.req.header("host")];
      if (hote === null || !siens.includes(hote)) return c.json(erreur("origine", "origine non autorisée"), 403);
    }
    const type = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return c.json(erreur("type_contenu", "corps application/json attendu"), 415);
    await next();
  };
}

/**
 * API publique v1, montée sous /api : celle de la page du relais et des sites qui font leur propre interface.
 * Aucune donnée de cliente n'en sort ; toutes les règles et protections s'appliquent quel que soit l'appelant.
 */
export function routesPubliques(s: Services): Hono<Env> {
  const app = new Hono<Env>();

  // Salon de l'adresse, en-têtes CORS pour ses seules origines autorisées, jamais de cache.
  app.use("/:salon/*", async (c, next) => {
    // Posés d'abord : valables pour toute réponse, erreurs et salon inconnu compris.
    c.header("cache-control", "no-store");
    c.header("vary", "Origin");
    const salon = await s.salons.lire(c.req.param("salon"));
    if (!salon) return c.json(erreur("introuvable", "salon inconnu"), 404);
    const origine = c.req.header("origin");
    if (origine && salon.origines.includes(origine)) {
      c.header("access-control-allow-origin", origine);
      c.header("access-control-allow-methods", "GET, POST");
      c.header("access-control-allow-headers", "content-type");
      c.header("access-control-max-age", "600");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    c.set("du", duSalon(s, salon));
    await next();
  });

  app.get("/:salon/vitrine", async (c) => {
    const du = c.get("du");
    const ctx = await contexte(s, du);
    // Salon suspendu : le contexte n'a pas d'offre (réservation fermée), mais la page garde le nom de l'institut.
    const offre = ctx.offre ?? (await du.depot.lireDocument<Offre>("offre"));
    return c.json({
      etat: etatVitrine(ctx),
      institut: offre
        ? {
          nom: offre.institut.nom, telephone: offre.institut.telephone, logo: offre.institut.logo, devise: offre.institut.devise, langues: offre.institut.langues,
          texte_donnees: offre.institut.texte_donnees, theme: offre.institut.theme ?? null, horaires: offre.institut.horaires ?? null,
        }
        : null,
      prestations: ctx.offre?.prestations ?? [],
      praticiennes: ctx.offre?.praticiennes ?? [],
      aujourdhui: offre ? localDe(ctx.maintenant, offre.institut.fuseau).date : null,
      du: ctx.offre ? ctx.dispo?.du ?? null : null,
      au: ctx.offre ? ctx.dispo?.au ?? null : null,
      turnstile: s.config.turnstile?.cleSite ?? null,
    });
  });

  app.get("/:salon/jours", async (c) => {
    const ctx = await contexte(s, c.get("du"));
    return c.json(resume(ctx, c.req.query("prestation") ?? "", c.req.query("praticienne") || null));
  });

  app.get("/:salon/creneaux", async (c) => {
    const date = c.req.query("date") ?? "";
    if (!dateValide(date)) return c.json(erreur("donnees_invalides", "date AAAA-MM-JJ attendue"), 422);
    const ctx = await contexte(s, c.get("du"));
    return c.json({ creneaux: creneaux(ctx, c.req.query("prestation") ?? "", date, c.req.query("praticienne") || null) });
  });

  // Unique chemin de dépôt : créneau, rappel et « sans préférence » passent tous par les mêmes protections.
  app.post("/:salon/demandes", garde(), bodyLimit({ maxSize: TAILLE_MAX, onError: (c) => c.json(erreur("corps_trop_gros", "16 Ko au plus"), 413) }), async (c) => {
    const du = c.get("du");
    const trop = () => c.json(erreur("corps_trop_gros", "16 Ko au plus"), 413);
    const texte = await lireTexte(c);
    if (texte === TROP_GROS) return trop();
    let brut: unknown = null;
    try {
      brut = JSON.parse(texte);
    } catch { /* corps illisible : refusé par la validation */ }
    // Champ piège rempli (reconnu avant la validation, même trop long) : un robot. Faux accusé de réception, rien n'est gardé.
    if (typeof brut === "object" && brut !== null && (brut as { piege?: unknown }).piege) return c.json({ jeton: aleatoire(24), hors_horaires: false }, 201);
    const lu = DemandePublique.safeParse(brut);
    if (!lu.success) return c.json(erreur("donnees_invalides", ecarts(lu.error)), 422);
    const d = lu.data;
    const ip = s.ipDe(c);
    const maintenant = s.maintenant();
    const appels = await du.depot.compterAppel(`ip:${await sha256Hex(`${s.config.cleMaitre}\n${ip}`)}`, Math.floor(maintenant / HEURE_MS) * HEURE_MS);
    if (appels > s.config.demandesParHeureParIp) return c.json(erreur("trop_de_demandes", "trop de demandes depuis cette adresse"), 429);
    if (s.config.turnstile && !(await s.verifierTurnstile(d.turnstile ?? "", ip))) return c.json(erreur("verification", "vérification anti-robot refusée"), 422);
    // Contrôle puis insertion : des envois simultanés peuvent dépasser cette limite ; le quota par adresse ci-dessus borne l'excès.
    // Les demandes de créneau dont la date est passée ne comptent plus (lama ne les a peut-être jamais décidées).
    const enPlace = await du.depot.lireDocument<Offre>("offre");
    const fuseau = enPlace?.institut.fuseau ?? "UTC";
    if ((await du.depot.enAttenteParTelephone(await empreinteTelephone(s, du, d.cliente.telephone), localDe(maintenant, fuseau).date)) >= MAX_PAR_TELEPHONE) {
      return c.json(erreur("trop_de_demandes_telephone", "trop de demandes en attente pour ce numéro"), 429);
    }
    const r = await deposer(s, du, { type: d.type, prestation: d.prestation, praticienne: d.praticienne, date: d.date, heure: d.heure, souhait: d.souhait, cliente: d.cliente, note: d.note });
    if (!r.ok) return c.json(erreur(r.code, "demande refusée"), 409);
    // Déposée pendant la fermeture (horaires publiés, fuseau de l'institut) : la page dit « dès l'ouverture ».
    return c.json({ jeton: r.jeton, hors_horaires: ouvertA(enPlace?.institut.horaires, maintenant, fuseau) === false }, 201);
  });

  // Le jeton de suivi voyage dans le corps, jamais dans l'adresse (ni dans les journaux du serveur ou de l'hébergeur).
  app.post("/:salon/suivi", garde(), bodyLimit({ maxSize: 1024, onError: (c) => c.json(erreur("corps_trop_gros", "1 Ko au plus"), 413) }), async (c) => {
    const texte = await lireTexte(c);
    if (texte === TROP_GROS) return c.json(erreur("corps_trop_gros", "1 Ko au plus"), 413);
    let jeton: unknown = null;
    try {
      jeton = (JSON.parse(texte) as { jeton?: unknown } | null)?.jeton;
    } catch { /* corps illisible : demande introuvable */ }
    const suivi = typeof jeton === "string" && jeton ? await c.get("du").depot.suivi(jeton) : null;
    return suivi ? c.json(suivi) : c.json(erreur("introuvable", "demande introuvable ou expirée"), 404);
  });

  return app;
}
