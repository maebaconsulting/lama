/**
 * Routes des campagnes (mini CRM, décision 27), gérante seule
 * (`auth/permissions.ts`) : aperçu des destinataires, envoi, vingt dernières
 * campagnes. Journal : l'étiquette, jamais le texte.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { localize, msg } from "../messages.ts";
import { crmActive } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { readMessageSettings } from "../whatsapp/rendez-vous.ts";
import { campaignAudience, campaignInput, campaignTag, createCampaign, listCampaigns, recentDuplicate } from "./campagnes.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
const storageOf = (c: Ctx) => c.env.STORAGE as StorageBinding;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountCampaignRoutes(app: OpenAPIHono<any>): void {
  // Mini CRM désactivé (interrupteur général) : ni aperçu ni envoi ; la liste reste lisible.
  app.get("/api/campaigns/preview", async (c) => {
    if (!(await crmActive())) return c.json({ error: msg(c, "crm.inactif") }, 400);
    const tag = campaignTag(c.req.query("tag"));
    if (!tag) return c.json({ error: msg(c, "campagne.etiquette_requise") }, 400);
    const settings = await readMessageSettings();
    const audience = storageOf(c).transaction!((db) => campaignAudience(db, tag, settings));
    return c.json({ recipients: audience.recipients.length, excluded: audience.excluded });
  });

  app.get("/api/campaigns", (c) => c.json({ campaigns: storageOf(c).transaction!((db) => listCampaigns(db)) }));

  app.post("/api/campaigns", async (c) => {
    if (!(await crmActive())) return c.json({ error: msg(c, "crm.inactif") }, 400);
    const input = campaignInput((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
    if ("error" in input) return c.json({ error: localize(c, input.error) }, 400);
    const settings = await readMessageSettings();
    const account = currentAccount(c);
    const now = nowOf(c);
    const opts = { accountId: account.id, now };
    const replay = storageOf(c).transaction!((db) => recentDuplicate(db, input, opts));
    if (replay) return c.json(replay, 200);
    const created = storageOf(c).transaction!((db) => createCampaign(db, settings, input, opts));
    if (!created) return c.json({ error: msg(c, "campagne.aucune_destinataire") }, 400);
    await logAudit({ accountId: account.id, action: "campagne.envoyee", target: created.tag, ip: clientIp(c), now });
    return c.json(created, 201);
  });
}
