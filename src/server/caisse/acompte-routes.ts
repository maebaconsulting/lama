/**
 * Routes des acomptes (sous-projet 5 § 6.2) : acomptes d'un rendez-vous,
 * encaissement d'un acompte (idempotent par `request_id`, fonction réglable,
 * désactivée par défaut), « Rembourser » ou « Garder » (gérante), reçu
 * d'acompte de 80 mm. Gérante et réception (`permissions.ts`) ; la
 * praticienne jamais (décision 18 de la vague 3a).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import { printAfterIssue } from "../impression/routes.ts";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { nowOf } from "../clock.ts";
import { localize, msg } from "../messages.ts";
import { publish } from "../realtime.ts";
import { getSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { formatMontantDocument } from "../../shared/montants.ts";
import { counterDeposits, depositsOf, issueDeposit, parseDepositRequest, parseSettleRequest, readDeposit, settleDeposit, type DepositRecord } from "./acompte.ts";
import { fiscalSnapshot, readSaleSettings, ticketFiscal } from "./routes.ts";
import { documentLogo, renderTicket } from "./ticket-pdf.ts";
import type { DepositFate, TicketDocument, TicketFiscal } from "./ticket.ts";
import { SaleError } from "./vente.ts";

/** Sort de l'acompte pour son reçu (V1-79) : rien tant qu'il attend, pour que le reçu de l'encaissement ne change jamais. */
export function depositFate(dep: DepositRecord): DepositFate | null {
  if (dep.status === "held" || dep.settled_at === null) return null;
  if (dep.status === "applied") return { kind: "applied", invoice: dep.applied_invoice_number ?? "", at: dep.settled_at };
  return { kind: dep.status, at: dep.settled_at };
}

