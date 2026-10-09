/**
 * SMS à l'écran (spec du 04/10/2026, § 3) : état de la passerelle. Fonctions
 * pures, testées sous Node.
 */
import { translate, type Key, type Lang } from "../i18n/translate.ts";

export interface SmsStatus { provider: "aucun" | "passerelle"; state?: "joignable" | "identifiants" | "injoignable" }

const STATE_KEYS: Record<NonNullable<SmsStatus["state"]>, Key> = {
  joignable: "sms.etat.joignable",
  identifiants: "sms.etat.identifiants",
  injoignable: "sms.etat.injoignable",
};

/** Phrase d'état de la passerelle SMS. */
export function smsStatusText(status: SmsStatus, lang: Lang): string {
  if (status.provider === "aucun" || !status.state) return translate(lang, "sms.etat.aucun");
  return translate(lang, STATE_KEYS[status.state]);
}
