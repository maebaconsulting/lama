/**
 * Calcul du calendrier (ChampDate) : grille du mois commençant le lundi dans
 * les deux langues, aujourd'hui à Douala, noms tirés d'Intl. Les jours sont
 * des chaînes `aaaa-mm-jj` ; tout calcul passe par Date.UTC, jamais par un
 * objet Date local. Sans dépendance au navigateur (testé sous Node).
 */
import { LOCALES, type Lang } from "../i18n/translate.ts";
import { TIME_ZONE } from "./format.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;

const iso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Année et mois (1 à 12) d'un jour `aaaa-mm-jj` ; `null` s'il est illisible. */
export function monthOf(day: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** Semaines du mois (lundi en premier), cases vides (`null`) avant le 1er et après le dernier jour. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = Date.UTC(year, month - 1, 1);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7; // lundi = 0
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 0; d < days; d++) cells.push(iso(first + d * DAY_MS));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Jour décalé de `delta` jours. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return iso(Date.UTC(y, m - 1, d) + delta * DAY_MS);
}

/** Mois décalé de `delta` mois. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Aujourd'hui à l'institut (fuseau de Douala), `aaaa-mm-jj`. */
export function todayAt(now: Date = new Date(), timeZone: string = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Vrai si le jour respecte les bornes facultatives (incluses). */
export function inBounds(day: string, min?: string, max?: string): boolean {
  return !(min && day < min) && !(max && day > max);
}

/** Jour ramené dans les bornes facultatives. */
export function clampDay(day: string, min?: string, max?: string): string {
  if (min && day < min) return min;
  if (max && day > max) return max;
  return day;
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(lang: Lang, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${lang}:${JSON.stringify(options)}`;
  let f = formats.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALES[lang], { ...options, timeZone: "UTC" });
    formats.set(id, f);
  }
  return f;
}

/** « septembre 2026 » ou « September 2026 ». */
export function monthTitle(year: number, month: number, lang: Lang): string {
  return format(lang, { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

// Le 5 janvier 2026 est un lundi : sept jours consécutifs à partir de là.
const week = (lang: Lang, weekday: "narrow" | "long") =>
  Array.from({ length: 7 }, (_, i) => format(lang, { weekday }).format(new Date(Date.UTC(2026, 0, 5 + i))));

/** Initiales des jours, du lundi au dimanche. */
export function weekdayInitials(lang: Lang): string[] {
  return week(lang, "narrow");
}

/** Noms complets des jours, du lundi au dimanche. */
export function weekdayNames(lang: Lang): string[] {
  return week(lang, "long");
}
