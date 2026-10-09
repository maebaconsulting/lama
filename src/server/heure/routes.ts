import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import { clientIp, currentAccount, requireConfirmation } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";
import { DERNIER_DOCUMENT_SQL, heureRecule } from "./garde.ts";
import type { HorlogeSysteme } from "./horloge.ts";

/** Heure acceptée : entre le 1er janvier 2026 et le 1er janvier 2100 (une saisie absurde ne part jamais au système). */
const MIN = Date.UTC(2026, 0, 1);
const MAX = Date.UTC(2100, 0, 1);

const DATE = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Africa/Douala" });
const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Africa/Douala" });

/** Date et heure de Douala à la seconde, pour le journal : `05/10/2026 14:32:10`. */
export function instantSecondes(ms: number): string {
  return `${DATE.format(ms)} ${TIME.format(ms)}`;
}

function horloge(c: Context): HorlogeSysteme | null {
  return (c.env as { HORLOGE?: HorlogeSysteme }).HORLOGE ?? null;
}

/**
 * Heure du serveur (distribution D-11, D-13), pour l'administrateur et la
 * gérante : l'instant du serveur, celui du dernier document numéroté et la
 * caisse bloquée si l'heure a reculé. L'écran compare aussi l'en-tête `Date`
 * de chaque réponse à l'heure de l'appareil (`client/lib/heure.ts`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountHeureRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/heure", async (c) => {
    const now = nowOf(c);
    const derniere = (await get<{ at: number | null }>(DERNIER_DOCUMENT_SQL))?.at ?? null;
    return c.json({ serveur: now, derniere_facture: derniere, caisse_bloquee: heureRecule(derniere, now) });
  });

  /**
   * Correction de l'heure (distribution D-12) : administrateur, mot de passe
   * retapé ; `heure` en millisecondes (l'heure de l'appareil, ou une heure
   * saisie). Inscrite au journal avec l'ancienne et la nouvelle heure.
   */
  app.post("/api/heure", async (c) => {
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const body = (await c.req.json().catch(() => ({}))) as { heure?: unknown };
    const heure = body.heure;
    if (typeof heure !== "number" || !Number.isInteger(heure) || heure < MIN || heure >= MAX) {
      return c.json({ error: msg(c, "heure.invalide") }, 400);
    }
    const systeme = horloge(c);
    const ancienne = nowOf(c);
    const compte = currentAccount(c).id;
    const ip = clientIp(c);
    /** Toute tentative refusée est journalisée avec l'heure demandée et le motif. */
    const journalRefus = (motif: string) => logAudit({ accountId: compte, action: "heure.refus", target: `${instantSecondes(heure)} (${motif})`, ip, now: ancienne });
    if (!systeme) {
      await journalRefus("absente");
      return c.json({ error: msg(c, "heure.indisponible"), code: "indisponible" }, 503);
    }
    const fait = await systeme.regler(heure);
    if (!fait.ok) {
      await journalRefus(fait.motif);
      if (fait.motif === "autorisation") return c.json({ error: msg(c, "heure.autorisation"), code: "autorisation" }, 503);
      if (fait.motif === "absente") return c.json({ error: msg(c, "heure.indisponible"), code: "indisponible" }, 503);
      return c.json({ error: msg(c, "heure.echec", { detail: fait.detail }), code: "echec" }, 502);
    }
    const synchro = fait.synchro !== false;
    const cible = `${instantSecondes(ancienne)} → ${instantSecondes(heure)}${synchro ? "" : " ; synchro non rétablie"}`;
    await logAudit({ accountId: compte, action: "heure.reglee", target: cible, ip, now: heure });
    const derniere = (await get<{ at: number | null }>(DERNIER_DOCUMENT_SQL))?.at ?? null;
    return c.json({ ancienne, nouvelle: heure, ...(synchro ? {} : { synchro: false }), derniere_facture: derniere, caisse_bloquee: heureRecule(derniere, heure) });
  });
}
