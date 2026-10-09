/**
 * Adresses des écrans dans les deux langues (spec § 7). Les deux formes et
 * les adresses d'origine d'OpenSalon mènent au même écran ; l'app construit
 * toujours celle de la langue en cours. Les routes de l'API ne changent pas.
 */
import type { Lang } from "../i18n/translate.ts";
import type { View } from "../types.ts";
import type { SectionId } from "./roles.ts";

export interface RouteState {
  view: View;
  id: string | null;
}

const VIEW_SLUGS: Record<View, Record<Lang, string>> = {
  dashboard: { fr: "", en: "" },
  calendar: { fr: "agenda", en: "calendar" },
  appointments: { fr: "rendez-vous", en: "appointments" },
  clients: { fr: "clientes", en: "clients" },
  staff: { fr: "equipe", en: "staff" },
  services: { fr: "prestations", en: "services" },
  products: { fr: "produits", en: "products" },
  reglages: { fr: "reglages", en: "settings" },
  charte: { fr: "charte", en: "charte" },
  vente: { fr: "vente", en: "sale" },
  caisse: { fr: "caisse", en: "till" },
};

const SECTION_SLUGS: Record<SectionId, Record<Lang, string>> = {
  institut: { fr: "institut", en: "institute" },
  caisse: { fr: "caisse", en: "checkout" },
  fidelite: { fr: "fidelite", en: "loyalty" },
  whatsapp: { fr: "messages", en: "messages" },
  comptes: { fr: "comptes", en: "accounts" },
  postes: { fr: "postes", en: "devices" },
  "a-envoyer": { fr: "a-envoyer", en: "to-send" },
  "file-envoi": { fr: "file-envoi", en: "outbox" },
  sauvegardes: { fr: "sauvegardes", en: "backups" },
  heure: { fr: "heure", en: "time" },
  formation: { fr: "formation", en: "training" },
  connexions: { fr: "connexions", en: "connections" },
  journal: { fr: "journal", en: "access-log" },
  "mon-compte": { fr: "mon-compte", en: "my-account" },
};

const VIEW_BY_SLUG = new Map<string, View>([["dashboard", "dashboard"]]);
for (const [view, slugs] of Object.entries(VIEW_SLUGS) as [View, Record<Lang, string>][]) {
  VIEW_BY_SLUG.set(slugs.fr, view);
  VIEW_BY_SLUG.set(slugs.en, view);
}

const SECTION_BY_SLUG = new Map<string, SectionId>();
for (const [section, slugs] of Object.entries(SECTION_SLUGS) as [SectionId, Record<Lang, string>][]) {
  SECTION_BY_SLUG.set(slugs.fr, section);
  SECTION_BY_SLUG.set(slugs.en, section);
}

