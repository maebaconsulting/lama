/**
 * Messages liés à un rendez-vous (sous-projet 7 § 3) : confirmation et
 * rappel, écrits dans une transaction déjà ouverte (`StorageBinding.transaction`)
 * pour être inscrits avec l'écriture du rendez-vous, ou pas du tout.
 */
import { decode, type Lang } from "../messages.ts";
import { enqueueSync } from "../outbox/outbox.ts";
import { getSetting } from "../settings.ts";
import type { Database } from "../storage.ts";
import { WHATSAPP_KIND, type WhatsappMessage } from "./envoi.ts";
import { appointmentAt, normalizePhone, silenceEnd } from "./numeros.ts";
import { firstName, formatDay, renderTemplate, textSetting, TEMPLATE_KINDS, type TemplateKind } from "./textes.ts";

/** Réglages lus avant la transaction (lecture asynchrone, secrets compris), passés aux fonctions synchrones. */
export interface MessageSettings {
  lang: Lang;
  institut: string;
  telephone: string;
  indicatif: string;
  silenceStart: string;
  silenceEnd: string;
  reminderHours: number;
  texts: Record<TemplateKind, Record<Lang, string>>;
}

/** Messages liés à un rendez-vous ; les textes de la réservation en ligne ont leur propre module (en-ligne/messages-en-ligne.ts). */
export type NatureRendezVous = Extract<TemplateKind, "confirmation" | "rappel" | "transfert">;

export async function readMessageSettings(): Promise<MessageSettings> {
  const texts = {} as Record<TemplateKind, Record<Lang, string>>;
  for (const kind of TEMPLATE_KINDS) {
    texts[kind] = { fr: await getSetting<string>(textSetting(kind, "fr")), en: await getSetting<string>(textSetting(kind, "en")) };
  }
  return {
    lang: (await getSetting<Lang>("institut.langue")) === "en" ? "en" : "fr",
    institut: await getSetting<string>("institut.nom"),
    telephone: await getSetting<string>("institut.telephone"),
    indicatif: await getSetting<string>("whatsapp.indicatif"),
    silenceStart: await getSetting<string>("whatsapp.silence_debut"),
    silenceEnd: await getSetting<string>("whatsapp.silence_fin"),
    reminderHours: await getSetting<number>("whatsapp.rappel_heures"),
    texts,
  };
}

/**
 * Message d'un rendez-vous pour sa cliente, ou `null` si elle ne reçoit aucun
 * message ou n'a pas de numéro. Un numéro impossible à normaliser donne
 * `to` vide : l'envoi échouera, visible dans « À envoyer à la main ». `now`
 * (l'instant de l'écriture ou du déplacement) distingue la clé de chaque
 * confirmation : sans lui, un aller-retour A → B → A retrouverait la même
 * clé qu'à la toute première réservation en A, déjà prise (`INSERT OR
 * IGNORE`), et la confirmation du retour ne s'inscrirait pas. La clé du
 * rappel reste indépendante de `now` : un seul rappel par rendez-vous et par heure.
 * Transfert : le prénom de la praticienne du rendez-vous (`{praticienne}`), et
 * la praticienne dans l'origine, pour reconnaître un nouveau transfert avant l'envoi.
 */
export function appointmentMessage(db: Database, s: MessageSettings, kind: NatureRendezVous, appointmentId: number, now: number): { message: WhatsappMessage; dedupeKey: string; at: number } | null {
  const row = db.prepare(
    `SELECT a.id, a.scheduled_date, a.start_time, a.staff_id, COALESCE(s.name, '') AS staff_name, c.id AS client_id, c.name, c.phone, c.channel, c.language
       FROM appointments a JOIN clients c ON c.id = a.client_id LEFT JOIN staff s ON s.id = a.staff_id WHERE a.id = ?`,
  ).get(appointmentId) as {
    id: number; scheduled_date: string; start_time: string; staff_id: number | null; staff_name: string;
    client_id: number; name: string; phone: string | null; channel: string; language: string;
  } | undefined;
  if (!row || row.channel === "none" || !(row.phone ?? "").trim()) return null;
  // Transfert vers « Non attribué » : hors champ (décision 14), aucun message.
  if (kind === "transfert" && row.staff_id === null) return null;
  const lang: Lang = row.language === "fr" || row.language === "en" ? row.language : s.lang;
  const services = db.prepare(
    "SELECT sv.name, sv.name_en FROM appointment_services aps JOIN services sv ON sv.id = aps.service_id WHERE aps.appointment_id = ? ORDER BY aps.id",
  ).all(appointmentId) as { name: string; name_en: string }[];
  const time = row.start_time.slice(0, 5);
  const text = renderTemplate(s.texts[kind][lang], {
    prenom: firstName(row.name),
    nom: row.name.trim(),
    date: formatDay(row.scheduled_date, lang),
    heure: time,
    prestation: services.map((sv) => (lang === "en" && sv.name_en.trim() ? sv.name_en : sv.name)).join(", "),
    institut: s.institut,
    telephone: s.telephone,
    praticienne: firstName(row.staff_name),
  });
  const at = appointmentAt(row.scheduled_date, time);
  // Transfert : une clé par praticienne et par écriture (aller-retour A → B → A, comme la confirmation).
  const dedupeKey = kind === "confirmation" ? `wa:confirmation:${row.id}:${row.scheduled_date} ${time}:${now}`
    : kind === "transfert" ? `wa:transfert:${row.id}:${row.staff_id}:${row.scheduled_date} ${time}:${now}`
    : `wa:rappel:${row.id}:${row.scheduled_date} ${time}`;
  const origin = { type: kind, appointmentId: row.id, clientId: row.client_id, at, ...(kind === "transfert" ? { staffId: row.staff_id! } : {}) };
  return {
    message: { to: normalizePhone(row.phone ?? "", s.indicatif) ?? "", lang, text, origin },
    dedupeKey,
    at,
  };
}

/**
 * Inscrit le message s'il a lieu d'être : rendez-vous à venir ; pendant la
 * fenêtre de silence, premier essai à sa fin, et rien si elle tombe après le
 * rendez-vous. Renvoie vrai si un envoi a été inscrit.
 *
 * La préparation du message (`appointmentMessage`) est protégée : une date
 * ou une heure déjà en base qui serait mal formée (donnée ancienne, saisie
 * hors de cette API) ne doit jamais empêcher l'écriture du rendez-vous dans
 * la même transaction. L'erreur est journalisée sans le texte ni le numéro.
 */
export function queueAppointmentMessage(db: Database, s: MessageSettings, kind: NatureRendezVous, appointmentId: number, now: number): boolean {
  let built: ReturnType<typeof appointmentMessage>;
  try {
    built = appointmentMessage(db, s, kind, appointmentId, now);
  } catch (error) {
    console.error("Préparation du message WhatsApp\u00a0:", error instanceof Error ? decode("fr", error.message) : error);
    return false;
  }
  if (!built || built.at <= now) return false;
  const quietUntil = silenceEnd(now, s.silenceStart, s.silenceEnd);
  if (quietUntil !== null && quietUntil >= built.at) return false;
  return enqueueSync(db, { kind: WHATSAPP_KIND, payload: built.message, dedupeKey: built.dedupeKey, now, notBefore: quietUntil ?? undefined }).created;
}
