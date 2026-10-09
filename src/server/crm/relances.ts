/**
 * Relances du mini CRM (spec du 04/10/2026, décisions 23 à 26) : une tâche
 * périodique, chaque minute comme les rappels, met en file les messages
 * d'anniversaire du jour et les « vous nous manquez » dus. Rien sans case
 * cochée ; rien avant l'heure d'envoi (`relances.heure`) ni pendant la
 * fenêtre de silence ; une heure d'envoi qui tombe dans le silence vaut sa
 * fin. Anniversaire : une fois par an (clé de l'année), le jour même ; le
 * 29 février est fêté le 28 les années non bissextiles. Absence : une fois
 * par période (clé de la date de dernière visite), quand elle atteint le
 * seuil et au plus 14 jours après, sans rendez-vous à venir ; une cliente
 * jamais venue n'est pas relancée.
 */
import { doualaDay } from "../../shared/caisse.ts";
import { decode, type Lang } from "../messages.ts";
import { enqueueSync } from "../outbox/outbox.ts";
import { crmActive, getSetting } from "../settings.ts";
import type { Database, StorageBinding } from "../storage.ts";
import { WHATSAPP_KIND, type WhatsappMessage } from "../whatsapp/envoi.ts";
import { appointmentAt, inSilence, normalizePhone } from "../whatsapp/numeros.ts";
import { readMessageSettings, type MessageSettings } from "../whatsapp/rendez-vous.ts";
import { firstName, renderTemplate } from "../whatsapp/textes.ts";

/** Réglages lus avant la transaction : ceux des messages et ceux des relances. */
export interface RelanceSettings extends MessageSettings {
  birthdayOn: boolean;
  absenceOn: boolean;
  absenceDays: number;
  sendHour: string;
}

/** Réglages des relances ; mini CRM désactivé (interrupteur général), les deux cases valent « non ». */
export async function readRelanceSettings(): Promise<RelanceSettings> {
  const crm = await crmActive();
  return {
    ...(await readMessageSettings()),
    birthdayOn: crm && (await getSetting<boolean>("relances.anniversaire")),
    absenceOn: crm && (await getSetting<boolean>("relances.absence")),
    absenceDays: await getSetting<number>("relances.absence_jours"),
    sendHour: await getSetting<string>("relances.heure"),
  };
}

/** Fenêtre d'envoi après le seuil d'absence (décision 25) : activer la relance n'écrit pas aux anciennes clientes. */
const ABSENCE_WINDOW_DAYS = 14;
const H = 3600e3;
const DAY_MS = 86_400_000;
const minutesOfDay = (now: number) => Math.floor(((((now + H) % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Jour `aaaa-mm-jj` décalé de `delta` jours. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** Anniversaires (`MM-JJ`) fêtés ce jour : le 28 février d'une année non bissextile fête aussi le 29. */
export function birthdaysOf(day: string): string[] {
  const mmdd = day.slice(5);
  const year = Number(day.slice(0, 4));
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return mmdd === "02-28" && !leap ? ["02-28", "02-29"] : [mmdd];
}

type ClientRow = { id: number; name: string; phone: string | null; language: string };

/** Message d'une relance pour une cliente, dans sa langue (à défaut celle de l'institut). */
function relanceMessage(s: RelanceSettings, kind: "anniversaire" | "absence", row: ClientRow, origin: Omit<WhatsappMessage["origin"], "clientId">): WhatsappMessage {
  const lang: Lang = row.language === "fr" || row.language === "en" ? row.language : s.lang;
  const text = renderTemplate(s.texts[kind][lang], { prenom: firstName(row.name), nom: row.name.trim(), institut: s.institut, telephone: s.telephone });
  return { to: normalizePhone(row.phone ?? "", s.indicatif) ?? "", lang, text, origin: { ...origin, clientId: row.id } };
}

/** Met en file les relances dues à `now` ; renvoie le nombre d'envois nouvellement inscrits. */
export function queueDueRelances(db: Database, s: RelanceSettings, now: number): number {
  if (!s.birthdayOn && !s.absenceOn) return 0;
  if (inSilence(now, s.silenceStart, s.silenceEnd)) return 0;
  const today = doualaDay(now);
  const hourInSilence = inSilence(appointmentAt(today, s.sendHour), s.silenceStart, s.silenceEnd);
  // Heure d'envoi dans le silence : départ à la fin du silence (jamais avant dans la journée).
  const start = hourInSilence ? minutesOf(s.silenceEnd) : minutesOf(s.sendHour);
  if (minutesOfDay(now) < start) return 0;
  let queued = 0;
  const put = (message: WhatsappMessage, dedupeKey: string) => {
    if (enqueueSync(db, { kind: WHATSAPP_KIND, payload: message, dedupeKey, now }).created) queued++;
  };
  if (s.birthdayOn) {
    const days = birthdaysOf(today);
    const rows = db.prepare(
      `SELECT id, name, phone, language, birthday FROM clients
        WHERE channel <> 'none' AND TRIM(COALESCE(phone, '')) <> '' AND birthday IN (${days.map(() => "?").join(", ")})`,
    ).all(...days) as (ClientRow & { birthday: string })[];
    for (const row of rows) put(relanceMessage(s, "anniversaire", row, { type: "anniversaire", birthday: row.birthday }), `wa:anniversaire:${row.id}:${today.slice(0, 4)}`);
  }
  if (s.absenceOn) {
    const rows = db.prepare(
      `SELECT c.id, c.name, c.phone, c.language, v.last_visit FROM clients c
         JOIN (SELECT client_id, MAX(scheduled_date) AS last_visit FROM appointments WHERE status = 'completed' GROUP BY client_id) v ON v.client_id = c.id
        WHERE c.channel <> 'none' AND TRIM(COALESCE(c.phone, '')) <> '' AND v.last_visit BETWEEN ? AND ?
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.client_id = c.id AND a.status IN ('booked', 'confirmed', 'in_progress') AND a.scheduled_date >= ?)`,
    ).all(shiftDay(today, -(s.absenceDays + ABSENCE_WINDOW_DAYS)), shiftDay(today, -s.absenceDays), today) as (ClientRow & { last_visit: string })[];
    for (const row of rows) put(relanceMessage(s, "absence", row, { type: "absence", lastVisit: row.last_visit }), `wa:absence:${row.id}:${row.last_visit}`);
  }
  return queued;
}

/** Un passage : réglages lus, puis sélection et inscription dans une seule transaction ; rien à faire sans case cochée. */
export async function runRelances(storage: StorageBinding, now: number): Promise<number> {
  const settings = await readRelanceSettings();
  if (!settings.birthdayOn && !settings.absenceOn) return 0;
  return storage.transaction!((db) => queueDueRelances(db, settings, now));
}

/** Tâche de fond (lancée par `boot.ts`), comme les rappels. Renvoie une fonction d'arrêt. */
export function startRelances(opts: { storage: StorageBinding; now?: () => number; intervalMs?: number; onChange?: () => void }): () => void {
  const now = opts.now ?? Date.now;
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const queued = await runRelances(opts.storage, now());
      if (!stopped && queued > 0) opts.onChange?.();
    } catch (error) {
      if (!stopped) console.error("Relances\u00a0:", error instanceof Error ? decode("fr", error.message) : error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, opts.intervalMs ?? 60_000);
  timer.unref?.();
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
