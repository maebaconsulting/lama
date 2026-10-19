import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Cliente, Decision, Demande, DemandeEntrante, Disponibilites, Erreur, Etat, Id, NomDecision, Offre } from "./noyau/contrat.ts";
import { bodyLimit } from "hono/body-limit";
import type { Context } from "hono";
import { horodatageValide, verifierSignature } from "./noyau/signature.ts";
import { APPLICATION, deposer, duSalon, ecarts, erreur, lireTexte, TROP_GROS, type DuSalon, type Services } from "./services.ts";

/** Corps de 1 Mo au plus (règles communes du contrat). */
const TAILLE_MAX = 1024 * 1024;

const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({ content: { "application/json": { schema } }, description });
const corps = <T extends z.ZodTypeAny>(schema: T) => ({ body: { content: { "application/json": { schema } }, required: true } });
const refus401 = json(Erreur, "Signature, horodatage ou salon refusés");
const refus403 = json(Erreur, "Salon suspendu sur l'application");
const refus404 = json(Erreur, "Demande inconnue");
const refus413 = json(Erreur, "Corps de plus de 1 Mo");
const refus422 = json(Erreur, "Données invalides");
/** Toute route peut répondre `500 interne` (erreur inattendue, base indisponible : `onError` de app.ts). */
const refus500 = json(Erreur, "Erreur interne (code interne)");
const parametreId = z.object({ id: Id.openapi({ param: { name: "id", in: "path" }, example: "d_7Kq2" }) });

type Env = { Variables: { du: DuSalon } };

