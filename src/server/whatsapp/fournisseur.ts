/**
 * Interface des fournisseurs WhatsApp (sous-projet 7 § 3) : WAHA (passerelle liée au téléphone) et l'API
 * officielle de Meta (WhatsApp Business, spec du 21/10/2026). Un fournisseur classe ses erreurs avec celles
 * de la file d'envoi : `TemporaryError` (réseau, passerelle injoignable, session non connectée, limite de
 * débit : la file relance) ou `PermanentError` (numéro absent de WhatsApp, refus du fournisseur : « À
 * envoyer à la main »).
 */
import type { Lang } from "../messages.ts";
import type { TemplateKind, ValeursModele } from "./textes.ts";

/** État montré à l'écran ; `phone` : numéro de l'institut quand la session (ou le compte) est connectée. */
export type ProviderState = "connecte" | "qr" | "demarrage" | "deconnecte" | "injoignable" | "erreur";
export interface ProviderStatus { state: ProviderState; phone?: string }

/** Fichier joint à un message : ticket, avoir ou reçu d'acompte en PDF (vague 2), photo d'un produit (images des produits). */
export interface DocumentFile { name: string; mime: string; data: Buffer }

/** Accusé d'un envoi : identifiant du message chez le fournisseur (Meta : `wamid`), gardé avec l'envoi (W-7). */
export interface SendReceipt { id: string }

/** Message avec modèle (API officielle de Meta, W-16, W-17) : type, langue de la cliente, valeurs nommées, en-tête éventuel. */
export interface TemplateMessage {
  modele: TemplateKind;
  lang: Lang;
  valeurs: ValeursModele;
  entete?: { type: "document" | "image"; file: DocumentFile };
}

export interface WhatsappProvider {
  status(): Promise<ProviderStatus>;
  /** `to` : numéro international en chiffres seuls (`237699123456`). */
  sendText(to: string, text: string): Promise<SendReceipt | void>;
  /** Vague 2 : ticket, avoir et reçu d'acompte en PDF, produits au moment de l'envoi. */
  sendDocument?(to: string, file: DocumentFile, caption: string): Promise<SendReceipt | void>;
  /** Images des produits : photo vue comme une photo par la cliente, texte en légende. */
  sendImage?(to: string, file: DocumentFile, caption: string): Promise<SendReceipt | void>;
  /** API officielle de Meta : message avec modèle approuvé, seul permis hors de la fenêtre de 24 h (W-16). */
  sendTemplate?(to: string, message: TemplateMessage): Promise<SendReceipt>;
}

/** Commandes de session d'une passerelle liée au téléphone de l'institut (WAHA) : l'API de Meta n'en a pas. */
export interface LinkedSession {
  start(): Promise<void>;
  logout(): Promise<void>;
  /** QR code à scanner, image en base64. */
  qr(): Promise<{ mimetype: string; data: string }>;
}