/** Reçu d'acompte à imprimer (§ 5.1) : valeurs figées à l'encaissement, versements reçus seulement. */
export function depositTicket(dep: DepositRecord): TicketDocument {
  return {
    kind: "deposit", number: dep.number, issued_at: dep.issued_at, lang: dep.lang, fiscal: ticketFiscal(dep.fiscal as Partial<TicketFiscal>),
    client_name: dep.client_name, account_name: dep.account_name, lines: [],
    subtotal: dep.amount, discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "",
    total_ttc: dep.amount, total_ht: dep.amount, total_tva: 0,
    payments: dep.payments.filter((p) => p.amount > 0), tip: null,
    appointment: { date: dep.appointment.date, time: dep.appointment.time },
    fate: depositFate(dep),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountAcompteRoutes(app: OpenAPIHono<any>): void {
  const storage = (c: { env: { STORAGE: unknown } }) => c.env.STORAGE as StorageBinding;
  const refusal = (c: Parameters<typeof msg>[0], error: unknown) => {
    if (error instanceof SaleError) return c.json({ error: localize(c, error.message), ...error.extra }, error.status);
    throw error;
  };

  // Acomptes d'un rendez-vous (`?appointment_id=`), pour sa fiche et l'écran de vente ; ou ceux qu'une vente
  // au comptoir peut déduire pour une cliente (`?client_id=`, V1-78).
  app.get("/api/deposits", (c) => {
    const client = c.req.query("client_id");
    if (client !== undefined) {
      if (!/^[1-9]\d{0,9}$/.test(client)) return c.json({ error: msg(c, "vente.cliente_inconnue") }, 400);
      return c.json({ deposits: storage(c).transaction!((db) => counterDeposits(db, Number(client))) });
    }
    const id = c.req.query("appointment_id") ?? "";
    if (!/^[1-9]\d{0,9}$/.test(id)) return c.json({ error: msg(c, "vente.rdv_inconnu") }, 400);
    return c.json({ deposits: storage(c).transaction!((db) => depositsOf(db, Number(id))) });
  });

  app.get("/api/deposits/:id", (c) => {
    const id = Number(c.req.param("id"));
    const deposit = storage(c).transaction!((db) => readDeposit(db, id));
    if (!deposit) return c.json({ error: msg(c, "acompte.introuvable") }, 404);
    return c.json({ deposit });
  });

  // Encaisser un acompte : fonction activée par la gérante, rendez-vous à venir, reçu AC dans la transaction.
  app.post("/api/deposits", async (c) => {
    const account = currentAccount(c);
    const body = await c.req.json().catch(() => ({}));
    const now = nowOf(c);
    try {
      const req = parseDepositRequest(body);
      // Correctif 2 (tâche 2) : le rejeu est servi même si la gérante a désactivé les acomptes
      // depuis, pour qu'une réponse perdue reste retrouvable ; seul un nouvel acompte est refusé.
      const already = storage(c).transaction!((db) => db.prepare("SELECT id FROM deposits WHERE request_id = ?").get(req.request_id) as { id: number } | undefined);
      if (!already && !(await getSetting<boolean>("caisse.acomptes"))) return c.json({ error: msg(c, "acompte.desactive") }, 403);
      const settings = await readSaleSettings();
      const fiscal = await fiscalSnapshot(settings);
      const lang = await getSetting<"fr" | "en">("institut.langue");
      const result = storage(c).transaction!((db) => issueDeposit(db, req, { now, accountId: account.id, lang, fiscal, methods: settings.methods }));
      const deposit = storage(c).transaction!((db) => readDeposit(db, result.id))!;
      if (result.replay) return c.json({ deposit }, 200);
      await logAudit({ accountId: account.id, action: "acompte.encaisse", target: `${deposit.number} (${formatMontantDocument(deposit.amount, "fr")})`, ip: clientIp(c), now });
      publish({ resource: "appointments" });
      const printed = (body as { print?: unknown }).print === true ? await printAfterIssue(c, { kind: "deposit", id: result.id }) : {};
      return c.json({ deposit: { ...deposit, ...printed } }, 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  // « Rembourser » ou « Garder » l'acompte d'un rendez-vous annulé ou d'une cliente absente : gérante seulement.
  app.post("/api/deposits/:id/settle", async (c) => {
    const account = currentAccount(c);
    if (account.role !== "manager") return c.json({ error: msg(c, "acompte.reservee") }, 403);
    const body = await c.req.json().catch(() => ({}));
    const now = nowOf(c);
    try {
      const req = parseSettleRequest(Number(c.req.param("id")), body);
      const result = storage(c).transaction!((db) => settleDeposit(db, req, { now, accountId: account.id }));
      const deposit = storage(c).transaction!((db) => readDeposit(db, result.id))!;
      if (result.replay) return c.json({ deposit }, 200);
      const action = req.action === "refund" ? "acompte.rembourse" : "acompte.garde";
      await logAudit({ accountId: account.id, action, target: `${deposit.number} (${formatMontantDocument(deposit.amount, "fr")})`, ip: clientIp(c), now });
      publish({ resource: "appointments" });
      return c.json({ deposit }, 201);
    } catch (error) {
      return refusal(c, error);
    }
  });

  // Reçu d'acompte de 80 mm, dans la langue figée sur le reçu ; « Télécharger » par `?telecharger=1`.
  app.get("/api/deposits/:id/pdf", async (c) => {
    const id = Number(c.req.param("id"));
    const deposit = storage(c).transaction!((db) => readDeposit(db, id));
    if (!deposit) return c.json({ error: msg(c, "acompte.introuvable") }, 404);
    try {
      const render: typeof renderTicket = c.env?.RENDER_TICKET ?? renderTicket;
      const pdf = await render(depositTicket(deposit), { logo: await documentLogo() });
      const disposition = c.req.query("telecharger") === "1" ? "attachment" : "inline";
      return c.body(new Uint8Array(pdf), 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${deposit.number}.pdf"`,
        "Cache-Control": "private, no-store",
      });
    } catch (error) {
      console.error(error instanceof Error ? error : String(error));
      return c.json({ error: msg(c, "acompte.pdf_echec") }, 500);
    }
  });
}
