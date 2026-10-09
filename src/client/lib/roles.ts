/**
 * Ce que chaque rôle voit à l'écran. Le serveur applique les droits (plan 2A) ;
 * l'interface masque seulement ce qu'il refuserait de toute façon (spec § 3.4).
 */
import type { Role } from "./auth-types.ts";
import type { Key } from "../i18n/translate.ts";

/** Libellé de chaque rôle : `t(ROLE_KEYS[role])`. */
export const ROLE_KEYS: Record<Role, Key> = {
  admin: "role.admin",
  manager: "role.manager",
  reception: "role.reception",
  practitioner: "role.practitioner",
};

export type SectionId = "institut" | "caisse" | "fidelite" | "whatsapp" | "comptes" | "postes" | "a-envoyer" | "file-envoi" | "sauvegardes" | "heure" | "formation" | "connexions" | "journal" | "mon-compte";

const EVERYONE: Role[] = ["admin", "manager", "reception", "practitioner"];

/**
 * Rubriques des Réglages dans l'ordre d'affichage, avec les rôles qui les voient (spec 2 § 4) ;
 * `formation` : seulement dans la base de formation (distribution D-19).
 */
export const SECTIONS: { id: SectionId; labelKey: Key; roles: Role[]; formation?: true }[] = [
  { id: "institut", labelKey: "reglages.rubrique.institut", roles: ["manager"] },
  // Caisse : réglages de la gérante ; l'administrateur y règle le préfixe des factures (distribution D-01).
  { id: "caisse", labelKey: "reglages.rubrique.caisse", roles: ["manager", "admin"] },
  // Fidélité (mini CRM § 2) : règle de gain et paliers de récompense, à la gérante.
  { id: "fidelite", labelKey: "reglages.rubrique.fidelite", roles: ["manager"] },
  // WhatsApp (sous-projet 7) : session, textes et heures d'envoi à la gérante ; le fournisseur dans « Connexions » (administrateur).
  { id: "whatsapp", labelKey: "reglages.rubrique.whatsapp", roles: ["manager"] },
  { id: "comptes", labelKey: "reglages.rubrique.comptes", roles: ["manager", "admin"] },
  { id: "postes", labelKey: "reglages.rubrique.postes", roles: ["manager", "admin"] },
  { id: "a-envoyer", labelKey: "reglages.rubrique.a_envoyer", roles: ["reception", "manager"] },
  { id: "file-envoi", labelKey: "reglages.rubrique.file_envoi", roles: ["reception", "manager", "admin"] },
  { id: "sauvegardes", labelKey: "reglages.rubrique.sauvegardes", roles: ["admin"] },
  // Heure du serveur (distribution D-12) : correction par l'administrateur, mot de passe retapé.
  { id: "heure", labelKey: "reglages.rubrique.heure", roles: ["admin"] },
  // Remise à zéro de la base de formation (distribution D-19) : son administrateur, mot de passe retapé.
  { id: "formation", labelKey: "reglages.rubrique.formation", roles: ["admin"], formation: true },
  { id: "connexions", labelKey: "reglages.rubrique.connexions", roles: ["admin"] },
  { id: "journal", labelKey: "reglages.rubrique.journal", roles: ["manager", "admin"] },
  { id: "mon-compte", labelKey: "reglages.rubrique.mon_compte", roles: EVERYONE },
];

/** Rubriques permises au rôle ; `formation` : l'écran sert la base de formation (`useFormation`). */
export function sectionsFor(role: Role, formation = false) {
  return SECTIONS.filter((s) => s.roles.includes(role) && (s.formation !== true || formation));
}

/**
 * Vrai si l'adresse demande une rubrique que le rôle n'a pas (ou qui n'existe
 * pas) : l'écran corrige alors l'adresse au lieu de la garder affichée sur une
 * autre rubrique. `null` (`/reglages` seul) n'est jamais interdit.
 */
export function forbiddenSection(role: Role, requested: string | null, formation = false): boolean {
  return requested !== null && !sectionsFor(role, formation).some((s) => s.id === requested);
}

/** Fiches des Réglages ouvertes dans le panneau : un compte (rubrique Comptes), un poste (rubrique Postes). */
export function settingsPanelAllowed(role: Role, kind: string): boolean {
  const section: SectionId | null = kind === "account" ? "comptes" : kind === "device" ? "postes" : null;
  return section !== null && sectionsFor(role).some((s) => s.id === section);
}

/** Rubrique affichée : celle demandée si le rôle y a droit, sinon la première permise. */
export function sectionFor(role: Role, requested: string | null, formation = false): SectionId {
  const allowed = sectionsFor(role, formation);
  return (allowed.find((s) => s.id === requested) ?? allowed[0]).id;
}

export type ActivityView = "dashboard" | "calendar" | "appointments" | "caisse" | "clients" | "staff" | "services" | "products";
const ACTIVITY: ActivityView[] = ["dashboard", "calendar", "appointments", "caisse", "clients", "staff", "services", "products"];

