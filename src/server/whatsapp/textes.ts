/**
 * Textes des messages WhatsApp (sous-projet 7 § 3, « Textes ») : textes par
 * défaut bilingues, modifiables par la gérante ; variables `{prenom}`,
 * `{nom}`, `{date}`, `{heure}`, `{prestation}`, `{institut}`, `{telephone}` ;
 * une variable inconnue est refusée à l'enregistrement. Vague 2 : texte
 * d'accompagnement d'un ticket, d'un avoir ou d'un reçu d'acompte, avec
 * `{document}` (« ticket F-2026-000012 ») à la place de la date et de la
 * prestation. Images des produits : texte d'un produit recommandé, avec
 * `{produit}` et `{prix}` à la place de la date et de la prestation.
 * Mini CRM (décision 28) : textes d'anniversaire, de relance d'absence et de
 * campagne, avec les seules variables de la cliente et de l'institut.
 * Transfert (spec du 04/10/2026) : variables d'une confirmation, plus
 * `{praticienne}` (prénom de la nouvelle praticienne).
 */
import { coded, type Lang } from "../messages.ts";

/** Variables d'une confirmation et d'un rappel. */
export const VARIABLES = ["prenom", "nom", "date", "heure", "prestation", "institut", "telephone"] as const;
/** Variables du texte qui accompagne un document. */
export const TICKET_VARIABLES = ["prenom", "nom", "document", "institut", "telephone"] as const;
/** Variables du texte d'un produit recommandé (images des produits, spec du 04/10/2026). */
export const PRODUCT_VARIABLES = ["prenom", "nom", "produit", "prix", "institut", "telephone"] as const;
/** Variables des relances et des campagnes (mini CRM, décision 28). */
export const CLIENT_VARIABLES = ["prenom", "nom", "institut", "telephone"] as const;
/** Variables du message de transfert (spec du 04/10/2026, décision 11) : celles d'une confirmation, plus la praticienne. */
export const TRANSFER_VARIABLES = [...VARIABLES, "praticienne"] as const;
export type Variable = (typeof VARIABLES)[number] | (typeof TICKET_VARIABLES)[number] | (typeof PRODUCT_VARIABLES)[number] | "praticienne";
export type TemplateKind = "confirmation" | "rappel" | "ticket" | "produit" | "anniversaire" | "absence" | "campagne" | "transfert";
export const TEMPLATE_KINDS: TemplateKind[] = ["confirmation", "rappel", "ticket", "produit", "anniversaire", "absence", "campagne", "transfert"];
export const MAX_TEXT = 1000;

/** Variables permises dans un texte de ce type. */
export function variablesOf(kind: TemplateKind): readonly string[] {
  if (kind === "ticket") return TICKET_VARIABLES;
  if (kind === "produit") return PRODUCT_VARIABLES;
  if (kind === "anniversaire" || kind === "absence" || kind === "campagne") return CLIENT_VARIABLES;
  if (kind === "transfert") return TRANSFER_VARIABLES;
  return VARIABLES;
}

/** Document envoyé : facture (ticket), avoir, reçu d'acompte (spec § 3, `WhatsappMessage.document`). */
export type DocumentKind = "invoice" | "credit" | "deposit";

const DOCUMENT_WORDS: Record<Lang, Record<DocumentKind, string>> = {
  fr: { invoice: "ticket", credit: "avoir", deposit: "reçu d'acompte" },
  en: { invoice: "receipt", credit: "credit note", deposit: "deposit receipt" },
};

/** Valeur de `{document}` : nature et numéro, dans la langue du message (« reçu d'acompte AC-2026-000001 »). */
export function documentLabel(kind: DocumentKind, number: string, lang: Lang): string {
  return `${DOCUMENT_WORDS[lang][kind]} ${number}`;
}

