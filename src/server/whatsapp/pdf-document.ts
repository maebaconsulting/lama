/**
 * PDF d'un document envoyé par WhatsApp (sous-projet 7, vague 2) : ticket
 * d'une facture, avoir ou reçu d'acompte, produit au moment de l'envoi
 * depuis les valeurs figées du document (mêmes fonctions que « Imprimer »
 * et « Télécharger »), jamais gardé dans la file d'envoi.
 */
import { depositTicket } from "../caisse/acompte-routes.ts";
import { readDeposit } from "../caisse/acompte.ts";
import { invoiceTicket, readInvoice } from "../caisse/routes.ts";
import { documentLogo, renderTicket } from "../caisse/ticket-pdf.ts";
import type { StorageBinding } from "../storage.ts";
import type { DocumentFile } from "./fournisseur.ts";
import type { DocumentKind } from "./textes.ts";

const PDF = "application/pdf";

/**
 * Le fichier ; `"annulee"` pour une facture entièrement reprise par un avoir
 * (le ticket d'une vente annulée n'a plus lieu de partir, l'avoir peut
 * l'être) ; `null` si le document n'existe pas ou n'est pas de ce type.
 */
export async function renderDocument(storage: StorageBinding, doc: { kind: DocumentKind; id: number }): Promise<DocumentFile | "annulee" | null> {
  if (doc.kind === "deposit") {
    const deposit = storage.transaction!((db) => readDeposit(db, doc.id));
    if (!deposit) return null;
    return { name: `${deposit.number}.pdf`, mime: PDF, data: await renderTicket(depositTicket(deposit), { logo: await documentLogo() }) };
  }
  const invoice = await readInvoice(doc.id);
  if (!invoice || invoice.kind !== (doc.kind === "credit" ? "credit_note" : "invoice")) return null;
  if (doc.kind === "invoice" && invoice.cancelled === true) return "annulee";
  return { name: `${String(invoice.number)}.pdf`, mime: PDF, data: await renderTicket(invoiceTicket(invoice), { logo: await documentLogo() }) };
}
