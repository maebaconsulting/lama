import type { OpenAPIHono } from "@hono/zod-openapi";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { isOnline } from "./connectivity.ts";
import { listOutbox, pendingCount, retry } from "./outbox.ts";
import { localize, msg } from "../messages.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountOutboxRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/outbox", async (c) => {
    const status = c.req.query("status");
    const items = await listOutbox(status || undefined);
    // Jamais la charge (texte des messages, numéros : sous-projet 7 § 1), ni la clé anti-doublon qui cite un rendez-vous.
    return c.json({
      items: items.map((i) => ({
        id: i.id, kind: i.kind, status: i.status, manual: i.manual, attempts: i.attempts, next_attempt_at: i.next_attempt_at,
        last_error: localize(c, i.last_error), created_at: i.created_at, sent_at: i.sent_at,
      })),
      online: isOnline(),
      pending: await pendingCount(),
    });
  });

  app.post("/api/outbox/:id/retry", async (c) => {
    const id = Number(c.req.param("id"));
    if (!(await retry(id, nowOf(c)))) return c.json({ error: msg(c, "envoi.non_relancable") }, 409);
    await logAudit({ accountId: currentAccount(c).id, action: "envoi.relance", target: String(id), ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });
}
