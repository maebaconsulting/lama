/**
 * Règles des fiches de la vague 4 (sous-projet 4 § 6) : clientes, équipe,
 * prestations, produits. Module pur, testé sous Node. Les commandes suivent
 * les droits du serveur (`src/server/auth/permissions.ts`) : l'écran masque
 * seulement ce que le serveur refuserait de toute façon.
 */
import type { Role } from "./auth-types.ts";
import type { PanelKind, PanelRef } from "./routes.ts";

/** Commandes d'une cliente selon le rôle. */
export interface ClientCommands {
  /** « Nouvelle cliente ». */
  create: boolean;
  /** Nom, téléphone, e-mail, anniversaire, étiquettes. */
  edit: boolean;
  /** Note sur la cliente (la praticienne l'écrit aussi). */
  editNotes: boolean;
  /** Préférences (mini CRM, décision 4 : la praticienne les écrit aussi). */
  editPreferences: boolean;
  remove: boolean;
  /** « Nouveau rendez-vous » pré-rempli avec la cliente. */
  book: boolean;
}

/** Gérante et réception gèrent les clientes ; la praticienne lit et écrit la note et les préférences ; l'administrateur ne voit pas l'activité. */
export function clientCommands(role: Role): ClientCommands {
  const front = role === "manager" || role === "reception";
  const team = front || role === "practitioner";
  return { create: front, edit: front, editNotes: team, editPreferences: team, remove: front, book: front };
}

/** Équipe et prestations : seule la gérante crée, modifie, désactive et supprime. */
export function catalogCommands(role: Role): { manage: boolean } {
  return { manage: role === "manager" };
}

/** Produits : la gérante gère tout (photo comprise), la réception ajuste le stock (seul champ qu'elle peut modifier), la praticienne lit. */
export function productCommands(role: Role): { manage: boolean; adjustStock: boolean; photo: boolean } {
  return { manage: role === "manager", adjustStock: role === "manager" || role === "reception", photo: role === "manager" };
}

/** Stock après un appui sur − (`-1`) ou + (`1`) : entier, jamais sous zéro. */
export function stockAfter(stock: number, delta: number): number {
  const base = Number.isFinite(stock) ? Math.trunc(stock) : 0;
  return Math.max(0, base + delta);
}

/** Lien d'appel d'un numéro (`tel:+237677123456`) ; null s'il n'y a pas au moins 6 chiffres. */
export function telHref(phone: string | null | undefined): string | null {
  const compact = (phone ?? "").replace(/[^\d+]/g, "");
  return compact.replace(/\D/g, "").length >= 6 ? `tel:${compact}` : null;
}

/** Vrai si l'élément `kind`/`id` est celui ouvert dans le panneau : sa ligne est marquée dans la liste. */
export function isOpen(panel: PanelRef | null, kind: PanelKind, id: number): boolean {
  return panel !== null && panel.kind === kind && panel.id === String(id);
}