/** Sépare le chemin de ce qui le suit (`?…`, `#…`). */
function split(url: string): [string, string] {
  const at = url.search(/[?#]/);
  return at === -1 ? [url, ""] : [url.slice(0, at), url.slice(at)];
}

/** `decodeURIComponent`, sans lever d'exception sur un `%` mal encodé (M1, relecture finale) : segment gardé brut. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Écran et identifiant d'une adresse, quelle que soit sa langue ; adresse inconnue : tableau de bord. */
export function parseRoute(url: string): RouteState {
  const [path] = split(url);
  const segments = path.replace(/^\/+|\/+$/g, "").split("/");
  const view = VIEW_BY_SLUG.get(segments[0] ?? "");
  if (!view || view === "dashboard") return { view: "dashboard", id: null };
  const raw = segments[1] ? safeDecode(segments[1]) : null;
  if (view === "reglages" && raw) return { view, id: SECTION_BY_SLUG.get(raw) ?? raw };
  return { view, id: raw };
}

/** Adresse d'un écran (et d'une fiche ou d'une rubrique) dans une langue. */
export function pathFor(view: View, lang: Lang, id?: string | number | null): string {
  const slug = VIEW_SLUGS[view][lang];
  if (!slug) return "/";
  if (id === undefined || id === null || id === "") return `/${slug}`;
  const key = String(id);
  // `Object.hasOwn` et non `in` : « constructor » ou « toString » ne sont pas des rubriques.
  const sub = view === "reglages" && Object.hasOwn(SECTION_SLUGS, key) ? SECTION_SLUGS[key as SectionId][lang] : key;
  return `/${slug}/${encodeURIComponent(sub)}`;
}

/** La même adresse dans une langue, paramètres et ancre gardés, paramètre du panneau traduit. */
export function localizeUrl(url: string, lang: Lang): string {
  const [path, rest] = split(url);
  const { view, id } = parseRoute(path);
  const localized = pathFor(view, lang, id) + rest;
  const panel = parsePanel(url);
  return panel ? withPanel(localized, panel, lang) : localized;
}

/**
 * Élément ouvert dans le panneau de détail (sous-projet 4 § 3.3), sans
 * quitter la liste ou l'agenda : l'adresse le porte en paramètre, dans la
 * langue de l'écran (`/agenda?rdv=12`, `/calendar?appt=12`).
 */
export type PanelKind = "appointment" | "client" | "staff" | "service" | "product" | "account" | "device" | "invoice";
export interface PanelRef {
  kind: PanelKind;
  id: string;
}

const PANEL_KEYS: Record<PanelKind, Record<Lang, string>> = {
  appointment: { fr: "rdv", en: "appt" },
  client: { fr: "cliente", en: "client" },
  staff: { fr: "membre", en: "member" },
  service: { fr: "prestation", en: "service" },
  product: { fr: "produit", en: "product" },
  account: { fr: "compte", en: "account" },
  device: { fr: "poste", en: "device" },
  // Facture ou avoir (sous-projet 5 § 6.1) : ouvert au-dessus de la caisse du jour ou de la fiche d'une cliente.
  invoice: { fr: "facture", en: "invoice" },
};

const PANEL_BY_KEY = new Map<string, PanelKind>();
for (const [kind, keys] of Object.entries(PANEL_KEYS) as [PanelKind, Record<Lang, string>][]) {
  PANEL_BY_KEY.set(keys.fr, kind);
  PANEL_BY_KEY.set(keys.en, kind);
}

/** Identifiant d'élément accepté dans l'adresse : entier positif, sans zéro de tête. */
const PANEL_ID = /^[1-9]\d{0,9}$/;

/** Chemin, paramètres (sans `?`) et ancre (avec `#`) d'une adresse. */
function parts(url: string): [string, string[], string] {
  const hashAt = url.indexOf("#");
  const beforeHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  if (queryAt === -1) return [beforeHash, [], hash];
  return [beforeHash.slice(0, queryAt), beforeHash.slice(queryAt + 1).split("&").filter(Boolean), hash];
}

function join(path: string, params: string[], hash: string): string {
  return path + (params.length ? `?${params.join("&")}` : "") + hash;
}

const isPanelParam = (param: string) => PANEL_BY_KEY.has(param.split("=")[0]);

/** Élément du panneau porté par l'adresse, quelle que soit sa langue ; null sans paramètre valable. */
export function parsePanel(url: string): PanelRef | null {
  for (const param of parts(url)[1]) {
    const [key, value = ""] = param.split("=");
    const kind = PANEL_BY_KEY.get(key);
    if (kind && PANEL_ID.test(value)) return { kind, id: value };
  }
  return null;
}

/** La même adresse, avec l'élément du panneau (ou sans, si `panel` est null), autres paramètres et ancre gardés. */
export function withPanel(url: string, panel: PanelRef | null, lang: Lang): string {
  const [path, params, hash] = parts(url);
  const kept = params.filter((p) => !isPanelParam(p));
  if (panel) kept.push(`${PANEL_KEYS[panel.kind][lang]}=${panel.id}`);
  return join(path, kept, hash);
}

/** La même adresse, panneau fermé. */
export function withoutPanel(url: string): string {
  const [path, params, hash] = parts(url);
  return join(path, params.filter((p) => !isPanelParam(p)), hash);
}

/** Anciennes fiches en page ouvertes désormais dans le panneau au-dessus de leur liste. */
const PAGE_TO_PANEL: Partial<Record<View, PanelKind>> = { appointments: "appointment", clients: "client" };

/**
 * Forme canonique d'une adresse dans une langue : traduite, et l'ancienne
 * fiche d'un rendez-vous ou d'une cliente en page (`/rendez-vous/12`,
 * `/clientes/12`) ouverte dans le panneau au-dessus de la liste
 * (`/rendez-vous?rdv=12`, `/clientes?cliente=12`).
 */
export function canonicalUrl(url: string, lang: Lang): string {
  const [path, rest] = split(url);
  const { view, id } = parseRoute(path);
  const kind = PAGE_TO_PANEL[view];
  if (kind && id && PANEL_ID.test(id)) {
    return withPanel(pathFor(view, lang) + rest, { kind, id }, lang);
  }
  return localizeUrl(url, lang);
}

/** État d'historique posé à l'ouverture du panneau depuis l'écran : « Précédent » le referme. */
export const PANEL_STATE = { panneau: true } as const;

/**
 * Fermeture du panneau : retour dans l'historique s'il a été ouvert depuis
 * l'écran (aucune entrée en trop), sinon (lien direct) l'adresse est
 * remplacée sans le paramètre, pour ne pas quitter l'app.
 */
export function panelCloseMode(historyState: unknown): "back" | "replace" {
  return typeof historyState === "object" && historyState !== null && (historyState as { panneau?: unknown }).panneau === true ? "back" : "replace";
}

/**
 * Ouverture d'un élément dans le panneau : une entrée d'historique est posée
 * (« push ») quand aucun panneau n'est ouvert, ou que sa sorte change (un
 * rendez-vous ouvert depuis la fiche d'une cliente) : fermer le nouveau
 * panneau retrouve alors l'élément précédent (« Précédent »), au lieu de la
 * simple liste. Même sorte déjà ouverte (une autre cliente, un autre
 * rendez-vous) : l'adresse est seulement remplacée, sans entrée par élément.
 */
export function panelOpenMode(current: PanelRef | null, kind: PanelKind): "push" | "replace" {
  return current && current.kind === kind ? "replace" : "push";
}
