/**
 * WhatsApp à l'écran (sous-projet 7) : état de la session, lien « Ouvrir
 * WhatsApp » du secours un clic, libellés. Fonctions pures, testées sous Node.
 */
import type { Lang } from "../i18n/translate.ts";
import { translate, type Key } from "../i18n/translate.ts";

export type WhatsappState = "connecte" | "qr" | "demarrage" | "deconnecte" | "injoignable" | "erreur";
export interface WhatsappStatus { provider: "aucun" | "waha" | "meta"; state?: WhatsappState; phone?: string }
export type MessageType = "confirmation" | "rappel" | "ticket" | "libre" | "produit" | "anniversaire" | "absence" | "campagne" | "transfert" | "en_ligne";

/** Document joint à un message (vague 2) : facture (ticket), avoir, reçu d'acompte. */
export type DocumentKind = "invoice" | "credit" | "deposit";
export interface MessageDocument { kind: DocumentKind; id: number; number: string }

/** Produit recommandé (images des produits) : nom et version de sa photo, `null` sans photo. */
export interface MessageProduct { id: number; name: string; image_version: number | null }

/** Message à envoyer à la main (`GET /api/whatsapp/manual`, réception et gérante seulement). */
export interface ManualItem {
  id: number;
  type: MessageType;
  client_id: number | null;
  client_name: string;
  created_at: number;
  reason: string;
  to: string;
  text: string;
  /** Ticket, avoir ou reçu : PDF à télécharger, que la réception joint dans WhatsApp. */
  document?: MessageDocument;
  /** Produit recommandé : photo à télécharger (si elle existe), que la réception joint elle-même dans WhatsApp. */
  product?: MessageProduct;
}

/** PDF d'un document, en pièce jointe (même adresse que « Télécharger »). */
export function documentPdfPath(doc: { kind: DocumentKind; id: number }): string {
  return `/api/${doc.kind === "deposit" ? "deposits" : "invoices"}/${doc.id}/pdf?telecharger=1`;
}

/**
 * Case « Envoyer par WhatsApp » à l'encaissement (vague 2 ; SMS : spec du
 * 04/10/2026, ajustement 5) : proposée quand la cliente a un numéro et ne
 * reçoit pas ses messages par SMS (un document ne part jamais par SMS),
 * cochée d'office pour le canal « WhatsApp ».
 */
export function ticketChoice(client: { phone: string | null; channel: "whatsapp" | "sms" | "none" } | null): { offered: boolean; checked: boolean } {
  const offered = !!client && !!(client.phone ?? "").trim() && client.channel !== "sms";
  return { offered, checked: offered && client!.channel === "whatsapp" };
}

/** Lien « Ouvrir les SMS » (forme Android, la réception est sur Android) : appli SMS ouverte sur le numéro, message prérempli. */
export function smsLink(to: string, text: string): string {
  return `sms:+${to}?body=${encodeURIComponent(text)}`;
}

/** Texte d'un message modifiable par la gérante (`GET /api/whatsapp/texts`). */
export interface WhatsappText { key: string; kind: "confirmation" | "rappel" | "ticket" | "produit" | "anniversaire" | "absence" | "campagne" | "transfert" | "en_ligne_confirmation" | "en_ligne_autre_horaire" | "en_ligne_refus" | "en_ligne_rappel"; lang: Lang; value: string; default: string }

/** Lien du secours un clic : WhatsApp s'ouvre sur la conversation, message prérempli ; sans numéro, choix du contact. */
export function waLink(to: string, text: string): string {
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`;
}

const STATE_KEYS: Record<WhatsappState, Key> = {
  connecte: "whatsapp.etat.connecte",
  qr: "whatsapp.etat.qr",
  demarrage: "whatsapp.etat.demarrage",
  deconnecte: "whatsapp.etat.deconnecte",
  injoignable: "whatsapp.etat.injoignable",
  erreur: "whatsapp.etat.erreur",
};

/** WhatsApp Business : erreur et panne dites pour Meta ; « connecté » comme WAHA. */
const META_STATE_KEYS: Partial<Record<WhatsappState, Key>> = {
  erreur: "whatsapp.etat.meta_erreur",
  injoignable: "whatsapp.etat.meta_injoignable",
};

/**
 * Numéro international lisible (vague 2) : Cameroun groupé comme on l'écrit
 * (+237 699 00 00 00), espaces insécables pour qu'il ne se coupe jamais ;
 * autre indicatif : chiffres seuls après le +, faute de connaître leur découpage.
 */
export function groupPhone(digits: string): string {
  if (!digits) return "";
  const m = /^237(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(digits);
  return m ? ["+237", ...m.slice(1)].join("\u00a0") : `+${digits}`;
}

export function statusText(status: WhatsappStatus, lang: Lang): string {
  if (status.provider === "aucun" || !status.state) return translate(lang, "whatsapp.etat.aucun");
  const key = (status.provider === "meta" ? META_STATE_KEYS[status.state] : undefined) ?? STATE_KEYS[status.state];
  return translate(lang, key, { numero: groupPhone(status.phone ?? "") });
}

/** État à écrire en rouge : session à reprendre (WAHA ; le QR code et le démarrage sont des étapes normales), ou WhatsApp Business non connecté. */
export function statusAlarming(status: WhatsappStatus): boolean {
  if (status.provider === "meta") return status.state !== "connecte";
  return status.provider === "waha" && (status.state === "deconnecte" || status.state === "injoignable" || status.state === "erreur");
}

/** Bandeau d'alerte (spec § 4) : fournisseur WAHA et session non connectée. */
export function sessionAlert(status: WhatsappStatus | null): boolean {
  return status?.provider === "waha" && status.state !== "connecte";
}

const TYPE_KEYS: Record<MessageType, Key> = {
  confirmation: "a_envoyer.type.confirmation",
  rappel: "a_envoyer.type.rappel",
  ticket: "a_envoyer.type.ticket",
  libre: "a_envoyer.type.libre",
  produit: "a_envoyer.type.produit",
  anniversaire: "a_envoyer.type.anniversaire",
  absence: "a_envoyer.type.absence",
  campagne: "a_envoyer.type.campagne",
  transfert: "a_envoyer.type.transfert",
  en_ligne: "a_envoyer.type.en_ligne",
};

export function manualTypeLabel(type: MessageType, lang: Lang): string {
  return translate(lang, TYPE_KEYS[type] ?? "a_envoyer.type.libre");
}

/** Pièce à joindre à la main : PDF d'un document, photo d'un produit, ou rien (texte seul, SMS possible). */
export function manualAttachment(item: Pick<ManualItem, "document" | "product">): "document" | "photo" | null {
  if (item.document) return "document";
  return item.product && item.product.image_version !== null ? "photo" : null;
}

/** Libellé du bouton d'ouverture : la pièce est téléchargée avant d'ouvrir WhatsApp. */
export function manualOpenKey(item: Pick<ManualItem, "document" | "product">): Key {
  const attachment = manualAttachment(item);
  if (attachment === "document") return "a_envoyer.ouvrir_document";
  if (attachment === "photo") return "a_envoyer.ouvrir_photo";
  return "a_envoyer.ouvrir";
}
