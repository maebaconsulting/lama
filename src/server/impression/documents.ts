/**
 * Impression d'un document (spec du 03/10/2026, § 1 et § 2) : facture, avoir
 * ou reçu d'acompte, depuis ses valeurs figées (mêmes rangées que le PDF).
 * Lecture du compteur, envoi et incrément se font d'un seul tenant (un envoi
 * à la fois dans le processus) : deux impressions simultanées du même
 * document donnent un original et un duplicata, jamais deux originaux.
 */
import { depositTicket } from "../caisse/acompte-routes.ts";
import { readDeposit } from "../caisse/acompte.ts";
import { invoiceTicket, readInvoice } from "../caisse/routes.ts";
import { ticketRows, type TicketDocument } from "../caisse/ticket.ts";
import { readPrintImage } from "../institut/logos.ts";
import { message } from "../messages.ts";
import { getSetting } from "../settings.ts";
import type { StorageBinding } from "../storage.ts";
import { ticketBytes } from "./escpos.ts";
import { unpackPrintImage, type PrintImage } from "./image-logo.ts";
import { exclusive, sendToPrinter, type PrintFailure } from "./imprimante.ts";

export type PrintKind = "invoice" | "credit" | "deposit";
export const PRINT_KINDS: readonly PrintKind[] = ["invoice", "credit", "deposit"];

export type DocumentPrint =
  | { ok: true; number: string; duplicate: boolean }
  | { ok: false; reason: PrintFailure | "introuvable" };

/** Document à imprimer, son numéro, sa table et son compteur ; `null` s'il n'existe pas ou n'est pas de ce type. */
async function load(storage: StorageBinding, doc: { kind: PrintKind; id: number }): Promise<{ ticket: TicketDocument; table: "invoices" | "deposits"; count: number } | null> {
  if (doc.kind === "deposit") {
    const deposit = storage.transaction!((db) => readDeposit(db, doc.id));
    if (!deposit) return null;
    return { ticket: depositTicket(deposit), table: "deposits", count: printCount(storage, "deposits", doc.id) };
  }
  const invoice = await readInvoice(doc.id);
  if (!invoice || invoice.kind !== (doc.kind === "credit" ? "credit_note" : "invoice")) return null;
  return { ticket: invoiceTicket(invoice), table: "invoices", count: printCount(storage, "invoices", doc.id) };
}

/** Impressions réussies d'un document (0 s'il n'a jamais été imprimé). */
export function printCount(storage: StorageBinding, table: "invoices" | "deposits", id: number): number {
  const row = storage.transaction!((db) => db.prepare("SELECT count FROM print_counts WHERE doc = ? AND doc_id = ?").get(table, id)) as { count: number } | undefined;
  return row?.count ?? 0;
}

/** Image du logo pour le ticket papier : seulement si la gérante l'a demandé et qu'elle est lisible ; jamais d'exception. */
export async function paperLogo(): Promise<PrintImage | null> {
  try {
    if ((await getSetting<boolean>("caisse.imprimer_logo")) !== true) return null;
    const packed = await readPrintImage();
    return packed ? unpackPrintImage(packed) : null;
  } catch {
    return null;
  }
}

/** Imprime le document sur l'imprimante de `address` ; ne lève jamais pour une panne d'imprimante. */
export function printDocument(storage: StorageBinding, doc: { kind: PrintKind; id: number }, address: string): Promise<DocumentPrint> {
  return exclusive(async () => {
    const found = await load(storage, doc);
    if (!found) return { ok: false, reason: "introuvable" } as const;
    const duplicate = found.count > 0;
    // La rangée logo n'existe que si l'image est utilisable : « Logo seul » ne retire jamais le nom sans image imprimée.
    const logo = await paperLogo();
    const bytes = ticketBytes(ticketRows(found.ticket, { logo: logo !== null }), { ...(duplicate ? { duplicate: message(found.ticket.lang, "ticket.duplicata") } : {}), logo });
    const sent = await sendToPrinter(address, bytes, { checkStatus: true });
    if (!sent.ok) return sent;
    storage.transaction!((db) => db.prepare("INSERT INTO print_counts (doc, doc_id, count) VALUES (?, ?, 1) ON CONFLICT (doc, doc_id) DO UPDATE SET count = count + 1").run(found.table, doc.id));
    return { ok: true, number: found.ticket.number, duplicate } as const;
  });
}