/**
 * Écrans du menu. L'administrateur n'a que les Réglages : aucun accès à
 * l'activité (spec § 2). « Caisse du jour » (sous-projet 5 § 6.3) : à qui
 * vend seulement, gérante et réception, comme le serveur.
 */
export function menuFor(role: Role): (ActivityView | "reglages")[] {
  return role === "admin" ? ["reglages"] : [...ACTIVITY.filter((v) => v !== "caisse" || canSell(role)), "reglages"];
}

export function homePath(role: Role): string {
  return role === "admin" ? "/reglages" : "/";
}

/** Vente et encaissement (sous-projet 5 § 4.5) : gérante et réception, mêmes règles que le serveur. */
export const canSell = (role: Role) => role === "manager" || role === "reception";

/**
 * « Encaisser » un rendez-vous : gérante et réception toujours, même avec un
 * acompte en attente (elles décident) ; la praticienne son propre rendez-vous
 * seulement, si la gérante a activé l'encaissement par la praticienne
 * (demande produit du 30/09/2026), et jamais s'il a un acompte en
 * attente (correctif final, point 1) : le serveur le refuse à l'émission
 * (`vente.praticienne_acompte`), la fiche ne lui propose donc pas « Encaisser ».
 */
export function canChargeAppointment(account: { role: Role; staff_id: number | null }, apt: { staff_id: number | null; deposit_held?: number }, practitionerCheckout: boolean): boolean {
  if (canSell(account.role)) return true;
  return account.role === "practitioner" && practitionerCheckout && account.staff_id !== null && apt.staff_id === account.staff_id && !apt.deposit_held;
}

/**
 * Vrai si le rôle peut ouvrir cet écran : la page `/charte`, hors menu, reste
 * ouverte à tous ; l'écran « Vente », hors menu lui aussi, à qui vend, et à
 * la praticienne pour un rendez-vous seulement (`/vente/12`, ouvert depuis
 * sa fiche ; jamais le comptoir, le serveur vérifie le reste).
 */
export function mayOpen(role: Role, view: string, id: string | null = null): boolean {
  if (view === "vente") return canSell(role) || (role === "practitioner" && id !== null);
  return view === "charte" || (menuFor(role) as string[]).includes(view);
}

export const loadsActivity = (role: Role) => role !== "admin";
export const canSeeOutbox = (role: Role) => role !== "practitioner";
/**
 * Supprimer, déplacer, réattribuer un rendez-vous, changer son statut et
 * supprimer une note : gérante et réception seulement (mêmes règles que le
 * serveur). La praticienne lit la fiche et ajoute une note.
 */
export const canManageAppointments = (role: Role) => role === "manager" || role === "reception";

/** Commandes d'un rendez-vous et de l'agenda montrées à un rôle. */
export interface AppointmentCommands {
  create: boolean;
  block: boolean;
  changeStatus: boolean;
  move: boolean;
  remove: boolean;
  deleteNote: boolean;
  addNote: boolean;
}

/**
 * Commandes montrées selon le rôle (sous-projet 4 § 4.3), mêmes règles que le
 * serveur (`src/server/auth/permissions.ts`) : gérante et réception font tout ;
 * la praticienne lit et ajoute une note ; l'administrateur ne voit pas l'activité.
 */
export function appointmentCommands(role: Role): AppointmentCommands {
  const manage = canManageAppointments(role);
  return { create: manage, block: manage, changeStatus: manage, move: manage, remove: manage, deleteNote: manage, addNote: role !== "admin" };
}
export const canSeeBackupStatus = (role: Role) => role === "admin" || role === "manager";
/** « À envoyer à la main », pastille et message libre : réception et gérante, jamais l'administrateur (le texte des messages). */
export const canSeeManual = (role: Role) => role === "manager" || role === "reception";
/** Démarrer ou délier la session WhatsApp, voir le QR code : administrateur et gérante. */
export const canLinkWhatsapp = (role: Role) => role === "admin" || role === "manager";

const TEAM: Role[] = ["reception", "practitioner"];

/**
 * Rôles qu'un compte peut créer depuis l'écran. L'administrateur ne crée pas de
 * praticienne : elle doit être reliée à une fiche de l'équipe, qu'il ne voit pas.
 */
export function creatableRoles(role: Role): Role[] {
  if (role === "admin") return ["admin", "manager", "reception"];
  if (role === "manager") return TEAM;
  return [];
}

/**
 * Rôle proposé à l'ouverture de « Nouveau compte » (décision 10 de la passe
 * V 1.0) : la réception si elle fait partie des rôles permis, sinon le
 * premier de la liste.
 */
export function defaultNewRole(roles: readonly Role[]): Role {
  return roles.includes("reception") ? "reception" : roles[0];
}

/** Même règle que le serveur (`mayManage`, plan 2A) : l'administrateur gère tout, la gérante son équipe et elle-même. */
export function mayManageAccount(actor: { id: number; role: Role }, target: { id: number; role: Role }): boolean {
  if (actor.role === "admin") return true;
  if (actor.role !== "manager") return false;
  return target.id === actor.id || TEAM.includes(target.role);
}
