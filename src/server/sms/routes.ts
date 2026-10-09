/**
 * Routes SMS (spec du 04/10/2026, § 3) : état de la passerelle (administrateur
 * et gérante), SMS d'essai (administrateur). Le navigateur ne parle jamais au
 * téléphone passerelle : tout passe par lama.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { coded, decode, localize, msg, type Lang } from "../messages.ts";
import { getSetting } from "../settings.ts";
import { normalizePhone } from "../whatsapp/numeros.ts";
import { smsProviderFromSettings } from "./passerelle.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
/** `SMS_FETCH` : jamais posée en production ; les essais y mettent la fausse passerelle. */
export const smsFetchOf = (c: Ctx): typeof fetch => c.env?.SMS_FETCH ?? fetch;

export function mountSmsRoutes(app: OpenAPIHono<any>): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  app.get("/api/sms/status", async (c) => {
    const provider = await smsProviderFromSettings(smsFetchOf(c));
    if (!provider) return c.json({ provider: "aucun" });
    return c.json({ provider: "passerelle", ...(await provider.status()) });
  });

  app.post("/api/sms/test", async (c) => {
    const provider = await smsProviderFromSettings(smsFetchOf(c));
    if (!provider) return c.json({ error: msg(c, "sms.non_configure") }, 409);
    const { to } = (await c.req.json().catch(() => ({}))) as { to?: unknown };
    const number = typeof to === "string" ? normalizePhone(to, await getSetting<string>("whatsapp.indicatif")) : null;
    if (!number) return c.json({ error: msg(c, "whatsapp.numero_invalide") }, 400);
    const lang: Lang = (await getSetting<string>("institut.langue")) === "en" ? "en" : "fr";
    try {
      await provider.sendText(number, decode(lang, coded("sms.essai")));
    } catch (error) {
      return c.json({ error: localize(c, error instanceof Error ? error.message : String(error)) }, 502);
    }
    await logAudit({ accountId: currentAccount(c).id, action: "sms.essai", target: number, ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });
}
