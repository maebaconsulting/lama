import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import { countAccounts, type Account } from "./accounts.ts";
import { isConfirmed, PERSONAL_TTL_MS, resolveSession, type Session } from "./sessions.ts";
import { can } from "./permissions.ts";
import { hashToken } from "./crypto.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";
import { passageHttps, tournerPoste, tournerSession } from "./passage-https.ts";
import { ecranAccepte, ENTETE_VERSION_ECRAN } from "../../shared/version-ecran.ts";
import { nomCookie } from "../formation/mode.ts";

/** Noms de base des cookies ; le nom réel dépend de l'écoute (`cookieName`). */
export const SESSION_COOKIE = "lama_session";
export const DEVICE_COOKIE = "lama_poste";
const PUBLIC = new Set(["GET /api/auth/state", "POST /api/auth/install", "POST /api/auth/login", "GET /api/auth/roster", "POST /api/auth/pin", "GET /api/institut/logos/clair", "GET /api/institut/logos/sombre"]);

let maintenance = false;
export function setMaintenance(on: boolean): void { maintenance = on; }
export function isMaintenance(): boolean { return maintenance; }

export function clientIp(c: Context): string {
  return c.req.header("x-lama-ip") ?? "";
}

/**
 * Vrai si la requête est arrivée en https (distribution D-08) : en-tête
 * interne posé par `boot.ts` selon l'écoute, toujours écrasé (jamais celui
 * du client). Les cookies sont alors `Secure`.
 */
export function isHttps(c: Context): boolean {
  return c.req.header("x-lama-https") === "1";
}

/**
 * Nom réel d'un cookie de lama (`SESSION_COOKIE`, `DEVICE_COOKIE`, et ceux de
 * la base de formation à venir) : en https, préfixe `__Host-` (le navigateur
 * exige alors `Secure`, `Path=/` et aucun `Domain`) ; en http, le nom nu.
 * Deux noms distincts, car une réponse http ne peut ni remplacer ni effacer
 * un cookie `Secure` du même nom : si lama retombe en http (certificat
 * illisible), le poste se reconnecte au lieu de rester bloqué.
 */
export function cookieName(c: Context, base: string): string {
  // Base de formation (D-15) : `lama_formation_…`, distinct de la vraie base servie à la même adresse.
  const nu = nomCookie(base);
  return isHttps(c) ? `__Host-${nu}` : nu;
}

/** Attributs communs des cookies de lama : jamais de `Domain`, `Secure` en https (conditions du préfixe `__Host-`). */
export function cookieOptions(c: Context): { httpOnly: true; sameSite: "Strict"; path: "/"; secure: boolean } {
  return { httpOnly: true, sameSite: "Strict", path: "/", secure: isHttps(c) };
}

/** Requêtes dont le cookie nu a déjà été effacé (un seul effacement par réponse). */
const effaces = new WeakMap<Context, Set<string>>();
/** Jetons promus pendant la requête (nouveau jeton du poste ou de la session), lus par les routes après l'intermédiaire. */
const promus = new WeakMap<Context, Map<string, string>>();

/** Efface le cookie nu `base` (Max-Age=0, sans `Secure`, Path=/), une seule fois par réponse. */
function effacerNu(c: Context, base: string): void {
  const deja = effaces.get(c) ?? new Set<string>();
  if (deja.has(base)) return;
  deja.add(base);
  effaces.set(c, deja);
  deleteCookie(c, nomCookie(base), { path: "/", httpOnly: true, sameSite: "Strict", secure: false });
}

/**
 * Lit un cookie de lama sous le nom de l'écoute (`cookieName`) : `value`.
 * Passage de http à https (décisions T3-3 à T3-6) : en https, le navigateur
 * envoie encore le cookie nu posé en http. À côté d'un cookie `__Host-`, il
 * ne sert plus à rien et il est effacé tout de suite. Seul, sa valeur est
 * rendue à part (`nu`), jamais comme `value`, et il n'est pas effacé ici :
 * seul l'intermédiaire peut la promouvoir (`promouvoir`, sous les conditions
 * de `passage-https.ts`), et il efface le cookie nu au moment où il tente la
 * promotion, jamais sur une réponse rendue avant (maintenance, X-Lama,
 * installation). Une fois promu, le nouveau jeton est rendu comme `value`.
 */
export function readCookie(c: Context, base: string): { value: string | undefined; nu: string | undefined } {
  const promu = promus.get(c)?.get(base);
  if (promu !== undefined) return { value: promu, nu: undefined };
  const value = getCookie(c, cookieName(c, base));
  if (!isHttps(c)) return { value, nu: undefined };
  const nu = getCookie(c, nomCookie(base));
  if (nu === undefined) return { value, nu: undefined };
  if (value !== undefined) {
    effacerNu(c, base);
    return { value, nu: undefined };
  }
  return { value: undefined, nu };
}

/**
 * Vrai si la requête porte un cookie de session de lama, sous son nom de l'écoute ou nu (passage de http
 * à https), sans le juger ni rien effacer : sert seulement à borner un corps avant l'authentification.
 */
export function porteCookieSession(c: Context): boolean {
  return getCookie(c, cookieName(c, SESSION_COOKIE)) !== undefined || getCookie(c, nomCookie(SESSION_COOKIE)) !== undefined;
}

/** Retient le nouveau jeton promu pour le reste de la requête (`readCookie`). */
function promouvoir(c: Context, base: string, token: string): void {
  const map = promus.get(c) ?? new Map<string, string>();
  map.set(base, token);
  promus.set(c, map);
}

// Le cookie du poste doit durer aussi longtemps que possible (l'appareil reste
// déclaré tant qu'il n'est pas révoqué) ; 400 jours est le plafond que les
// navigateurs (et le contrôle de hono) acceptent pour un `Max-Age`.
const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 3600;

