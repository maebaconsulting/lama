import type { Database } from "./storage.ts";

/**
 * Tire le numéro APT suivant (V1-01), dans la transaction qui écrit le
 * rendez-vous : lecture et écriture du compteur sans rien d'intercalé, et un
 * refus qui annule la transaction rend aussi le numéro (aucun trou).
 */
export function takeIdentifier(db: Database): string {
  const prefix = db.prepare("SELECT value FROM _meta WHERE key = 'appointment_prefix'").get() as { value: string } | undefined;
  const counter = db.prepare("SELECT value FROM _meta WHERE key = 'appointment_counter'").get() as { value: string } | undefined;
  const next = parseInt(counter?.value || "0", 10) + 1;
  // Upsert, pas UPDATE : sans la ligne du compteur, un UPDATE ne toucherait rien et redonnerait toujours le même numéro.
  db.prepare("INSERT INTO _meta (key, value) VALUES ('appointment_counter', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(next));
  return `${prefix?.value || "APT"}-${next}`;
}

/** `hh:mm` plus `minutes`, sur 24 h. */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