export const DEFAULT_TEXTS: Record<TemplateKind, Record<Lang, string>> = {
  confirmation: {
    fr: "Bonjour {prenom}, votre rendez-vous {prestation} est confirmé le {date} à {heure} chez {institut}. Pour tout changement, appelez le {telephone}.",
    en: "Hello {prenom}, your {prestation} appointment is confirmed for {date} at {heure} at {institut}. To change it, call {telephone}.",
  },
  rappel: {
    fr: "Bonjour {prenom}, nous vous rappelons votre rendez-vous {prestation} le {date} à {heure} chez {institut}. À bientôt\u00a0!",
    en: "Hello {prenom}, this is a reminder of your {prestation} appointment on {date} at {heure} at {institut}. See you soon!",
  },
  ticket: {
    fr: "Bonjour {prenom}, voici votre {document} de {institut}. Merci de votre confiance\u00a0!",
    en: "Hello {prenom}, here is your {document} from {institut}. Thank you for your trust!",
  },
  produit: {
    fr: "{prenom}, voici {produit} ({prix}) que nous vous recommandons chez {institut}.",
    en: "{prenom}, here is {produit} ({prix}), which we recommend at {institut}.",
  },
  // Mini CRM : sans « de {institut} » (élision impossible) ni {telephone} en fin
  // de phrase ; en français, sans ponctuation haute pour rester en GSM 7 bits (un SMS).
  anniversaire: {
    fr: "Bon anniversaire, {prenom}. {institut} vous souhaite une très belle journée.",
    en: "Happy birthday, {prenom}! {institut} wishes you a lovely day.",
  },
  absence: {
    fr: "Bonjour {prenom}, vous nous manquez. Nous serions ravis de vous accueillir à nouveau chez {institut}.",
    en: "Hello {prenom}, we miss you! We would love to welcome you back at {institut}.",
  },
  campagne: {
    fr: "Bonjour {prenom}, {institut} a le plaisir de vous annoncer ses nouveautés. Au plaisir de vous accueillir.",
    en: "Hello {prenom}, {institut} is pleased to share its latest news with you. We look forward to seeing you.",
  },
  // Transfert (décision 11) : la nouvelle date et la nouvelle heure, la praticienne par son prénom ; un SMS,
  // sans ponctuation à espace insécable (GSM 7 bits), comme les relances.
  transfert: {
    fr: "Bonjour {prenom}, votre rendez-vous {prestation} du {date} à {heure} chez {institut} sera assuré par {praticienne}.",
    en: "Hello {prenom}, your {prestation} appointment on {date} at {heure} at {institut} will be with {praticienne}.",
  },
};

/** Clé du réglage qui porte un texte : `whatsapp.texte.rappel.fr`. */
export const textSetting = (kind: TemplateKind, lang: Lang) => `whatsapp.texte.${kind}.${lang}`;

/** Problème d'un texte à enregistrer (forme codée), ou `null` ; variables permises selon le type de message. */
export function templateProblem(value: unknown, kind: TemplateKind = "confirmation"): string | null {
  if (typeof value !== "string" || !value.trim()) return coded("whatsapp.texte_vide");
  if (value.length > MAX_TEXT) return coded("reglage.texte_long", { max: MAX_TEXT });
  const allowed = variablesOf(kind);
  for (const [, name] of value.matchAll(/\{([^{}]*)\}/g)) {
    if (!allowed.includes(name)) {
      return coded("whatsapp.variable_inconnue", { variable: `{${name}}`, permises: allowed.map((v) => `{${v}}`).join(", ") });
    }
  }
  return null;
}

/** Texte final : variables remplacées, sans double espace laissé par une variable vide. */
export function renderTemplate(template: string, values: Partial<Record<Variable, string>>): string {
  return template
    .replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? values[name as Variable]! : whole))
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

const DAY_FORMATS: Record<Lang, Intl.DateTimeFormat> = {
  fr: new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
  en: new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
};

/** Jour d'un rendez-vous (`aaaa-mm-jj`, déjà à l'heure de Douala) en toutes lettres : « vendredi 2 octobre ». */
export function formatDay(date: string, lang: Lang): string {
  return DAY_FORMATS[lang].format(new Date(`${date}T12:00:00Z`));
}
