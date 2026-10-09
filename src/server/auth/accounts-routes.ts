import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { AccountError, authenticatePassword, createAccount, getAccount, listAccounts, unlockAccount, updateAccount, type Account, type AccountPatch, type Language, type Role, type Theme } from "./accounts.ts";
import { clientIp, currentAccount, requireConfirmation } from "./middleware.ts";
import { refuse } from "./routes.ts";
import { deleteSessionsOf } from "./sessions.ts";
import { listAudit, logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";
import { compteDemoFige } from "../formation/demo.ts";
import { estDemoPublique } from "../formation/mode.ts";

const TEAM: Role[] = ["reception", "practitioner"];
const DEFAULT_AUDIT_LIMIT = 200;

/** Numéro de compte de l'adresse : décimal strict (jamais `+1`, ` 1` ni `1e0`), 0 sinon (aucun compte ne porte ce numéro). */
const idOf = (raw: string | undefined): number => (/^[1-9]\d{0,9}$/.test(raw ?? "") ? Number(raw) : 0);
const MAX_AUDIT_LIMIT = 1000;

/** L'administrateur gère tout ; la gérante, son équipe (et elle-même, sans changer de rôle). */
function mayManage(actor: Account, target: { id?: number; role: Role }, newRole?: Role): boolean {
  if (actor.role === "admin") return true;
  if (actor.role !== "manager") return false;
  if (target.id === actor.id) return newRole === undefined || newRole === actor.role;
  return TEAM.includes(target.role) && (newRole === undefined || TEAM.includes(newRole));
}

async function json(c: Context): Promise<Record<string, unknown>> {
  return (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
}

function accountError(c: Context, error: unknown) {
  if (error instanceof AccountError) return c.json({ error: msg(c, error.key, error.values) }, error.status as 400);
  throw error;
}

/** Entier borné, ou la valeur par défaut si absent ou invalide (jamais `NaN` dans une requête SQL). */
function boundedInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  if (raw === undefined || !Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

/** Entier valide, ou `undefined` si absent ou invalide. */
function optionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountAccountRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/accounts", async (c) => {
    const actor = currentAccount(c);
    const all = await listAccounts();
    return c.json({ accounts: actor.role === "admin" ? all : all.filter((a) => a.id === actor.id || TEAM.includes(a.role)) });
  });

  app.post("/api/accounts", async (c) => {
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const actor = currentAccount(c);
    const b = await json(c);
    const role = String(b.role) as Role;
    if (!mayManage(actor, { role })) return c.json({ error: msg(c, "compte.creation_interdite") }, 403);
    try {
      const account = await createAccount({
        display_name: String(b.display_name ?? ""), login: String(b.login ?? ""), role,
        password: String(b.password ?? ""), pin: b.pin ? String(b.pin) : null, staff_id: b.staff_id ? Number(b.staff_id) : null,
        language: b.language === undefined ? undefined : (String(b.language) as Language),
      }, nowOf(c));
      await logAudit({ accountId: actor.id, action: "compte.creation", target: account.login, ip: clientIp(c), now: nowOf(c) });
      return c.json({ account }, 201);
    } catch (error) {
      return accountError(c, error);
    }
  });

  app.put("/api/accounts/:id", async (c) => {
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const actor = currentAccount(c);
    const target = await getAccount(idOf(c.req.param("id")));
    if (!target) return c.json({ error: msg(c, "compte.introuvable") }, 404);
    // Démonstration publique (DP-06) : contrôle sur le compte résolu, second verrou après l'intermédiaire de `protections-demo.ts`.
    if (estDemoPublique() && compteDemoFige(target.login)) return c.json({ error: msg(c, "demo.compte_fige"), code: "demo" }, 409);
    const b = await json(c);
    const patch: AccountPatch = {};
    if (b.display_name !== undefined) patch.display_name = String(b.display_name);
    if (b.role !== undefined) patch.role = String(b.role) as Role;
    if (b.staff_id !== undefined) patch.staff_id = b.staff_id === null ? null : Number(b.staff_id);
    if (b.active !== undefined) patch.active = b.active ? 1 : 0;
    if (b.password !== undefined) patch.password = String(b.password);
    if (b.pin !== undefined) patch.pin = b.pin === null ? null : String(b.pin);
    if (b.language !== undefined) patch.language = String(b.language) as Language;
    if (b.theme !== undefined) patch.theme = String(b.theme) as Theme;
    if (!mayManage(actor, target, patch.role)) return c.json({ error: msg(c, "compte.modification_interdite") }, 403);
    if (target.id === actor.id && patch.active === 0) return c.json({ error: msg(c, "compte.desactivation_soi") }, 400);
    try {
      const account = await updateAccount(target.id, patch);
      if (patch.active === 0 || patch.password !== undefined) await deleteSessionsOf(target.id);
      await logAudit({ accountId: actor.id, action: "compte.modification", target: account.login, ip: clientIp(c), now: nowOf(c) });
      return c.json({ account });
    } catch (error) {
      return accountError(c, error);
    }
  });

  app.post("/api/accounts/:id/unlock", async (c) => {
    const actor = currentAccount(c);
    const target = await getAccount(idOf(c.req.param("id")));
    if (!target) return c.json({ error: msg(c, "compte.introuvable") }, 404);
    if (!mayManage(actor, target)) return c.json({ error: msg(c, "compte.deblocage_interdit") }, 403);
    await unlockAccount(target.id);
    await logAudit({ accountId: actor.id, action: "compte.deblocage", target: target.login, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });

  app.put("/api/auth/me", async (c) => {
    const actor = currentAccount(c);
    // Second verrou du gel des comptes publics (le premier est l'intermédiaire de la démonstration).
    if (compteDemoFige(actor.login)) return c.json({ error: msg(c, "demo.compte_fige"), code: "demo" }, 409);
    const b = await json(c);
    const check = await authenticatePassword(actor.login, String(b.current_password ?? ""), nowOf(c));
    if (!check.ok) return refuse(c, check, actor.login, actor.id);
    try {
      const patch: AccountPatch = {};
      if (b.password !== undefined) patch.password = String(b.password);
      if (b.pin !== undefined) patch.pin = String(b.pin);
      const account = await updateAccount(actor.id, patch);
      await logAudit({ accountId: actor.id, action: "compte.secret", ip: clientIp(c), now: nowOf(c) });
      return c.json({ account });
    } catch (error) {
      return accountError(c, error);
    }
  });

  // Sa propre langue (spec § 3.2) : tout compte connecté, quel que soit son
  // rôle, sans mot de passe ni journal (préférence d'affichage, pas un droit).
  app.put("/api/auth/me/language", async (c) => {
    const actor = currentAccount(c);
    const b = await json(c);
    try {
      const account = await updateAccount(actor.id, { language: String(b.language ?? "") as Language });
      return c.json({ account });
    } catch (error) {
      return accountError(c, error);
    }
  });

  // Son propre thème (spec § 3.2) : mêmes règles que la langue, tout compte
  // connecté, sans mot de passe ni journal.
  app.put("/api/auth/me/theme", async (c) => {
    const actor = currentAccount(c);
    const b = await json(c);
    try {
      const account = await updateAccount(actor.id, { theme: String(b.theme ?? "") as Theme });
      return c.json({ account });
    } catch (error) {
      return accountError(c, error);
    }
  });

  app.get("/api/audit", async (c) => {
    const q = c.req.query();
    const entries = await listAudit({
      accountId: optionalInt(q.account_id),
      from: optionalInt(q.from),
      to: optionalInt(q.to),
      limit: boundedInt(q.limit, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT),
    });
    return c.json({ entries });
  });
}
