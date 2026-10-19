import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import { AccountError, authenticatePassword, countAccounts, createAccount, type AuthResult, type Language } from "./accounts.ts";
import { confirmSession, createSession, deleteSession, posteIdleMs, type Session } from "./sessions.ts";
import { clientIp, cookieName, cookieOptions, currentAccount, readCookie, SESSION_COOKIE, setSessionCookie } from "./middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";
import { crmActive, getSetting, setSetting } from "../settings.ts";
import { chargerDevise } from "../devise.ts";
import { DEVISE_DEFAUT, estCodeDevise } from "../../shared/devises.ts";
import { logoVersions } from "../institut/logos.ts";
import { configDevise } from "../../shared/devise-active.ts";
import { estDemoPublique, estFormation } from "../formation/mode.ts";
import { COMPTES_DEMO } from "../formation/demo.ts";

const TIME = new Intl.DateTimeFormat("fr-CM", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala", hourCycle: "h23" });

/** Traduit un échec d'authentification en réponse HTTP et l'inscrit au journal. */
export async function refuse(c: Context, result: Extract<AuthResult, { ok: false }>, target: string, accountId: number | null) {
  const now = nowOf(c);
  if (result.reason === "locked") {
    await logAudit({ accountId, action: "connexion.blocage", target, ip: clientIp(c), now });
    return c.json({ error: msg(c, "connexion.bloque", { heure: TIME.format(result.locked_until ?? now) }), locked_until: result.locked_until }, 423);
  }
  await logAudit({ accountId, action: "connexion.echec", target, ip: clientIp(c), now });
  if (result.reason === "inactive") return c.json({ error: msg(c, "connexion.desactive") }, 403);
  return c.json({ error: msg(c, "connexion.incorrect") }, 401);
}

async function body(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountAuthRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/auth/state", async (c) => {
    const account = c.get("account");
    const session = c.get("session") as Session | null;
    return c.json({
      installed: (await countAccounts()) > 0,
      account: account ?? null,
      device: c.get("device") ?? null,
      // Le délai d'un poste permet à l'écran de se verrouiller de lui-même,
      // sans attendre la prochaine requête (le serveur reste juge).
      session: session ? { kind: session.kind, idle_ms: session.kind === "poste" ? await posteIdleMs() : null } : null,
      // Réglages lus avant la session : marque à l'écran, nom de l'institut et versions des logos (vague B), rien d'autre.
      marque: {
        ecran: (await getSetting<string>("marque.ecran")) === "logo" ? "logo" : "logo_nom",
        nom: await getSetting<string>("institut.nom"),
        logos: await logoVersions(),
      },
      devise: configDevise(),
      // Interrupteur général du mini CRM, pour l'écran de chaque rôle (la praticienne et la réception n'ont pas
      // accès à /api/settings) ; seulement une fois connecté.
      crm: account ? { active: await crmActive() } : null,
      // Base de formation (D-18) : l'écran montre son bandeau sur chaque écran, celui d'entrée compris.
      formation: estFormation(),
      // Démonstration publique (DP-03) : les trois comptes publics, montrés à l'écran de connexion ; jamais l'administration.
      demo: estDemoPublique() ? { comptes: COMPTES_DEMO.map(({ login, role, motDePasse, pin }) => ({ login, role, mot_de_passe: motDePasse, pin })) } : null,
    });
  });

  app.post("/api/auth/install", async (c) => {
    // Base de formation (D-16) : les comptes sont créés par le technicien (`sudo lama-formation --comptes`), jamais par l'écran.
    if (estFormation()) return c.json({ error: msg(c, "formation.installation"), code: "formation" }, 409);
    if ((await countAccounts()) > 0) return c.json({ error: msg(c, "installation.deja_faite") }, 409);
    const b = await body(c);
    const devise = b.devise === undefined ? DEVISE_DEFAUT : b.devise;
    if (!estCodeDevise(devise)) return c.json({ error: msg(c, "reglage.devise") }, 400);
    try {
      // Insertion conditionnelle : deux installations simultanées passent
      // toutes deux le test ci-dessus, une seule crée l'administrateur.
      const account = await createAccount({
        display_name: String(b.display_name ?? ""), login: String(b.login ?? ""), role: "admin",
        password: String(b.password ?? ""), pin: b.pin ? String(b.pin) : null,
        language: b.language === undefined ? undefined : (String(b.language) as Language),
      }, nowOf(c), { onlyIfEmpty: true });
      await setSetting("institut.devise", devise, account.id, nowOf(c));
      await chargerDevise();
      // Import différé : seed.ts importe « ./db.js », qui ne se résout qu'assemblé (les essais qui chargent ce module sans assemblage doivent pouvoir le faire).
      await (await import("../seed.ts")).convertirFichesDemo(devise);
      const { token } = await createSession(account.id, "personnel", null, nowOf(c));
      setSessionCookie(c, token, "personnel");
      await logAudit({ accountId: account.id, action: "installation", target: account.login, ip: clientIp(c), now: nowOf(c) });
      return c.json({ account }, 201);
    } catch (error) {
      if (error instanceof AccountError) return c.json({ error: msg(c, error.key, error.values) }, error.status as 400);
      throw error;
    }
  });

  app.post("/api/auth/login", async (c) => {
    const b = await body(c);
    const login = String(b.login ?? "");
    const result = await authenticatePassword(login, String(b.password ?? ""), nowOf(c));
    if (!result.ok) {
      // Au journal, seul un identifiant existant est inscrit : ce qui a été
      // tapé peut être un mot de passe saisi dans le mauvais champ (§ 3.1).
      const known = await get("SELECT id FROM accounts WHERE login = ?", [login]);
      return refuse(c, result, known ? login : "(identifiant inconnu)", null);
    }
    const { token } = await createSession(result.account.id, "personnel", null, nowOf(c));
    setSessionCookie(c, token, "personnel");
    await logAudit({ accountId: result.account.id, action: "connexion", target: login, ip: clientIp(c), now: nowOf(c) });
    return c.json({ account: result.account });
  });

  app.post("/api/auth/logout", async (c) => {
    const token = readCookie(c, SESSION_COOKIE).value;
    const account = c.get("account");
    if (token) await deleteSession(token);
    deleteCookie(c, cookieName(c, SESSION_COOKIE), cookieOptions(c));
    if (account) await logAudit({ accountId: account.id, action: "deconnexion", ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });

  app.get("/api/auth/me", (c) => {
    const session = c.get("session") as Session;
    return c.json({ account: currentAccount(c), session: { kind: session.kind, confirmed_until: session.confirmed_until } });
  });

  app.post("/api/auth/confirm", async (c) => {
    const account = currentAccount(c);
    const session = c.get("session") as Session;
    const result = await authenticatePassword(account.login, String((await body(c)).password ?? ""), nowOf(c));
    if (!result.ok) return refuse(c, result, account.login, account.id);
    const confirmed_until = await confirmSession(session.id, nowOf(c));
    await logAudit({ accountId: account.id, action: "confirmation", ip: clientIp(c), now: nowOf(c) });
    return c.json({ confirmed_until });
  });
}
