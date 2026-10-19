/**
 * Formats de l'institut (spec § 3.3) : montants dans la devise de l'institut, dates et heures de
 * Douala, quelle que soit l'heure de l'appareil. Tout montant et toute date
 * affichés passent par ici. Sans dépendance au navigateur (testé sous Node).
 */
import { LOCALES, type Lang } from "../i18n/translate.ts";
import { formatMontantEcran, formatNombre, lireMontant, separateurDecimal } from "../../shared/montants.ts";
import { deviseActive } from "../../shared/devise-active.ts";
export { formatEntier, formatMontantDocument } from "../../shared/montants.ts";

/** Fuseau de l'institut : UTC+1 toute l'année, sans heure d'été. */
export const TIME_ZONE = "Africa/Douala";
/** Cellule vide des tableaux : demi-cadratin (jamais de tiret cadratin). */
export const EMPTY = "–";

const formats = new Map<string, Intl.DateTimeFormat>();

function dateFormat(lang: Lang, name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${lang}:${name}`;
  let format = formats.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALES[lang], options);
    formats.set(id, format);
  }
  return format;
}

/** Nombre seul, dans la devise active (`15 000`, `15 000,50`). */
export function formatAmount(amount: number | null | undefined, lang: Lang): string {
  return formatNombre(Number(amount) || 0, lang);
}

const rates = new Map<Lang, Intl.NumberFormat>();

/** Taux en pour cent, deux décimales au plus, sans le signe : `19,25` ou `19.25` (TVA). */
export function formatRate(rate: number, lang: Lang): string {
  let format = rates.get(lang);
  if (!format) {
    format = new Intl.NumberFormat(LOCALES[lang], { maximumFractionDigits: 2 });
    rates.set(lang, format);
  }
  return format.format(rate);
}

/** Montant à l'écran : symbole de la devise à sa position, ou le nombre seul s'il est masqué. */
export function formatPrice(amount: number | null | undefined, lang: Lang): string {
  return formatMontantEcran(Number(amount) || 0, lang);
}

/**
 * Sépare un montant de `formatPrice` en trois morceaux à ne jamais couper :
 * symbole avant, nombre, symbole après (l'un des deux vide) ; `null` si le
 * texte n'a pas cette forme. Seule l'espace insécable entre symbole et nombre
 * peut devenir un retour à la ligne.
 */
export function splitAmount(text: string): { avant: string; nombre: string; apres: string } | null {
  const s = deviseActive().symbole;
  // Signe ASCII (`formatPrice`) ou typographique (`signedPrice` de `caisse-jour.ts` : « −9 750 F »).
  const signe = text.startsWith("-") || text.startsWith("\u2212") ? text[0] : "";
  const corps = signe ? text.slice(1) : text;
  if (corps.endsWith(`\u00a0${s}`)) return { avant: "", nombre: `${signe}${corps.slice(0, -(s.length + 1))}`, apres: s };
  if (corps.startsWith(`${s}\u00a0`)) return { avant: `${signe}${s}`, nombre: corps.slice(s.length + 1), apres: "" };
  return null;
}

/**
 * Taille d'un chiffre clé (retouche 2 du 30/09/2026) : 1,5rem au plus,
 * rétrécie selon la largeur réelle de sa tuile (`100cqi`, la tuile est un
 * conteneur) pour que le montant tienne sur une ligne, « 9 999 000 F »
 * compris ; 1rem au moins. Compte 0,62 em par signe : Jost 500 à chiffres
 * tabulaires en prend 0,51 au plus (mesuré), la marge couvre les écarts de rendu.
 */
export function amountFontSize(value: string | number): string {
  const em = (String(value).length * 0.62).toFixed(2);
  return `clamp(1rem, calc(100cqi / ${em}), 1.5rem)`;
}

export function parseAmount(text: string): number {
  return readAmount(text) ?? 0;
}

export function readAmount(text: string): number | null {
  return lireMontant(text);
}

/**
 * Texte prérempli d'un champ de montant (fiche de prestation ou de produit,
 * remise, pourboire, rubrique Fidélité), relu par `parseAmount` : jamais de
 * séparateur de milliers ; « 15000 » pour une devise sans centimes, comme
 * avant ; « 15,50 » (« 15.50 » en anglais) pour une devise à centimes.
 */
export function texteSaisie(mineur: number, lang: Lang): string {
  const d = deviseActive();
  const n = Math.max(Math.round(Number(mineur) || 0), 0);
  if (d.decimales === 0) return String(n);
  const k = 10 ** d.decimales;
  return `${Math.floor(n / k)}${separateurDecimal(lang)}${String(n % k).padStart(d.decimales, "0")}`;
}

/** Clavier d'un champ de montant au téléphone et à la tablette : avec séparateur décimal pour une devise à centimes. */
export function modeSaisieMontant(): "decimal" | "numeric" {
  return deviseActive().decimales > 0 ? "decimal" : "numeric";
}

/** Date de calendrier `YYYY-MM-DD` ancrée à midi UTC : elle ne change jamais de jour. */
function calendarDay(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** `27/09/2026` dans les deux langues. */
export function formatShortDate(date: string, lang: Lang): string {
  return dateFormat(lang, "courte", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(calendarDay(date));
}

/** `dimanche 27 septembre 2026` ou `Sunday, 27 September 2026`. */
export function formatLongDate(date: string, lang: Lang): string {
  return dateFormat(lang, "longue", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(calendarDay(date));
}

/** Plage horaire `14:30–15:30` (demi-cadratin). */
export function formatRange(start: string, end: string): string {
  return `${start}–${end}`;
}

/** Graduation de l'agenda, sur 24 h dans les deux langues : `07:00`. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Horodatage SQLite (`datetime('now')`, UTC sans fuseau) en instant ; sans `Z`, il serait lu comme une heure locale. */
export function parseSqliteTimestamp(ts: string): number {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

/** Date d'un instant, à Douala : `28/09/2026`. */
export function formatInstantDate(ms: number, lang: Lang): string {
  return dateFormat(lang, "instant-date", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIME_ZONE }).format(ms);
}

/** Heure d'un instant, à Douala, sur 24 h : `09:00`. */
export function formatInstantTime(ms: number, lang: Lang): string {
  return dateFormat(lang, "instant-heure", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TIME_ZONE }).format(ms);
}

/** Date et heure d'un instant, à Douala : `28/09/2026 09:00`. */
export function formatInstant(ms: number, lang: Lang): string {
  return `${formatInstantDate(ms, lang)} ${formatInstantTime(ms, lang)}`;
}

/** Date et heure d'un horodatage SQLite, à Douala. */
export function formatTimestamp(ts: string, lang: Lang): string {
  return formatInstant(parseSqliteTimestamp(ts), lang);
}

/** Jour d'un horodatage SQLite, à Douala. */
export function formatTimestampDate(ts: string, lang: Lang): string {
  return formatInstantDate(parseSqliteTimestamp(ts), lang);
}
