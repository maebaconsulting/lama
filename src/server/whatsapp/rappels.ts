/**
 * Rappels de rendez-vous (sous-projet 7 § 3, « Rappels ») : une tâche
 * périodique, chaque minute, met en file les rappels dus. Rendez-vous non
 * annulés ni commencés, cliente cochée, dont l'heure moins le délai
 * (`whatsapp.rappel_heures`) est passée et l'heure à venir ; jamais pendant la
 * fenêtre de silence (rattrapé à sa fin) ; jamais pour un rendez-vous pris
 * moins de `rappel_heures` à l'avance. La clé (rendez-vous, date et heure)
 * garantit un seul rappel, même après une coupure ; un déplacement en change.
 */
import { decode } from "../messages.ts";
import type { Database, StorageBinding } from "../storage.ts";
import { appointmentAt, inSilence } from "./numeros.ts";
import { queueAppointmentMessage, readMessageSettings, type MessageSettings } from "./rendez-vous.ts";

const H = 3600e3;
const dayOf = (ms: number) => new Date(ms + H).toISOString().slice(0, 10);

export function queueDueReminders(db: Database, s: MessageSettings, now: number): number {
  if (inSilence(now, s.silenceStart, s.silenceEnd)) return 0;
  const delay = s.reminderHours * H;
  const candidates = db.prepare(
    `SELECT a.id, a.scheduled_date, a.start_time, a.booked_at FROM appointments a JOIN clients c ON c.id = a.client_id
      WHERE a.status IN ('booked', 'confirmed') AND c.channel <> 'none' AND a.scheduled_date BETWEEN ? AND ?`,
  ).all(dayOf(now), dayOf(now + delay)) as { id: number; scheduled_date: string; start_time: string; booked_at: number | null }[];
  let queued = 0;
  for (const apt of candidates) {
    const at = appointmentAt(apt.scheduled_date, apt.start_time);
    if (at <= now || at - delay > now) continue;
    if (apt.booked_at !== null && at - apt.booked_at < delay) continue;
    if (queueAppointmentMessage(db, s, "rappel", apt.id, now)) queued++;
  }
  return queued;
}

/** Un passage : réglages lus, puis sélection et inscription dans une seule transaction. */
export async function runReminders(storage: StorageBinding, now: number): Promise<number> {
  const settings = await readMessageSettings();
  return storage.transaction!((db) => queueDueReminders(db, settings, now));
}

/** Tâche de fond (lancée par `boot.ts`), comme le travailleur de la file. Renvoie une fonction d'arrêt. */
export function startReminders(opts: { storage: StorageBinding; now?: () => number; intervalMs?: number; onChange?: () => void }): () => void {
  const now = opts.now ?? Date.now;
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const queued = await runReminders(opts.storage, now());
      if (!stopped && queued > 0) opts.onChange?.();
    } catch (error) {
      if (!stopped) console.error("Rappels WhatsApp\u00a0:", error instanceof Error ? decode("fr", error.message) : error);
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
