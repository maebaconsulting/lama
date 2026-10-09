/**
 * Routes du transfert des rendez-vous d'une praticienne absente (spec du
 * 04/10/2026), gérante et réception (`auth/permissions.ts`) : proposition,
 * puis transfert groupé tout ou rien (contrôle et écriture dans une seule
 * transaction). Journal : une ligne par transfert groupé, jamais le texte d'un message.
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { logAudit } from "./audit.ts";
import { clientIp, currentAccount } from "./auth/middleware.ts";
import { nowOf } from "./clock.ts";
import { publish } from "./realtime.ts";
import { localize, message, msg } from "./messages.ts";
import type { StorageBinding } from "./storage.ts";
import { checkTransfer, readPeriod, staffRow, transferInput, transferProposal, writeTransfers, type TransferConflict } from "./transferts.ts";
import { readMessageSettings } from "./whatsapp/rendez-vous.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<any>;
const storageOf = (c: Ctx) => c.env.STORAGE as StorageBinding;

type Outcome =
  | { status: "unknown" }
  | { status: "conflicts"; conflicts: TransferConflict[] }
  | { status: "ok"; moved: number; queued: number; fromName: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountTransferRoutes(app: OpenAPIHono<any>): void {
  app.get("/api/transfers/proposal", (c) => {
    const staffId = Number(c.req.query("staff_id"));
    if (!Number.isInteger(staffId) || staffId <= 0) return c.json({ error: msg(c, "transfert.praticienne_inconnue") }, 400);
    const now = nowOf(c);
    const period = readPeriod(c.req.query("from"), c.req.query("to"), now);
    if ("error" in period) return c.json({ error: msg(c, period.error) }, 400);
    const proposal = storageOf(c).transaction!((db) => transferProposal(db, staffId, period, now));
    if (!proposal) return c.json({ error: msg(c, "transfert.praticienne_inconnue") }, 404);
    return c.json(proposal, 200);
  });

  app.post("/api/transfers", async (c) => {
    const input = transferInput((await c.req.json().catch(() => ({}))) as Record<string, unknown>);
    if ("error" in input) return c.json({ error: localize(c, input.error) }, 400);
    const account = currentAccount(c);
    const now = nowOf(c);
    // Lus avant la transaction (lecture asynchrone) ; contrôle et écriture ensuite, d'un seul tenant.
    const settings = await readMessageSettings();
    const outcome = storageOf(c).transaction!((db): Outcome => {
      const from = staffRow(db, input.from_staff_id);
      if (!from) return { status: "unknown" };
      const checked = checkTransfer(db, input, now);
      if ("conflicts" in checked) return { status: "conflicts", conflicts: checked.conflicts };
      const { moved, queued } = writeTransfers(db, checked.moves, { fromName: from.name, by: account.display_name, notify: input.notify, settings, now });
      return { status: "ok", moved, queued, fromName: from.name };
    });
    if (outcome.status === "unknown") return c.json({ error: msg(c, "transfert.praticienne_inconnue") }, 404);
    if (outcome.status === "conflicts") {
      const conflicts = outcome.conflicts.map((x) => ({ appointment_id: x.appointment_id, identifier: x.identifier, reason: localize(c, x.reason) }));
      return c.json({ error: msg(c, "transfert.rien_ecrit"), conflicts }, 409);
    }
    // La pastille « À envoyer à la main » suit la file : le middleware ne publie que « appointments ».
    if (outcome.queued > 0) publish({ resource: "outbox" });
    if (outcome.moved > 0) {
      await logAudit({
        accountId: account.id, action: "rdv.transfert", ip: clientIp(c), now,
        target: message(settings.lang, outcome.moved === 1 ? "transfert.journal_groupe.one" : "transfert.journal_groupe.other", { de: outcome.fromName, nombre: outcome.moved }),
      });
    }
    return c.json({ moved: outcome.moved }, 200);
  });
}
