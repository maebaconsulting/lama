/**
 * Routes de la clôture de caisse (sous-projet 5 § 6.3) : caisse d'un jour,
 * clôture (idempotente par `request_id`), ticket de clôture de 80 mm.
 * Gérante et réception seulement (`permissions.ts`).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { localize, msg, requestLang } from "../messages.ts";
import { getSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { doualaDay, formatFrancs } from "../../shared/caisse.ts";
import { closeTill, closingRows, dayReport, parseClosingRequest, readClosing, validDay } from "./cloture.ts";
import { documentLogo, renderRows } from "./ticket-pdf.ts";
import { SaleError } from "./vente.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountClotureRoutes(app: OpenAPIHono<any>): void {
  const storage = (c: { env: { STORAGE: unknown } }) => c.env.STORAGE as StorageBinding;

  // Caisse d'un jour (`?date=`, aujourd'hui à Douala par défaut) : clôtures, période ouverte, documents.
  app.get("/api/cash/day", (c) => {
    const now = nowOf(c);
    const day = c.req.query("date") ?? doualaDay(now);
    if (!validDay(day)) return c.json({ error: msg(c, "vente.date") }, 400);
    return c.json(storage(c).transaction!((db) => dayReport(db, day, now)));
  });

  // Clôture de la période ouverte d'un jour : résumé recalculé par le serveur, personne et heure enregistrées.
  app.post("/api/cash/closings", async (c) => {
    const account = currentAccount(c);
    const body = await c.req.json().catch(() => ({}));
    const now = nowOf(c);
    try {
      const req = parseClosingRequest(body);
      const result = storage(c).transaction!((db) => closeTill(db, req, { now, accountId: account.id }));
      const closing = storage(c).transaction!((db) => readClosing(db, result.id))!;
      if (result.replay) return c.json({ closing }, 200);
      const sign = closing.difference < 0 ? "\u2212" : closing.difference > 0 ? "+" : "";
      const target = `${closing.day} n°\u00a0${closing.seq} (${sign}${formatFrancs(Math.abs(closing.difference))}\u00a0F)`;
      await logAudit({ accountId: account.id, action: "caisse.cloture", target, ip: clientIp(c), now });
      return c.json({ closing }, 201);
    } catch (error) {
      if (error instanceof SaleError) return c.json({ error: localize(c, error.message), ...error.extra }, error.status);
      throw error;
    }
  });

  // Ticket de clôture de 80 mm, dans la langue de l'écran qui l'imprime (document interne, pas une pièce fiscale).
  app.get("/api/cash/closings/:id/pdf", async (c) => {
    const id = Number(c.req.param("id"));
    const closing = storage(c).transaction!((db) => readClosing(db, id));
    if (!closing) return c.json({ error: msg(c, "cloture.introuvable") }, 404);
    try {
      const identity = { nom: await getSetting<string>("institut.nom"), adresse: await getSetting<string>("institut.adresse"), marque_documents: await getSetting<string>("marque.documents") };
      const logo = await documentLogo();
      const name = `cloture-${closing.day}-${closing.seq}`;
      const pdf = await renderRows(closingRows(closing, identity, requestLang(c), { logo: logo !== null }), { title: name, author: identity.nom, date: closing.closed_at }, { logo });
      const disposition = c.req.query("telecharger") === "1" ? "attachment" : "inline";
      return c.body(new Uint8Array(pdf), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${name}.pdf"`,
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      console.error(error instanceof Error ? error : String(error));
      return c.json({ error: msg(c, "cloture.pdf_echec") }, 500);
    }
  });
}
