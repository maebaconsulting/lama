/**
 * Règles du cadre de l'application (sous-projet 4 § 3.3), sans dépendance au
 * navigateur (testées sous Node) : rubriques du rail, onglets du téléphone,
 * « Plus », action du bouton « + ».
 */
import type { Key } from "../i18n/translate.ts";
import type { Appointment, View } from "../types.ts";
import type { Role } from "./auth-types.ts";
import { TIME_ZONE } from "./format.ts";
import { menuFor } from "./roles.ts";

/** Point de rupture : rail et panneau à droite à partir de 768 px, onglets en bas en dessous. */
export const BREAKPOINT_PX = 768;

/** À partir de 1280 px, le panneau de détail se range en colonne à côté de la page ; en dessous, il se pose par-dessus. */
export const PANEL_COLUMN_PX = 1280;

/**
 * Rail replié (icônes seules) tant qu'un panneau est posé par-dessus la page
 * (768 à 1279 px) : déployé, il ne laisserait que 150 px à l'agenda. Le choix
 * enregistré sur l'appareil n'est pas modifié, il revient à la fermeture.
 */
export function railFolded(panelOpen: boolean, panelInColumn: boolean): boolean {
  return panelOpen && !panelInColumn;
}

/** Rubriques de navigation (la page /charte, l'écran « Vente » et l'écran « Demandes en ligne » restent hors menu). */
export type NavView = Exclude<View, "charte" | "vente" | "demandes">;

const VIEW_KEYS: Record<Exclude<NavView, "dashboard">, Key> = {
  calendar: "menu.agenda",
  appointments: "menu.rendez_vous",
  caisse: "menu.caisse",
  clients: "menu.clientes",
  staff: "menu.equipe",
  services: "menu.prestations",
  products: "menu.produits",
  reglages: "menu.reglages",
};

/** Libellé d'une rubrique : l'accueil s'appelle « Ma journée » pour la praticienne, « Aujourd'hui » pour les autres. */
export function viewLabelKey(view: NavView, role: Role): Key {
  if (view === "dashboard") return role === "practitioner" ? "cadre.ma_journee" : "cadre.aujourdhui";
  return VIEW_KEYS[view];
}

/** Rubriques du rail, dans l'ordre du menu, permises au rôle. */
export function railViews(role: Role): NavView[] {
  return menuFor(role);
}

const TABS: Record<Role, NavView[]> = {
  practitioner: ["dashboard", "calendar", "clients"],
  reception: ["dashboard", "calendar", "appointments", "clients"],
  manager: ["dashboard", "calendar", "clients", "staff"],
  admin: ["reglages"],
};

/** Onglets du téléphone avant « Plus » : quatre destinations au plus, toutes permises au rôle. */
export function phoneTabs(role: Role): NavView[] {
  const allowed: NavView[] = menuFor(role);
  return TABS[role].filter((view) => allowed.includes(view));
}

/** Rubriques rangées dans « Plus » : celles du rôle qui ne sont pas en onglet, dans l'ordre du menu. */
export function moreViews(role: Role): NavView[] {
  const tabs = phoneTabs(role);
  return railViews(role).filter((view) => !tabs.includes(view));
}

export type PrimaryAction = "nouveau-rdv" | "note-prochain-rdv";

/** Action du bouton « + » d'un écran qui n'en déclare pas d'autre ; aucune pour l'administrateur. */
export function defaultPrimaryAction(role: Role): PrimaryAction | null {
  if (role === "practitioner") return "note-prochain-rdv";
  if (role === "reception" || role === "manager") return "nouveau-rdv";
  return null;
}

/**
 * Fiche de l'équipe dont le « + » suit le prochain rendez-vous : celle de la
 * praticienne sur téléphone seulement. À partir de 768 px le « + » est masqué,
 * rien n'est chargé (`null`).
 */
export function plusWatchesStaff(action: PrimaryAction | null, staffId: number | null, wide: boolean): number | null {
  return action === "note-prochain-rdv" && !wide ? staffId : null;
}

const OVER = new Set(["completed", "cancelled", "no_show"]);

/**
 * Prochain rendez-vous d'une praticienne ce jour-là à l'heure `time` : en
 * cours ou à venir, ni terminé, ni annulé, ni absente ; le plus tôt d'abord.
 */
export function nextAppointment(appointments: Appointment[], staffId: number | null, day: string, time: string): Appointment | null {
  if (staffId === null) return null;
  return appointments
    .filter((a) => a.staff_id === staffId && a.scheduled_date === day && !OVER.has(a.status) && a.end_time > time)
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0] ?? null;
}

/** Délai jusqu'à la prochaine minute pleine (Douala n'a pas de décalage en secondes) : l'horloge change à hh:mm:00. */
export function msToNextMinute(nowMs: number): number {
  return 60_000 - (nowMs % 60_000);
}

/** Heure de l'institut (Douala), `HH:MM` sur 24 h, quelle que soit l'heure de l'appareil. */
export function timeAt(now: Date = new Date(), timeZone: string = TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}
