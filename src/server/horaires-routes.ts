import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Semaine } from "../shared/horaires.ts";
import { getSetting } from "./settings.ts";

/** Horaires de l'institut pour griser l'agenda (spec du 16/10/2026 § 4.1) : gérante, réception et praticienne. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountHorairesRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/horaires", async (c) => c.json({ institut: await getSetting<Semaine>("institut.horaires") }));
}
