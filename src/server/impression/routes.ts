/**
 * Routes de l'impression directe (spec du 03/10/2026, § 1 et § 2) : imprimer
 * un document, ouvrir le tiroir-caisse, imprimer un ticket de test. Une panne
 * d'imprimante répond 409 avec sa raison traduite, jamais une erreur 5xx (que
 * l'écran prendrait pour une réponse perdue).
 */
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { clientIp, currentAccount } from "../auth/middleware.ts";
import { logAudit } from "../audit.ts";
import { mayReadInvoice } from "../caisse/routes.ts";
import { ticketInstant, type TicketRow } from "../caisse/ticket.ts";
import { nowOf } from "../clock.ts";
import { message, msg, requestLang, type MessageKey } from "../messages.ts";
import { getSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { OPEN_DRAWER, ticketBytes } from "./escpos.ts";
import { exclusive, sendToPrinter, type PrintFailure } from "./imprimante.ts";
import { PRINT_KINDS, paperLogo, printDocument, type PrintKind } from "./documents.ts";
import { marquerFormation } from "../formation/marque.ts";

const storage = (c: Context) => c.env.STORAGE as StorageBinding;

/** Adresse réglée, ou `null` si aucune imprimante n'est réglée. */
export async function printerAddress(): Promise<string | null> {
  const address = (await getSetting<string>("caisse.imprimante")).trim();
  return address || null;
}

const FAILURES: Record<PrintFailure, MessageKey> = { injoignable: "impression.injoignable", papier: "impression.papier", capot: "impression.capot" };

/** Réponse 409 d'une panne d'imprimante, ou d'une imprimante non réglée. */
function failure(c: Context, reason: PrintFailure | "non_reglee") {
  return c.json({ error: msg(c, reason === "non_reglee" ? "impression.non_reglee" : FAILURES[reason]), reason }, 409);
}

/**
 * Impression demandée avec un encaissement, un avoir ou un acompte (`print:
 * true`) : `{ printed: true }`, ou `{ print_error }` avec la raison traduite.
 * Jamais d'exception : le document est déjà enregistré.
 */
export async function printAfterIssue(c: Context, doc: { kind: PrintKind; id: number }): Promise<{ printed: true } | { print_error: string }> {
  const address = await printerAddress();
  if (!address) return { print_error: msg(c, "impression.non_reglee") };
  try {
    const result = await printDocument(storage(c), doc, address);
    if (result.ok) return { printed: true };
    return { print_error: msg(c, result.reason === "introuvable" ? "impression.injoignable" : FAILURES[result.reason]) };
  } catch (error) {
    console.error("Impression\u00a0:", error instanceof Error ? error.message : error);
    return { print_error: msg(c, "impression.injoignable") };
  }
}

/** Rangées du ticket de test : « lama », l'adresse réglée, l'heure, dans la langue de l'écran. */
function testRows(c: Context, address: string, now: number, withLogo: boolean): TicketRow[] {
  const lang = requestLang(c);
  // Base de formation (D-17) : l'imprimante est permise, le ticket de test porte « FORMATION » comme les autres.
  return marquerFormation([
    ...(withLogo ? [{ type: "logo" } as const] : []),
    { type: "text", text: "lama", style: "nom", align: "center" },
    { type: "rule" },
    { type: "text", text: message(lang, "ticket.test"), style: "titre", align: "center" },
    { type: "text", text: message(lang, "ticket.test_adresse", { adresse: address }), style: "detail", align: "center" },
    { type: "text", text: ticketInstant(now), style: "detail", align: "center" },
  ], lang);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mountPrintRoutes(app: OpenAPIHono<any>): void {
  app.post("/api/print/documents", async (c) => {
    const { kind, id } = (await c.req.json().catch(() => ({}))) as { kind?: unknown; id?: unknown };
    if (!PRINT_KINDS.includes(kind as PrintKind) || !Number.isInteger(id)) return c.json({ error: msg(c, "impression.document_type") }, 400);
    const account = currentAccount(c);
    const notFound = kind === "deposit" ? "acompte.introuvable" : "facture.introuvable";
    // La praticienne (encaissement par la praticienne activé) : les factures de ses propres rendez-vous seulement.
    if (account.role === "practitioner" && (kind !== "invoice" || !(await mayReadInvoice(c, id as number)))) return c.json({ error: msg(c, notFound) }, 404);
    const address = await printerAddress();
    if (!address) return failure(c, "non_reglee");
    const now = nowOf(c);
    const result = await printDocument(storage(c), { kind: kind as PrintKind, id: id as number }, address);
    if (!result.ok) return result.reason === "introuvable" ? c.json({ error: msg(c, notFound) }, 404) : failure(c, result.reason);
    if (result.duplicate) await logAudit({ accountId: account.id, action: "impression.duplicata", target: result.number, ip: clientIp(c), now });
    return c.json({ ok: true, duplicate: result.duplicate });
  });

  app.post("/api/print/drawer", async (c) => {
    const account = currentAccount(c);
    const address = await printerAddress();
    if (!address) return failure(c, "non_reglee");
    const sent = await exclusive(() => sendToPrinter(address, OPEN_DRAWER, { checkStatus: false }));
    if (!sent.ok) return failure(c, sent.reason);
    await logAudit({ accountId: account.id, action: "tiroir.ouverture", ip: clientIp(c), now: nowOf(c) });
    return c.json({ ok: true });
  });

  app.post("/api/print/test", async (c) => {
    const address = await printerAddress();
    if (!address) return failure(c, "non_reglee");
    const logo = await paperLogo();
    const sent = await exclusive(() => sendToPrinter(address, ticketBytes(testRows(c, address, nowOf(c), logo !== null), { logo }), { checkStatus: true }));
    if (!sent.ok) return failure(c, sent.reason);
    return c.json({ ok: true });
  });
}
