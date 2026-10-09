/**
 * Routes de la fidélité d'une cliente (mini CRM § 2, décision 18) : solde et
 * vingt dernières écritures pour la réception et la gérante ; correction à la
 * main par la gérante seule, motif obligatoire, inscrite au journal. Droits
 * dans `permissions.ts` ; écritures dans une transaction.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { msg } from "../messages.ts";
import type { StorageBinding } from "../storage.ts";
import { loyaltyBalance, loyaltyEntries, readLoyaltySettings, recordCorrection } from "./fidelite.ts";

const ID = /^[1-9]\d{0,9}$/;
const MAX_POINTS = 100_000;

/** Correction demandée : points entiers non nuls (100 000 au plus, dans un sens ou dans l'autre) et motif de 1 à 200 caractères. */
export function parseCorrection(input: unknown): { points: number; note: string } | { error: "fidelite.correction_points" | "fidelite.correction_motif" } {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const points = body.points;
  if (!Number.isInteger(points) || points === 0 || Math.abs(points as number) > MAX_POINTS) return { error: "fidelite.correction_points" };
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note === "" || note.length > 200) return { error: "fidelite.correction_motif" };
  return { points: points as number, note };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountLoyaltyRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/clients/:id/loyalty", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id) || !(await get("SELECT id FROM clients WHERE id = ?", [id]))) return c.json({ error: msg(c, "vente.cliente_inconnue") }, 404);
    const storage = c.env.STORAGE as StorageBinding;
    const clientId = Number(id);
    return c.json(storage.transaction!((db) => ({ balance: loyaltyBalance(db, clientId), entries: loyaltyEntries(db, clientId) })));
  });

  app.post("/api/clients/:id/loyalty", async (c) => {
    const account = currentAccount(c);
    const id = c.req.param("id");
    const client = ID.test(id) ? await get<{ name: string }>("SELECT name FROM clients WHERE id = ?", [id]) : null;
    if (!client) return c.json({ error: msg(c, "vente.cliente_inconnue") }, 404);
    // Fidélité désactivée : rien ne s'affiche (décision 11), aucune correction non plus.
    if (!(await readLoyaltySettings()).active) return c.json({ error: msg(c, "fidelite.inactive") }, 400);
    const parsed = parseCorrection(await c.req.json().catch(() => ({})));
    if ("error" in parsed) return c.json({ error: msg(c, parsed.error) }, 400);
    const now = nowOf(c);
    const clientId = Number(id);
    const storage = c.env.STORAGE as StorageBinding;
    const result = storage.transaction!((db) => {
      recordCorrection(db, { clientId, points: parsed.points, note: parsed.note, accountId: account.id, now });
      return { balance: loyaltyBalance(db, clientId), entries: loyaltyEntries(db, clientId) };
    });
    // Journal : le nom de la cliente et les points, jamais le motif (texte libre).
    await logAudit({ accountId: account.id, action: "fidelite.correction", target: `${client.name} (${parsed.points > 0 ? "+" : ""}${parsed.points})`, ip: clientIp(c), now });
    return c.json(result, 201);
  });
}
