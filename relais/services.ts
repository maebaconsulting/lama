import type { Context } from "hono";
import type { z } from "@hono/zod-openapi";
import type { DemandeEntrante, Disponibilites, Offre } from "./noyau/contrat.ts";
import { refusDemande, type Contexte, type Refus } from "./noyau/creneaux.ts";
import { sha256Hex } from "./noyau/signature.ts";
import { ajouterJours, enMinutes, localDe } from "./noyau/temps.ts";
import type { Base } from "./stockage/base.ts";
import { Depot } from "./stockage/depot.ts";
import { Salons, type Salon } from "./stockage/salons.ts";

/** Nom et version de cette application, rendus par `GET /lama/v1/etat`. */
export const APPLICATION = { nom: "lama-relais", version: "1.0.0" };

export type Config = {
  /** Clé générale de l'exploitant : chiffre les clés des salons et signe les sessions de gestion. */
  cleMaitre: string;
  /** Mot de passe de l'interface de gestion des salons. */
  motDePasseGestion: string;
  demandesParHeureParIp: number;
  turnstile: { cleSite: string; secret: string } | null;
};

/** Pages construites de `relais/dist` que l'application sert elle-même. */
export type Page = "index.html" | "gestion.html";

export type Dependances = {
  base: Base;
  config: Config;
  maintenant?: () => number;
  ipDe?: (c: Context) => string;
  /** La requête est-elle arrivée en https (attribut `Secure` du cookie de gestion) ? Défaut : protocole de l'adresse de la requête. */
  estHttps?: (c: Context) => boolean;
  verifierTurnstile?: (jeton: string, ip: string) => Promise<boolean>;
  /** Contenu d'une page construite, ou `null` si elle n'est pas disponible (fournie par node.ts et worker.ts). */
  page?: (nom: Page) => Promise<string | null>;
};

export type Services = {
  base: Base;
  salons: Salons;
  config: Config;
  maintenant: () => number;
  ipDe: (c: Context) => string;
  estHttps: (c: Context) => boolean;
  verifierTurnstile: (jeton: string, ip: string) => Promise<boolean>;
  page: (nom: Page) => Promise<string | null>;
};

/** Le salon d'une requête et le dépôt de ses données. */
export type DuSalon = { salon: Salon; depot: Depot };

/** Message lisible d'une validation refusée : chemin et raison de chaque écart. */
export function ecarts(e: z.ZodError): string {
  return e.issues.map((i) => `${i.path.join(".") || "corps"}\u00a0: ${i.message}`).join("\u00a0; ");
}

/** Marque rendue par `lireTexte` quand le corps dépasse la limite de taille. */
export const TROP_GROS = Symbol("trop_gros");

/** Corps de la requête en texte ; `TROP_GROS` si la limite (`bodyLimit`) est dépassée. Toute autre erreur de lecture remonte. */
export async function lireTexte(c: Context): Promise<string | typeof TROP_GROS> {
  try {
    return await c.req.text();
  } catch (e) {
    if (e instanceof Error && e.name === "BodyLimitError") return TROP_GROS;
    throw e;
  }
}

/** Corps d'erreur du contrat. */
export function erreur(code: string, message: string) {
  return { erreur: { code, message } };
}

/** Adresse de la cliente selon Cloudflare (défaut du Worker) ; « inconnue » sinon. `x-forwarded-for` est falsifiable : node.ts fournit son propre résolveur. */
export function ipParDefaut(c: Context): string {
  return c.req.header("cf-connecting-ip") ?? "inconnue";
}

const FORME_IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:.]*)$/i;

