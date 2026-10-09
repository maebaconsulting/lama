/**
 * Routes de la base de formation (distribution D-19) : remise à zéro par
 * l'administrateur de la formation, mot de passe retapé. Comme une
 * restauration : maintenance annoncée à tous les écrans, puis redémarrage du
 * service, qui applique la demande avant d'ouvrir la base.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { requireConfirmation, setMaintenance } from "../auth/middleware.ts";
import type { BackupEnv } from "../backup/routes.ts";
import { MessageError, msg } from "../messages.ts";
import { publishMaintenance } from "../realtime.ts";
import { estFormation } from "./mode.ts";
import { demanderRemiseAZero } from "./remise-a-zero.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountFormationRoutes(app: OpenAPIHono<any>): void {
  app.post("/api/formation/remise-a-zero", async (c) => {
    // Jamais dans la vraie base : la route n'y existe pas.
    if (!estFormation()) return c.json({ error: msg(c, "formation.reservee") }, 404);
    const refused = requireConfirmation(c);
    if (refused) return refused;
    const b = (c.env as { BACKUP?: BackupEnv }).BACKUP;
    if (!b) throw new MessageError("sauvegarde.non_configurees");
    demanderRemiseAZero(b.dataDir);
    setMaintenance(true);
    publishMaintenance();
    b.requestRestart();
    return c.json({ ok: true, restart: true });
  });
}
