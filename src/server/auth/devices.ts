import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { query, run } from "@clawnify/db";
import { authenticatePin, pinAccountId } from "./accounts.ts";
import { hashToken, newToken } from "./crypto.ts";
import { clientIp, currentAccount, DEVICE_COOKIE, readCookie, setDeviceCookie, setSessionCookie } from "./middleware.ts";
import { refuse } from "./routes.ts";
import { createSession, deleteSessionsOfDevice } from "./sessions.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";

function device(c: Context): { id: number; name: string } | null {
  return (c.get("device") as { id: number; name: string } | null) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountDeviceRoutes(app: OpenAPIHono<any>): void {
  app.post("/api/devices", async (c) => {
    const account = currentAccount(c);
    const name = String(((await c.req.json().catch(() => ({}))) as { name?: string }).name ?? "").trim() || "Poste partagé";
    const token = newToken();
    const result = await run("INSERT INTO devices (token_hash, name, created_by, created_at) VALUES (?, ?, ?, ?)", [hashToken(token), name, account.id, nowOf(c)]);
    setDeviceCookie(c, token);
    await logAudit({ accountId: account.id, action: "poste.declaration", target: name, ip: clientIp(c), now: nowOf(c) });
    return c.json({ device: { id: Number(result.lastInsertRowid), name } }, 201);
  });

  app.get("/api/devices", async (c) => {
    const devices = await query("SELECT id, name, created_at, last_seen_at, revoked FROM devices ORDER BY created_at DESC");
    return c.json({ devices });
  });

  app.delete("/api/devices/:id", async (c) => {
    const id = Number(c.req.param("id"));
    await run("UPDATE devices SET revoked = 1 WHERE id = ?", [id]);
    await deleteSessionsOfDevice(id);
    await logAudit({ accountId: currentAccount(c).id, action: "poste.revocation", target: String(id), ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });

  app.get("/api/auth/roster", async (c) => {
    if (!device(c)) return c.json({ error: msg(c, "poste.inconnu"), code: "poste_inconnu" }, 401);
    const rows = await query<{ id: number; display_name: string; role: string; locked_until: number | null }>(
      "SELECT id, display_name, role, locked_until FROM accounts WHERE active = 1 AND role != 'admin' AND pin_hash IS NOT NULL ORDER BY display_name COLLATE NOCASE",
    );
    // Compte bloqué (V1-07) : un simple drapeau pour la carte, jamais l'échéance du blocage.
    const now = nowOf(c);
    const accounts = rows.map(({ locked_until, ...account }) => ({ ...account, locked: locked_until !== null && locked_until > now }));
    return c.json({ device: device(c), accounts });
  });

  app.post("/api/auth/pin", async (c) => {
    const current = device(c);
    if (!current) return c.json({ error: msg(c, "poste.inconnu"), code: "poste_inconnu" }, 401);
    const b = (await c.req.json().catch(() => ({}))) as { account_id?: number; pin?: string };
    const accountId = Number(b.account_id);
    const result = await authenticatePin(accountId, String(b.pin ?? ""), nowOf(c));
    // Compte inexistant ou administrateur : même refus qu'un mauvais PIN, et le
    // journal ne porte jamais de numéro de compte qui n'existe pas.
    if (!result.ok) return refuse(c, result, String(b.account_id ?? ""), await pinAccountId(accountId));
    const { token } = await createSession(result.account.id, "poste", current.id, nowOf(c));
    setSessionCookie(c, token, "poste");
    // Reporte l'échéance du cookie de poste à chaque connexion, comme le
    // cookie de session personnelle glisse à chaque requête authentifiée :
    // un poste en service ne doit jamais perdre sa déclaration.
    const deviceToken = readCookie(c, DEVICE_COOKIE).value;
    if (deviceToken) setDeviceCookie(c, deviceToken);
    await logAudit({ accountId: result.account.id, action: "connexion.poste", target: current.name, ip: clientIp(c), now: nowOf(c) });
    return c.json({ account: result.account });
  });
}
