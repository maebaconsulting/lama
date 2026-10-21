/**
 * Ticket, avoir et reçu d'acompte par WhatsApp (sous-projet 7, vague 2) :
 * mise en file d'un document pour sa cliente, dans une transaction déjà
 * ouverte (celle de la vente pour la case cochée à l'encaissement). La file
 * ne garde que la nature et le numéro du document : le PDF est produit au
 * moment de l'envoi (`pdf-document.ts`). Clé `wa:ticket:<type>:<id>:<n>`,
 * `n` étant le numéro de l'envoi demandé pour ce document.
 */
import type { Lang } from "../messages.ts";
import { enqueueSync } from "../outbox/outbox.ts";
import type { Database } from "../storage.ts";
import { WHATSAPP_KIND, type WhatsappMessage } from "./envoi.ts";
import { normalizePhone } from "./numeros.ts";
import type { MessageSettings } from "./rendez-vous.ts";
import { documentLabel, firstName, renderTemplate, type DocumentKind, type ValeursModele } from "./textes.ts";

export const DOCUMENT_KINDS: DocumentKind[] = ["invoice", "credit", "deposit"];

/** Refus d'une mise en file : document inconnu, facture entièrement reprise, cliente absente, sans numéro, numéro impossible. */
export type DocumentRefusal = "introuvable" | "annulee" | "sans_cliente" | "sans_numero" | "numero_invalide";

/** Numéro et cliente d'un document, et si une facture est entièrement reprise par un avoir. */
export function documentFacts(db: Database, kind: DocumentKind, id: number): { number: string; clientId: number | null; cancelled: boolean } | null {
  if (kind === "deposit") {
    const row = db.prepare("SELECT number, client_id FROM deposits WHERE id = ?").get(id) as { number: string; client_id: number | null } | undefined;
    return row ? { number: row.number, clientId: row.client_id, cancelled: false } : null;
  }
  const row = db.prepare(
    "SELECT i.number, i.client_id, COALESCE(b.cancelled, 0) AS cancelled FROM invoices i LEFT JOIN invoice_balance b ON b.invoice_id = i.id WHERE i.id = ? AND i.kind = ?",
  ).get(id, kind === "credit" ? "credit_note" : "invoice") as { number: string; client_id: number | null; cancelled: number } | undefined;
  return row ? { number: row.number, clientId: row.client_id, cancelled: row.cancelled === 1 } : null;
}

/**
 * Met le document en file pour sa cliente, quel que soit son accord aux
 * envois automatiques (geste volontaire : case cochée ou bouton). `strict`
 * (bouton) : un numéro impossible à normaliser est refusé tout de suite ;
 * sinon (case à l'encaissement, la vente ne doit jamais échouer pour cela)
 * le message part avec un numéro vide et finit dans « À envoyer à la main ».
 */
export function queueDocumentMessage(
  db: Database, s: MessageSettings, doc: { kind: DocumentKind; id: number }, opts: { now: number; createdBy: number | null; strict: boolean },
): { ok: true; number: string } | { ok: false; refusal: DocumentRefusal } {
  const facts = documentFacts(db, doc.kind, doc.id);
  if (!facts) return { ok: false, refusal: "introuvable" };
  if (facts.cancelled) return { ok: false, refusal: "annulee" };
  const client = facts.clientId === null ? undefined : db.prepare("SELECT id, name, phone, language FROM clients WHERE id = ?").get(facts.clientId) as
    { id: number; name: string; phone: string | null; language: string } | undefined;
  if (!client) return { ok: false, refusal: "sans_cliente" };
  if (!(client.phone ?? "").trim()) return { ok: false, refusal: "sans_numero" };
  const to = normalizePhone(client.phone ?? "", s.indicatif) ?? "";
  if (!to && opts.strict) return { ok: false, refusal: "numero_invalide" };
  const lang: Lang = client.language === "fr" || client.language === "en" ? client.language : s.lang;
  const valeurs: ValeursModele = {
    prenom: firstName(client.name), nom: client.name.trim(), document: documentLabel(doc.kind, facts.number, lang), institut: s.institut, telephone: s.telephone,
  };
  const text = renderTemplate(s.texts.ticket[lang], valeurs);
  const prefix = `wa:ticket:${doc.kind}:${doc.id}:`;
  // Numéro suivant le plus grand déjà pris (pas le nombre de lignes : les envois partis sont purgés après
  // 90 jours, les échecs restent, un compte retomberait sur un numéro pris et l'envoi serait ignoré sans bruit).
  const last = (db.prepare("SELECT MAX(CAST(substr(dedupe_key, ?) AS INTEGER)) AS n FROM outbox WHERE dedupe_key LIKE ?")
    .get(prefix.length + 1, `${prefix}%`) as { n: number | null }).n ?? 0;
  const message: WhatsappMessage = { to, lang, text, modele: "ticket", valeurs, document: { kind: doc.kind, id: doc.id }, origin: { type: "ticket", clientId: client.id } };
  enqueueSync(db, { kind: WHATSAPP_KIND, payload: message, dedupeKey: `${prefix}${last + 1}`, createdBy: opts.createdBy, now: opts.now });
  return { ok: true, number: facts.number };
}
