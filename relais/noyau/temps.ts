/**
 * Dates et heures du relais : toujours dans le fuseau de l'institut, jamais dans celui de la machine
 * (un Worker de Cloudflare tourne en UTC). Module pur, sans Node ni Cloudflare.
 */

const formats = new Map<string, Intl.DateTimeFormat>();

function format(fuseau: string): Intl.DateTimeFormat {
  let f = formats.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuseau, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
    formats.set(fuseau, f);
  }
  return f;
}

/** Vrai si `fuseau` est un nom IANA que le moteur connaît (`Africa/Douala`). */
export function fuseauValide(fuseau: string): boolean {
  if (!fuseau) return false;
  try {
    format(fuseau);
    return true;
  } catch {
    return false;
  }
}

/** Date `AAAA-MM-JJ` et minutes depuis minuit de l'instant `instant` (ms) dans `fuseau` ; les secondes sont tronquées. */
export function localDe(instant: number, fuseau: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(format(fuseau).formatToParts(new Date(instant)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Vrai pour une date `AAAA-MM-JJ` qui existe au calendrier. */
export function dateValide(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** `date` décalée de `n` jours (calcul en UTC, sans heure : aucun effet de fuseau). */
export function ajouterJours(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `"09:05"` -> `545`. L'heure doit déjà être validée (schéma `Heure`). */
export function enMinutes(heure: string): number {
  return Number(heure.slice(0, 2)) * 60 + Number(heure.slice(3, 5));
}

/** `545` -> `"09:05"`. */
export function enHeure(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