/** API du contrat v1, montée sous `/lama/v1` : lama appelle, l'application répond, pour le salon qui signe. */
export function routesLama(s: Services): OpenAPIHono<Env> {
  const app = new OpenAPIHono<Env>({
    defaultHook: (resultat, c) => {
      if (!resultat.success) return c.json(erreur("donnees_invalides", ecarts(resultat.error)), 422);
    },
  });

  const trop = (c: Context) => c.json(erreur("corps_trop_gros", "1 Mo au plus"), 413);
  // Corps de 1 Mo au plus, compté pendant la lecture (avec ou sans content-length).
  app.use("*", bodyLimit({ maxSize: TAILLE_MAX, onError: trop }));

  // Toute route est signée avec la clé du salon (règles communes). Le corps est lu une fois en texte pour la
  // signature ; Hono le garde ensuite pour la validation. L'horodatage est contrôlé avant de chercher le salon, et un
  // salon inconnu reçoit exactement la réponse d'une mauvaise clé : un inconnu n'apprend rien. Une signature déjà
  // vue (rejeu) est refusée comme une fausse. Un salon suspendu n'est révélé qu'à un appel bien signé.
  app.use("*", async (c, next) => {
    let texte = "";
    if (c.req.method !== "GET") {
      const lu = await lireTexte(c);
      if (lu === TROP_GROS) return trop(c);
      texte = lu;
    }
    const maintenant = s.maintenant();
    const horodatage = c.req.header("x-lama-horodatage") ?? null;
    if (!horodatageValide(horodatage, maintenant)) return c.json(erreur("horodatage", "horodatage absent, mal formé ou écarté de plus de 5 minutes"), 401);
    const refusee = () => c.json(erreur("signature", "signature refusée"), 401);
    const id = c.req.header("x-lama-institut") ?? "";
    const salon = id ? await s.salons.lire(id) : null;
    const cle = salon ? await s.salons.cle(id) : null;
    const url = new URL(c.req.url);
    const signature = c.req.header("x-lama-signature") ?? null;
    // Salon inconnu : même travail de calcul contre une clé factice, puis même réponse.
    const verdict = await verifierSignature({
      cle: cle ?? "0".repeat(64), horodatage, signature, methode: c.req.method, chemin: url.pathname + url.search, corps: texte, maintenant,
    });
    if (!salon || !cle || verdict !== "ok") return refusee();
    const du = duSalon(s, salon);
    if ((await du.depot.compterAppel(`sig:${signature}`, Number(horodatage))) > 1) return refusee();
    if (salon.etat === "suspendu") return c.json(erreur("suspendu", "salon suspendu sur l'application"), 403);
    await s.salons.noterAppel(salon.id, maintenant);
    c.set("du", du);
    await next();
  });

  app.openapi(createRoute({
    method: "get", path: "/etat", summary: "Vérifier la liaison",
    responses: { 200: json(Etat, "État de l'application pour ce salon"), 401: refus401, 500: refus500, 403: refus403 },
  }), async (c) => {
    const { depot } = c.get("du");
    const [offre, dispo, attente] = await Promise.all([depot.versionDocument("offre"), depot.versionDocument("disponibilites"), depot.enAttente()]);
    return c.json({ contrat: "v1" as const, application: APPLICATION, version_offre: offre, version_disponibilites: dispo, demandes_en_attente: attente, mode_essai: c.get("du").salon.etat === "essai" }, 200);
  });

  const reponsesDocument = {
    200: json(z.object({ version: z.number().int() }), "Document en place"),
    401: refus401, 500: refus500,
    403: refus403,
    409: json(Erreur, "Version plus ancienne que celle en place"),
    413: refus413,
    422: refus422,
  };

  app.openapi(createRoute({ method: "put", path: "/offre", summary: "Publier l'offre", request: corps(Offre), responses: reponsesDocument }), async (c) => {
    const offre = c.req.valid("json");
    if (!(await c.get("du").depot.ecrireDocument("offre", offre.version, offre, s.maintenant()))) return c.json(erreur("version_ancienne", "version plus ancienne que celle en place"), 409);
    return c.json({ version: offre.version }, 200);
  });

  app.openapi(createRoute({ method: "put", path: "/disponibilites", summary: "Publier les plages libres", request: corps(Disponibilites), responses: reponsesDocument }), async (c) => {
    const dispo = c.req.valid("json");
    if (!(await c.get("du").depot.ecrireDocument("disponibilites", dispo.version, dispo, s.maintenant()))) return c.json(erreur("version_ancienne", "version plus ancienne que celle en place"), 409);
    return c.json({ version: dispo.version }, 200);
  });

  app.openapi(createRoute({
    method: "get", path: "/demandes", summary: "Relever les demandes non accusées",
    request: { query: z.object({ apres: z.string().regex(/^\d{1,12}$/).optional(), limite: z.coerce.number().int().min(1).max(200).default(50) }) },
    responses: { 200: json(z.object({ demandes: z.array(Demande), curseur: z.string().nullable() }), "Demandes et curseur à repasser au relevé suivant"), 401: refus401, 500: refus500, 403: refus403, 422: refus422 },
  }), async (c) => {
    const { apres, limite } = c.req.valid("query");
    const { depot } = c.get("du");
    await depot.purgerNonVerifiees(s.maintenant());
    const demandes = await depot.nonAccusees(apres ? Number(apres) : null, limite, s.maintenant());
    return c.json({ demandes, curseur: demandes.at(-1)?.curseur ?? apres ?? null }, 200);
  });

  app.openapi(createRoute({
    method: "post", path: "/demandes/{id}/accuse", summary: "Accuser une demande enregistrée par lama",
    request: { params: parametreId },
    responses: { 200: json(z.object({ id: Id }), "Accusé enregistré, données de la cliente effacées"), 401: refus401, 500: refus500, 403: refus403, 404: refus404 },
  }), async (c) => {
    const { id } = c.req.valid("param");
    if (!(await c.get("du").depot.accuser(id, s.maintenant()))) return c.json(erreur("introuvable", "demande inconnue"), 404);
    return c.json({ id }, 200);
  });

  app.openapi(createRoute({
    method: "post", path: "/demandes/{id}/decision", summary: "Rendre la décision",
    request: { params: parametreId, ...corps(Decision) },
    responses: { 200: json(z.object({ id: Id, decision: NomDecision }), "Décision enregistrée"), 401: refus401, 500: refus500, 403: refus403, 404: refus404, 413: refus413, 422: refus422 },
  }), async (c) => {
    const { id } = c.req.valid("param");
    const decision = c.req.valid("json");
    if (!(await c.get("du").depot.decider(id, decision, s.maintenant()))) return c.json(erreur("introuvable", "demande inconnue"), 404);
    return c.json({ id, decision: decision.decision }, 200);
  });

  // Routes d'essai : décrites dans la description OpenAPI, ouvertes seulement aux salons en état « essai ».
  app.openapi(createRoute({
    method: "post", path: "/essai/demande", summary: "Mode essai\u00a0: déposer une demande comme une cliente",
    request: corps(DemandeEntrante),
    responses: {
      201: json(z.object({ id: Id, jeton: z.string() }), "Demande enregistrée"),
      401: refus401, 500: refus500,
      403: refus403,
      404: json(Erreur, "Salon pas en mode essai"),
      409: json(Erreur, "Demande refusée\u00a0: ferme, inconnue, rappel_seulement ou indisponible"),
      413: refus413,
      422: refus422,
    },
  }), async (c) => {
    const du = c.get("du");
    if (du.salon.etat !== "essai") return c.json(erreur("introuvable", "mode essai désactivé pour ce salon"), 404);
    const r = await deposer(s, du, c.req.valid("json"));
    if (!r.ok) return c.json(erreur(r.code, "demande refusée"), 409);
    return c.json({ id: r.id, jeton: r.jeton }, 201);
  });

  app.openapi(createRoute({
    method: "get", path: "/essai/demande/{id}", summary: "Mode essai\u00a0: état brut d'une demande",
    request: { params: parametreId },
    responses: {
      200: json(z.object({ id: Id, cliente: Cliente.nullable(), note: z.string().nullable(), accusee_le: z.number().int().nullable(), decision: Decision.nullable() }), "Demande"),
      401: refus401, 500: refus500,
      403: refus403,
      404: refus404,
    },
  }), async (c) => {
    const du = c.get("du");
    if (du.salon.etat !== "essai") return c.json(erreur("introuvable", "mode essai désactivé pour ce salon"), 404);
    const d = await du.depot.pourEssai(c.req.valid("param").id);
    if (!d) return c.json(erreur("introuvable", "demande inconnue"), 404);
    return c.json(d, 200);
  });

  return app;
}
