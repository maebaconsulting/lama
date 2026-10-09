/**
 * Interface des fournisseurs WhatsApp (sous-projet 7 § 3) : WAHA en vague 1,
 * API Meta en vague 3. Un fournisseur classe ses erreurs avec celles de la
 * file d'envoi : `TemporaryError` (réseau, passerelle injoignable, session
 * non connectée, limite de débit : la file relance) ou `PermanentError`
 * (numéro absent de WhatsApp, refus du fournisseur : « À envoyer à la main »).
 */

/** État montré à l'écran ; `phone` : numéro de l'institut quand la session est connectée. */
export type ProviderState = "connecte" | "qr" | "demarrage" | "deconnecte" | "injoignable" | "erreur";
export interface ProviderStatus { state: ProviderState; phone?: string }

/** Fichier joint à un message : ticket, avoir ou reçu d'acompte en PDF (vague 2), photo d'un produit (images des produits). */
export interface DocumentFile { name: string; mime: string; data: Buffer }

export interface WhatsappProvider {
  status(): Promise<ProviderStatus>;
  /** `to` : numéro international en chiffres seuls (`237699123456`). */
  sendText(to: string, text: string): Promise<void>;
  /** Vague 2 : ticket, avoir et reçu d'acompte en PDF, produits au moment de l'envoi. */
  sendDocument?(to: string, file: DocumentFile, caption: string): Promise<void>;
  /** Images des produits : photo vue comme une photo par la cliente, texte en légende. */
  sendImage?(to: string, file: DocumentFile, caption: string): Promise<void>;
}

/** Commandes de session d'une passerelle liée au téléphone de l'institut (WAHA) : l'API Meta n'en a pas. */
export interface LinkedSession {
  start(): Promise<void>;
  logout(): Promise<void>;
  /** QR code à scanner, image en base64. */
  qr(): Promise<{ mimetype: string; data: string }>;
}
