/**
 * Formats de l'institut (spec § 3.3) : francs CFA entiers, dates et heures de
 * Douala, quelle que soit l'heure de l'appareil. Tout montant et toute date
 * affichés passent par ici. Sans dépendance au navigateur (testé sous Node).
 */
import { LOCALES, type Lang } from "../i18n/translate.ts";

/** Fuseau de l'institut : UTC+1 toute l'année, sans heure d'été. */
export const TIME_ZONE = "Africa/Douala";
/** Cellule vide des tableaux : demi-cadratin (jamais de tiret cadratin). */
export const EMPTY = "–";

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * Groupage des milliers, identique dans les deux langues (décision
 * produit du 30/09/2026, § 8) : le format français (espace fine
 * insécable) sert aussi à l'écran anglais, pour qu'une virgule ne ressemble
 * plus à des centimes.
 */
const AMOUNT_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function dateFormat(lang: Lang, name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${lang}:${name}`;
  let format = formats.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALES[lang], options);
    formats.set(id, format);
  }
  return format;
}

/**
 * Nombre de francs sans la devise, groupé par milliers de la même façon dans
 * les deux langues : `15\u202f000` (pavé de la caisse, coupures, montants
 * rapides ; décision du 30/09/2026, § 8). Arrondi à l'entier. `lang` reste au
 * paramètre pour la cohérence des signatures de ce module, même s'il ne
 * change plus le groupage.
 */
export function formatAmount(amount: number | null | undefined, lang: Lang): string {
  return AMOUNT_FORMAT.format(Math.round(Number(amount) || 0));
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

/**
 * Montant à l'écran, entier : `15\u202f000\u00a0F` dans les deux langues (décision
 * produit du 30/09/2026, § 8 : le FCFA n'a pas de centimes, gagner de la
 * place en n'écrivant que « F » à l'écran). Nombre puis « F », séparés par une
 * espace insécable. Un montant hérité à décimales est arrondi. Pour les
 * documents officiels (ticket PDF, avoir, reçu d'acompte), voir
 * `formatPriceDocument`.
 */
export function formatPrice(amount: number | null | undefined, lang: Lang): string {
  return `${formatAmount(amount, lang)}\u00a0F`;
}

/**
 * Montant en francs CFA, en toutes lettres : `15\u202f000\u00a0FCFA` dans les deux
 * langues, réservé aux documents officiels (ticket PDF, avoir, reçu
 * d'acompte, vague 2 ; décision du 30/09/2026, § 8). Ne pas utiliser à
 * l'écran : `formatPrice` suffit.
 */
export function formatPriceDocument(amount: number | null | undefined, lang: Lang): string {
  return `${formatAmount(amount, lang)}\u00a0FCFA`;
}

/**
 * Sépare un montant déjà formaté (`formatPrice`) en deux morceaux à ne jamais
 * couper à l'affichage : le nombre (ses groupes de milliers restent liés par
 * l'espace fine insécable) et « F ». `null` si le texte n'a pas cette forme
 * (une valeur qui n'est pas un montant).
 * Relecture finale, constat 1 bis : `break-words` coupait « FCFA » au milieu
 * (« FC »/« FA ») ; seule l'espace insécable entre le nombre et la devise (pas
 * les espaces fines des milliers, jamais touchées ici) doit pouvoir devenir un
 * retour à la ligne.
 */
export function splitAmount(text: string): [string, string] | null {
  if (text.endsWith("\u00a0F")) return [text.slice(0, -2), "F"];
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

/**
 * Prix saisi : entier de francs, jamais négatif ni `NaN`. Un point, une
 * virgule ou une espace (ordinaire, U+00A0 ou U+202F) suivi d'exactement
 * trois chiffres est un séparateur de milliers ("15.000", "15,000",
 * "1.500.000", "15 000") ; tout autre point ou virgule est une décimale,
 * arrondie au franc entier (relecture finale I1).
 */
export function parseAmount(text: string): number {
  return readAmount(text) ?? 0;
}

/**
 * Comme `parseAmount`, mais `null` quand la saisie n'est pas un nombre de
 * francs (« abc », « 3 5OO francs », « douze mille », « -20 ») : un formulaire
 * la refuse au lieu d'enregistrer 0 F (décision 8, V1-12). Vide vaut 0.
 */
export function readAmount(text: string): number | null {
  let cleaned = "";
  // L'unité recopiée après le nombre (« 15 000 F », « 15 000 FCFA », « 3 500 francs ») est tolérée.
  const t = text.trim().replace(/(\d)\s*(f|fcfa|cfa|francs?)$/i, "$1");
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (/[.,\s]/.test(ch)) {
      let j = i + 1;
      while (j < t.length && /\d/.test(t[j])) j++;
      const groupLength = j - i - 1;
      if (!/\s/.test(ch) && groupLength !== 3) cleaned += ".";
      // sinon (espace, ou point/virgule suivi de trois chiffres) : séparateur de milliers, ignoré.
    } else {
      cleaned += ch;
    }
  }
  if (cleaned === "") return 0;
  // Chiffres et une décimale au plus : ni signe, ni lettre, ni « 1e3 » ou « 0x10 ».
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  return Math.round(Number(cleaned));
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