/** Pose (ou repose) le cookie de poste avec le même jeton et les mêmes attributs. */
export function setDeviceCookie(c: Context, token: string): void {
  setCookie(c, cookieName(c, DEVICE_COOKIE), token, { ...cookieOptions(c), maxAge: DEVICE_COOKIE_MAX_AGE_S });
}

/**
 * Pose le cookie de session. Une session personnelle glisse de 14 jours à
 * chaque pose (installation, connexion, ou renouvellement dans l'intermédiaire
 * ci-dessous) ; un poste partagé garde un cookie de session, sans `Max-Age`.
 */
export function setSessionCookie(c: Context, token: string, kind: Session["kind"]): void {
  setCookie(c, cookieName(c, SESSION_COOKIE), token, {
    ...cookieOptions(c),
    ...(kind === "personnel" ? { maxAge: Math.floor(PERSONAL_TTL_MS / 1000) } : {}),
  });
}

export function currentAccount(c: Context): Account {
  const account = c.get("account") as Account | null;
  if (!account) throw new Error("Aucun compte dans le contexte\u00a0: route mal protégée.");
  return account;
}

/** Réponse 403 si le mot de passe n'a pas été retapé depuis moins de 5 minutes, sinon null. */
export function requireConfirmation(c: Context): Response | null {
  const session = c.get("session") as Session | null;
  if (session && isConfirmed(session, nowOf(c))) return null;
  return c.json({ error: msg(c, "acces.confirmation_requise"), code: "confirmation" }, 403);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installAuth(app: OpenAPIHono<any>): void {
  app.use("/api/*", async (c: Context, next: Next) => {
    // Écran d'une version que ce serveur n'accepte plus (PWA, P-05) : il recharge sa nouvelle version en lisant ce code.
    if (!ecranAccepte(c.req.header(ENTETE_VERSION_ECRAN))) return c.json({ error: msg(c, "acces.ecran_perime"), code: "ecran_perime" }, 409);
    c.set("account", null);
    c.set("session", null);
    c.set("device", null);
    const deviceCookie = readCookie(c, DEVICE_COOKIE);
    const sessionCookie = readCookie(c, SESSION_COOKIE);
    // Passage en https : un cookie nu n'est promu que s'il désigne un poste ou une session d'avant
    // le premier service en https, avec un jeton neuf ; sinon il est ignoré (cookie injecté en http).
    const depuis = deviceCookie.nu || sessionCookie.nu ? await passageHttps() : null;
    let deviceToken = deviceCookie.value;
    if (deviceToken === undefined && deviceCookie.nu) {
      // Promotion tentée : le cookie nu est effacé, qu'elle réussisse ou non.
      effacerNu(c, DEVICE_COOKIE);
      const neuf = await tournerPoste(deviceCookie.nu, depuis, nowOf(c));
      if (neuf) {
        promouvoir(c, DEVICE_COOKIE, neuf);
        setDeviceCookie(c, neuf);
        deviceToken = neuf;
      }
    }
    if (deviceToken) {
      const device = await get<{ id: number; name: string }>("SELECT id, name FROM devices WHERE token_hash = ? AND revoked = 0", [hashToken(deviceToken)]);
      if (device) c.set("device", device);
    }
    const method = c.req.method;
    // Chemin décodé, celui que le routeur de Hono utilise : les droits ne se jugent jamais sur le chemin encodé (`/loy%61lty`).
    const path = c.req.path;
    if (maintenance) return c.json({ error: msg(c, "acces.maintenance"), code: "maintenance" }, 503);
    if (method !== "GET" && method !== "HEAD" && c.req.header("X-Lama") !== "1") {
      return c.json({ error: msg(c, "requete.xlama_manquant") }, 403);
    }
    const isPublic = PUBLIC.has(`${method} ${path}`);
    if (!isPublic && (await countAccounts()) === 0) {
      return c.json({ error: msg(c, "acces.installation_requise"), code: "installation" }, 409);
    }
    let token = sessionCookie.value;
    let promue = false;
    if (token === undefined && sessionCookie.nu) {
      // Promotion tentée seulement ici, après les réponses rendues plus haut : un cookie nu reçu
      // pendant une maintenance n'est pas effacé et pourra être promu à la requête suivante.
      effacerNu(c, SESSION_COOKIE);
      const neuve = await tournerSession(sessionCookie.nu, depuis, nowOf(c));
      if (neuve) {
        promouvoir(c, SESSION_COOKIE, neuve.token);
        token = neuve.token;
        promue = true;
      }
    }
    if (token) {
      const resolved = await resolveSession(token, nowOf(c));
      if (resolved && "session" in resolved) {
        c.set("account", resolved.account);
        c.set("session", resolved.session);
        // Session glissante : chaque requête authentifiée reporte l'échéance
        // du cookie de 14 jours, comme `resolveSession` reporte déjà celle en base.
        // Session promue : son nouveau jeton est posé sous le nom `__Host-`, avec la durée de sa sorte.
        if (resolved.session.kind === "personnel" || promue) setSessionCookie(c, token, resolved.session.kind);
      } else if (resolved && "locked" in resolved && !isPublic) {
        return c.json({ error: msg(c, "acces.poste_verrouille"), code: "verrouille" }, 401);
      }
    }
    if (isPublic) return next();
    const account = c.get("account") as Account | null;
    if (!account) return c.json({ error: msg(c, "acces.connexion_requise"), code: "connexion" }, 401);
    if (!can(account.role, method, path)) return c.json({ error: msg(c, "acces.refuse") }, 403);
    return next();
  });
}
