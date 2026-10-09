/**
 * Ticket PDF d'une facture (sous-projet 5 § 5.1) côté écran : adresses
 * « Imprimer » et « Télécharger », nom du fichier, et choix de la façon
 * d'imprimer selon l'appareil. Module pur, testé sous Node.
 */

/** Adresse du PDF d'une facture ; `download` : en pièce jointe, pour « Télécharger ». */
export function invoicePdfPath(id: number, download = false): string {
  return `/api/invoices/${id}/pdf${download ? "?telecharger=1" : ""}`;
}

/** Nom du fichier téléchargé : le numéro de la facture. */
export function pdfFileName(number: string): string {
  return `${number}.pdf`;
}

/**
 * Vrai si le navigateur imprime un PDF chargé dans un cadre caché (Chrome,
 * Edge, Firefox, Safari du Mac) : la boîte d'impression s'ouvre sans quitter
 * la caisse. Faux sur iPhone et iPad (un iPad se présente comme un Mac
 * tactile), où Safari imprimerait la page au lieu du PDF : le PDF s'ouvre
 * alors dans un onglet, et s'imprime par le bouton de partage.
 */
export function printsInFrame(userAgent: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return !ios;
}

/** Ticket PDF à imprimer ou télécharger : son adresse et le nom du fichier téléchargé. */
export interface TicketSource {
  path: string;
  fileName: string;
}

/** Ticket d'une facture ou d'un avoir, nommé à son numéro. */
export function invoiceSource(invoice: { id: number; number: string }): TicketSource {
  return { path: invoicePdfPath(invoice.id), fileName: pdfFileName(invoice.number) };
}

/** Reçu d'acompte (§ 6.2), nommé à son numéro : `AC-2026-000001.pdf`. */
export function depositSource(deposit: { id: number; number: string }): TicketSource {
  return { path: `/api/deposits/${deposit.id}/pdf`, fileName: pdfFileName(deposit.number) };
}

/** Ticket d'une clôture de caisse (§ 6.3) : `cloture-2026-09-28-1.pdf`. */
export function closingSource(closing: { id: number; day: string; seq: number }): TicketSource {
  return { path: `/api/cash/closings/${closing.id}/pdf`, fileName: `cloture-${closing.day}-${closing.seq}.pdf` };
}
