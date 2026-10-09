/**
 * Seuil d'absence (mini CRM, décision 6) : la fiche des trois rôles met en
 * avant « Absente depuis N jours » au-delà de `relances.absence_jours`,
 * réglage que seule la gérante lit dans `/api/settings`. Cette route ne
 * rend que ce nombre.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { getSetting } from "../settings.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountRelanceRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/relances/seuil", async (c) => c.json({ absence_days: await getSetting<number>("relances.absence_jours") }));
}
