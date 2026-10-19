/**
 * Mini CRM à l'écran (spec du 04/10/2026, § 1) : anniversaire sans année,
 * saisie et affichage des étiquettes, ligne d'état et chiffres clés de la
 * fiche, étiquette du filtre gardée dans l'adresse (`?etiquette=`).
 * Fonctions pures, testées sous Node.
 */
import { CARD_FORMAT, normalizeCard } from "../../shared/carte.ts";
import { LOCALES, translate, translatePlural, type Lang } from "../i18n/translate.ts";
import { fold } from "./bilingual.ts";
import { formatEntier, formatPrice, formatShortDate } from "./format.ts";
import type { ClientSummary, TagCount } from "../types.ts";

/** Seuil d'absence mis en avant par défaut (décision 6) ; la vague 3 lit `relances.absence_jours`. */
export const DEFAULT_ABSENCE_DAYS = 60;
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;
export const MAX_PREFERENCES = 500;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Nombre de jours d'un mois (1 à 12), février compté 29 : l'anniversaire n'a pas d'année. */
export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** Jour et mois d'un anniversaire `MM-JJ` ; null s'il est vide ou illisible. */
export function birthdayParts(mmdd: string): { day: number; month: number } | null {
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month) ? { day, month } : null;
}

/** Valeur `MM-JJ` à enregistrer depuis les deux listes ; vide tant que l'une manque ; jour ramené au dernier du mois. */
export function birthdayValue(day: number | null, month: number | null): string {
  if (!day || !month) return "";
  const d = Math.min(day, daysInMonth(month));
  return `${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const monthCache = new Map<Lang, string[]>();

/** Noms des mois dans la langue (« janvier », « January »), pour la liste du formulaire et l'anniversaire. */
export function monthNames(lang: Lang): string[] {
  let names = monthCache.get(lang);
  if (!names) {
    const format = new Intl.DateTimeFormat(LOCALES[lang], { month: "long", timeZone: "UTC" });
    names = Array.from({ length: 12 }, (_, i) => format.format(Date.UTC(2000, i, 1)));
    monthCache.set(lang, names);
  }
  return names;
}

/** « 14 octobre », « 1er mai », « 14 October » ; vide pour un anniversaire vide. */
export function birthdayLabel(mmdd: string, lang: Lang): string {
  const parts = birthdayParts(mmdd);
  if (!parts) return "";
  const mois = monthNames(lang)[parts.month - 1];
  return parts.day === 1
    ? translate(lang, "crm.anniversaire_premier", { mois })
    : translate(lang, "crm.anniversaire_date", { jour: parts.day, mois });
}

/** Vrai si l'anniversaire tombe `today` (`aaaa-mm-jj` de Douala) ; le 29 février se fête le 28 les années non bissextiles. */
export function isBirthdayToday(mmdd: string, today: string): boolean {
  if (!birthdayParts(mmdd)) return false;
  const year = Number(today.slice(0, 4));
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const target = mmdd === "02-29" && !leap ? "02-28" : mmdd;
  return today.slice(5) === target;
}

/** Étiquette nettoyée : espaces resserrés, 30 caractères au plus. */
export function cleanTag(text: string): string {
  return [...text.replace(/\s+/g, " ").trim()].slice(0, MAX_TAG_LENGTH).join("");
}

/**
 * Saisie des étiquettes : chaque morceau avant une virgule devient une
 * étiquette (doublons repliés ignorés, 10 au plus) ; le texte après la
 * dernière virgule reste dans le champ (`rest`). Entrée équivaut à une virgule.
 */
export function parseTagInput(text: string, current: string[]): { tags: string[]; rest: string } {
  const pieces = text.split(",");
  const rest = pieces.pop() ?? "";
  const tags = [...current];
  for (const piece of pieces) {
    const tag = cleanTag(piece);
    if (tag === "" || tags.length >= MAX_TAGS || tags.some((t) => fold(t) === fold(tag))) continue;
    tags.push(tag);
  }
  return { tags, rest: rest.replace(/^\s+/, "") };
}

/** Étiquettes existantes proposées : celles qui contiennent la saisie (sans accents ni majuscules), pas encore choisies, six au plus. */
export function tagSuggestions(input: string, all: TagCount[], current: string[]): string[] {
  const q = fold(input.trim());
  const chosen = new Set(current.map(fold));
  return all.filter((t) => !chosen.has(fold(t.tag)) && fold(t.tag).includes(q)).slice(0, 6).map((t) => t.tag);
}

/** Étiquettes d'une ligne de la liste : `max` montrées, le reste compté (« +N »). */
export function shownTags(tags: string[], max = 2): { shown: string[]; more: number } {
  return { shown: tags.slice(0, max), more: Math.max(0, tags.length - max) };
}

export type AbsenceLine =
  | { kind: "next"; date: string; time: string }
  | { kind: "absent"; days: number; over: boolean }
  | { kind: "never" }
  | null;

/**
 * Ligne d'état de la fiche (décision 6) : un rendez-vous à venir passe avant
 * tout (la cliente n'est pas dite absente) ; jamais venue ; absente dès un
 * jour, mise en avant (`over`) dès que l'absence atteint le seuil. Venue
 * aujourd'hui : rien. Seuil `null` (pas encore lu) : jamais de mise en avant.
 */
export function absenceLine(summary: Pick<ClientSummary, "visits" | "days_since" | "next_appointment">, threshold: number | null = DEFAULT_ABSENCE_DAYS): AbsenceLine {
  if (summary.next_appointment) return { kind: "next", date: summary.next_appointment.date, time: summary.next_appointment.time };
  if (summary.visits === 0 || summary.days_since === null) return { kind: "never" };
  if (summary.days_since < 1) return null;
  return { kind: "absent", days: summary.days_since, over: threshold !== null && summary.days_since >= threshold };
}

/** Texte de la ligne d'état. */
export function absenceText(line: Exclude<AbsenceLine, null>, lang: Lang): string {
  if (line.kind === "next") return translate(lang, "crm.prochain_rdv", { date: formatShortDate(line.date, lang), heure: line.time.slice(0, 5) });
  if (line.kind === "never") return translate(lang, "cliente.jamais_venue");
  return translatePlural(lang, "crm.absente_depuis", line.days);
}

export interface KeyFigure {
  id: "visits" | "spent" | "basket" | "points";
  value: string;
  label: string;
}

/** Chiffres clés de la fiche : visites toujours ; total dépensé et panier moyen seulement s'ils sont rendus (jamais à la praticienne) ; points si la synthèse porte la fidélité. */
export function keyFigures(summary: Pick<ClientSummary, "visits" | "total_spent" | "average_basket"> & Partial<Pick<ClientSummary, "loyalty">>, lang: Lang): KeyFigure[] {
  const figures: KeyFigure[] = [{ id: "visits", value: String(summary.visits), label: translate(lang, "crm.chiffre.visites") }];
  if (summary.total_spent !== undefined) figures.push({ id: "spent", value: formatPrice(summary.total_spent, lang), label: translate(lang, "crm.chiffre.total") });
  if (summary.average_basket !== undefined) figures.push({ id: "basket", value: formatPrice(summary.average_basket, lang), label: translate(lang, "crm.chiffre.panier") });
  if (summary.loyalty) figures.push({ id: "points", value: formatEntier(summary.loyalty.balance), label: translate(lang, "fidelite.points_tuile") });
  return figures;
}

/** Paramètre de l'adresse qui garde l'étiquette choisie dans la liste des clientes (décision 10). */
const TAG_PARAM = "etiquette";

/** Étiquette choisie d'après les paramètres de l'adresse (`?etiquette=VIP`) ; vide sans filtre. */
export function tagFromSearch(search: string): string {
  return new URLSearchParams(search).get(TAG_PARAM)?.trim() ?? "";
}

/** La même adresse avec l'étiquette choisie (ou sans, si vide), autres paramètres et ancre gardés. */
export function withTagParam(url: string, tag: string): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = base.indexOf("?");
  const path = queryAt === -1 ? base : base.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? "" : base.slice(queryAt + 1));
  if (tag) params.set(TAG_PARAM, tag);
  else params.delete(TAG_PARAM);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}

/** Vrai si la recherche désigne ce numéro de carte (4 caractères au moins ; espaces, tirets et majuscules ignorés). */
export function cardMatches(search: string, card: string | null | undefined): boolean {
  const q = normalizeCard(search);
  return !!card && q.length >= 4 && card.includes(q);
}

/** Cliente dont le numéro de carte est exactement celui tapé (lecteur en mode clavier) ; null s'il n'y en a pas une seule. */
export function cardChoice(search: string, clients: { id: number; card?: string | null }[]): number | null {
  const q = normalizeCard(search);
  if (!CARD_FORMAT.test(q)) return null;
  const hits = clients.filter((c) => c.card === q);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Interrupteur général du mini CRM (`crm.active`), lu dans l'état de session
 * (`GET /api/auth/state`) : activé tant que le serveur ne dit pas `false`
 * (avant la connexion, ou serveur plus ancien).
 */
export function crmActiveOf(state: { crm?: { active?: unknown } | null } | null | undefined): boolean {
  return state?.crm?.active !== false;
}

/** Parties de la fiche cliente qui dépendent du mini CRM. */
export interface FicheCrm {
  /** Synthèse : chiffres clés, habitudes, ligne d'absence. */
  summary: boolean;
  /** Ligne d'avant le chantier sous le nom : « N visites · Dernière visite le … ». */
  visitLine: boolean;
  tags: boolean;
  /** Anniversaire dans les coordonnées et « Anniversaire aujourd'hui ». */
  birthday: boolean;
  preferences: boolean;
  /** Bloc « Fidélité » (la synthèse porte la fidélité). */
  loyalty: boolean;
}

/** Ce que la fiche montre : mini CRM désactivé, comme avant le chantier (une synthèse périmée est ignorée). */
export function ficheCrm(crm: boolean, summary: Pick<ClientSummary, "loyalty"> | null): FicheCrm {
  const shown = crm && summary !== null;
  return { summary: shown, visitLine: !shown, tags: crm, birthday: crm, preferences: crm, loyalty: shown && summary.loyalty !== null };
}

/** Étiquette du filtre de la liste envoyée au serveur : ignorée quand le mini CRM est désactivé. */
export function listTagFilter(tag: string, crm: boolean): string {
  return crm ? tag : "";
}

/** Étiquettes montrées (fiche, ligne de la liste) : aucune quand le mini CRM est désactivé. */
export function crmTags(tags: readonly string[], crm: boolean): string[] {
  return crm ? [...tags] : [];
}

/**
 * Données du formulaire de la cliente : mini CRM désactivé, ni anniversaire,
 * ni étiquettes, ni préférences ne sont envoyés, pour que le serveur garde
 * les valeurs enregistrées (il n'efface jamais un champ absent).
 */
export function clientPayload<T extends Record<string, unknown>>(data: T, crm: boolean): Partial<T> {
  if (crm) return data;
  const { birthday: _b, tags: _t, preferences: _p, ...rest } = data;
  return rest as Partial<T>;
}
