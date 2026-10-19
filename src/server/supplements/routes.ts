/**
 * Routes des suppléments (spec du 18/10/2026 § 3) : liste des suppléments possibles d'une
 * prestation et « Recopier vers… » (gérante, `permissions.ts`) ; suppléments d'un rendez-vous
 * (gérante et réception, tâche 6). Chaque écriture se fait dans une transaction : un refus
 * (`SupplementError`) n'écrit rien.
 */
import type { Context } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import { localize, msg, requestLang } from "../messages.ts";
import type { StorageBinding } from "../storage.ts";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { describeConflicts } from "../scheduling.ts";
import { formatMontantDocument } from "../../shared/montants.ts";
import { SUPPLEMENTS_PAR_RENDEZ_VOUS } from "../../shared/supplements.ts";
import { editSupplements, parseSupplement, type SupplementInput } from "./rendez-vous.ts";
import { copyList, parseList, parseTargets, readList, SupplementError, writeList } from "./catalogue.ts";

const storage = (c: Context) => c.env.STORAGE as StorageBinding;

/** Identifiant du chemin (`:id`), ou `null` s'il est mal formé. */
const idOf = (c: Context): number | null => {
  const raw = c.req.param("id") ?? "";
  return /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
};

/** Réponse traduite d'un refus des suppléments ; toute autre erreur est relancée. */
function refus(c: Context, error: unknown): Response {
  if (error instanceof SupplementError) return c.json({ error: localize(c, error.message) }, error.status);
  throw error;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountSupplementRoutes(app: OpenAPIHono<any>): void {
  app.put("/api/services/:id/supplements", async (c) => {
    const id = idOf(c);
    if (id === null) return c.json({ error: msg(c, "vente.prestation_inconnue", { id: c.req.param("id") ?? "" }) }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { items?: unknown };
    try {
      const items = parseList(body.items);
      const supplements = storage(c).transaction!((db) => {
        writeList(db, id, items);
        return readList(db, id);
      });
      return c.json({ supplements });
    } catch (error) {
      return refus(c, error);
    }
  });

  app.post("/api/services/:id/supplements/copie", async (c) => {
    const id = idOf(c);
    if (id === null) return c.json({ error: msg(c, "vente.prestation_inconnue", { id: c.req.param("id") ?? "" }) }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { targets?: unknown };
    try {
      const targets = parseTargets(body.targets);
      const copied = storage(c).transaction!((db) => copyList(db, id, targets));
      return c.json({ copied });
    } catch (error) {
      return refus(c, error);
    }
  });

  /**
   * Suppléments d'un rendez-vous (spec § 3.3) : la liste complète remplace l'ancienne, tant
   * que le rendez-vous n'est pas encaissé. Chaque supplément libre ajouté va au journal.
   */
  app.put("/api/appointments/:id/supplements", async (c) => {
    const id = idOf(c);
    if (id === null) return c.json({ error: msg(c, "rdv.introuvable") }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { supplements?: unknown; allow_conflict?: unknown };
    const now = nowOf(c);
    try {
      if (!Array.isArray(body.supplements) || body.supplements.length > SUPPLEMENTS_PAR_RENDEZ_VOUS) throw new SupplementError(400, "supplement.invalide");
      const inputs = body.supplements.map((raw): { serviceRow: number; input: SupplementInput } => {
        const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        if (!Number.isInteger(r.appointment_service_id)) throw new SupplementError(400, "rdv.prestation_absente");
        return { serviceRow: r.appointment_service_id as number, input: parseSupplement(r) };
      });
      const outcome = storage(c).transaction!((db) => editSupplements(db, id, inputs, body.allow_conflict === true));
      if ("absent" in outcome) return c.json({ error: msg(c, "rdv.introuvable") }, 404);
      if ("paid" in outcome) return c.json({ error: msg(c, "rdv.supplements_encaisse") }, 409);
      if ("conflicts" in outcome) {
        const staff = await get<{ name: string }>("SELECT name FROM staff WHERE id = ?", [outcome.staffId]);
        return c.json({ error: describeConflicts(staff?.name ?? "", outcome.conflicts, "book", requestLang(c)), conflicts: outcome.conflicts }, 409);
      }
      for (const libre of outcome.added) {
        await logAudit({
          accountId: currentAccount(c).id, action: "supplement.libre", ip: clientIp(c), now,
          target: `${outcome.identifier} · ${formatMontantDocument(libre.price, "fr")} · ${libre.label_fr}`,
        });
      }
      return c.json({ ok: true, end_time: outcome.end_time, total_price: outcome.total_price });
    } catch (error) {
      // Comme à la création : tout refus d'un supplément est un 400 (404 et 409 disent autre chose ici).
      if (error instanceof SupplementError) return c.json({ error: localize(c, error.message) }, 400);
      throw error;
    }
  });
}