/** Vérification Turnstile auprès de Cloudflare (option, désactivée par défaut). */
export function turnstileCloudflare(secret: string, appeler: typeof fetch = fetch) {
  return async (jeton: string, ip: string): Promise<boolean> => {
    if (!jeton) return false;
    try {
      // L'adresse n'est transmise que si elle en a la forme (« inconnue » ou une valeur falsifiée en est exclue) ; refus au bout de 5 s.
      const corps = new URLSearchParams({ secret, response: jeton });
      if (FORME_IP.test(ip)) corps.set("remoteip", ip);
      const r = await appeler("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: corps, signal: AbortSignal.timeout(5000) });
      return r.ok && ((await r.json()) as { success?: boolean }).success === true;
    } catch {
      return false;
    }
  };
}

export function services(deps: Dependances): Services {
  const { config } = deps;
  return {
    base: deps.base,
    salons: new Salons(deps.base, config.cleMaitre),
    config,
    maintenant: deps.maintenant ?? Date.now,
    ipDe: deps.ipDe ?? ipParDefaut,
    estHttps: deps.estHttps ?? ((c) => new URL(c.req.url).protocol === "https:"),
    verifierTurnstile: deps.verifierTurnstile ?? (config.turnstile ? turnstileCloudflare(config.turnstile.secret) : async () => true),
    page: deps.page ?? (async () => null),
  };
}

export function duSalon(s: Services, salon: Salon): DuSalon {
  return { salon, depot: new Depot(s.base, salon.id) };
}

/**
 * Offre, plages et demandes de créneau du salon utiles au calcul (depuis la veille, dans le fuseau de l'institut).
 * Un salon suspendu est vu sans offre : réservation fermée.
 */
export async function contexte(s: Services, du: DuSalon, avantCurseur?: number): Promise<Contexte> {
  const [offre, dispo] = await Promise.all([du.depot.lireDocument<Offre>("offre"), du.depot.lireDocument<Disponibilites>("disponibilites")]);
  const maintenant = s.maintenant();
  const hier = ajouterJours(localDe(maintenant, offre?.institut.fuseau ?? "UTC").date, -1);
  return { offre: du.salon.etat === "suspendu" ? null : offre, dispo, demandes: await du.depot.demandesActives(hier, avantCurseur), maintenant };
}

/** Jeton aléatoire en base 64 pour adresse (`-`, `_`, sans `=`). */
export function aleatoire(octets: number): string {
  const b = crypto.getRandomValues(new Uint8Array(octets));
  let s = "";
  for (const o of b) s += String.fromCharCode(o);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Empreinte du téléphone, salée par la clé générale et le salon : compte les demandes en attente sans garder le numéro. */
export function empreinteTelephone(s: Services, du: DuSalon, telephone: string): Promise<string> {
  return sha256Hex(`${s.config.cleMaitre}\n${du.salon.id}\n${telephone}`);
}

export type Depose = { ok: true; id: string; jeton: string } | { ok: false; code: Refus };

/**
 * Contrôle d'une demande (règles du contrat) puis enregistrement ; le créneau est retiré dès cet instant.
 * Le contrôle et l'insertion étant séparés par des attentes, deux envois simultanés pourraient passer tous deux :
 * après l'insertion, le contrôle est refait contre les seules demandes de rang inférieur ; si le créneau n'est plus
 * libre, la demande est retirée et refusée. La demande de rang inférieur gagne toujours. Tant que le contrôle n'est pas
 * passé la demande est « non vérifiée » : elle bloque les autres déposants mais lama ne la relève pas.
 */
export async function deposer(s: Services, du: DuSalon, entree: DemandeEntrante): Promise<Depose> {
  await du.depot.purgerNonVerifiees(s.maintenant());
  const ctx = await contexte(s, du);
  const d = entree.type === "rappel" ? { ...entree, date: null, heure: null } : { ...entree, souhait: null };
  const refus = refusDemande(ctx, d);
  if (refus) return { ok: false, code: refus };
  const prestation = ctx.offre!.prestations.find((p) => p.id === d.prestation)!;
  const debut = d.heure === null ? null : enMinutes(d.heure);
  const id = `d_${aleatoire(16)}`;
  const jeton = aleatoire(24);
  const curseur = await du.depot.ajouterDemande({
    id, jeton, type: d.type, prestation: prestation.id, prestation_nom: prestation.nom, praticienne: d.praticienne,
    date: d.date, debut, fin: debut === null ? null : debut + prestation.duree, souhait: d.souhait, cliente: d.cliente,
    note: d.note, telephone_empreinte: await empreinteTelephone(s, du, d.cliente.telephone), recue_le: ctx.maintenant,
  });
  if (d.type !== "rappel") {
    const apres = refusDemande(await contexte(s, du, curseur), d);
    if (apres) {
      await du.depot.retirer(id);
      return { ok: false, code: apres };
    }
  }
  // Demande purgée entre l'insertion et ici (contrôle de plus d'une minute) : jeton mort, on ne la promet pas.
  if (!(await du.depot.confirmer(id))) return { ok: false, code: "indisponible" };
  return { ok: true, id, jeton };
}
