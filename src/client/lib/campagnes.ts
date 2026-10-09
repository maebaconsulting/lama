/**
 * Campagnes à l'écran (mini CRM, décisions 27 et 29) : types des réponses
 * de `/api/campaigns`, offre du bouton, contrôle des textes (mêmes règles
 * que le serveur) et coût en SMS. Fonctions pures, testées sous Node.
 */
import { estimateTemplate } from "../../shared/sms.ts";
import type { Role } from "./auth-types.ts";
import type { Key, Values } from "../i18n/translate.ts";
import type { WhatsappText } from "./whatsapp.ts";

/** Variables d'un texte de campagne (`whatsapp/textes.ts`, `CLIENT_VARIABLES`). */
export const CAMPAIGN_VARIABLES = ["prenom", "nom", "institut", "telephone"] as const;
const MAX_TEXT = 1000;

/** Aperçu (`GET /api/campaigns/preview`). */
export interface CampaignPreview { recipients: number; excluded: number }

/** Une campagne de la liste (`GET /api/campaigns`, gérante) ; envois comptés dans la file. */
export interface CampaignRow {
  id: number;
  tag: string;
  text_fr: string;
  text_en: string;
  recipients: number;
  excluded: number;
  created_at: number;
  sent: number;
  pending: number;
  manual: number;
}

/** « Écrire à ces clientes » : la gérante seulement, et seulement quand une étiquette est choisie. */
export function campaignOffer(role: Role, tag: string | null): boolean {
  return role === "manager" && tag !== null && tag.trim() !== "";
}

/**
 * Textes de départ de la fenêtre : le français vient du modèle « campagne »,
 * l'anglais part vide pour que le texte écrit par la gérante parte à toutes ;
 * le modèle anglais n'est proposé qu'à la demande (`enModel`).
 */
export function campaignDrafts(texts: WhatsappText[]): { fr: string; en: string; enModel: string } {
  const model = (lang: "fr" | "en") => texts.find((x) => x.kind === "campagne" && x.lang === lang)?.value ?? "";
  return { fr: model("fr"), en: "", enModel: model("en") };
}

/** Premier problème des textes avant l'envoi, ou `null` : français obligatoire, 1000 caractères, variables connues. */
export function campaignProblem(textFr: string, textEn: string): { key: Key; values?: Values } | null {
  if (!textFr.trim()) return { key: "campagne.probleme.texte_vide" };
  for (const text of [textFr, textEn]) {
    if (text.trim().length > MAX_TEXT) return { key: "campagne.probleme.texte_long", values: { max: MAX_TEXT } };
    for (const [, name] of text.matchAll(/\{([^{}]*)\}/g)) {
      if (!(CAMPAIGN_VARIABLES as readonly string[]).includes(name)) return { key: "campagne.probleme.variable", values: { variable: `{${name}}` } };
    }
  }
  return null;
}

/** SMS d'un message (le plus long des deux textes, variables à leur longueur type) et au plus pour toutes les destinataires. */
export function campaignSms(textFr: string, textEn: string, recipients: number): { perMessage: number; total: number } {
  const perMessage = Math.max(estimateTemplate(textFr.trim()), textEn.trim() ? estimateTemplate(textEn.trim()) : 0);
  return { perMessage, total: perMessage * recipients };
}
