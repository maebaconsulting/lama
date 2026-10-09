/** Fonctions pures des formulaires des Réglages. */
import type { Setting } from "./api-types.ts";
import type { Account, Role } from "./auth-types.ts";
import { mayManageAccount } from "./roles.ts";
import { nameProblem, passwordProblem, pinProblem } from "./forms.ts";
import type { Key, Lang } from "../i18n/translate.ts";

/** Valeurs des réglages demandés, en texte (champ vide si le réglage n'est pas visible). */
export function valuesOf(settings: Setting[], keys: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key) => {
    const value = settings.find((s) => s.key === key)?.value;
    return [key, value === null || value === undefined ? "" : String(value)];
  }));
}

/** Champs dont la valeur a changé, pour n'enregistrer (et ne journaliser) que ceux-là. */
export function changedKeys(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(after).filter((key) => after[key] !== before[key]);
}

/** Comme `changedKeys`, limité à un groupe de champs (un formulaire parmi plusieurs sur le même état). */
export function changedKeysIn(before: Record<string, string>, after: Record<string, string>, group: readonly string[]): string[] {
  return changedKeys(before, after).filter((key) => group.includes(key));
}

/**
 * Fusionne un rechargement serveur (`fresh`) avec une saisie en cours, sans
 * perdre ni faire passer à tort pour « à enregistrer » un champ que la
 * personne n'a pas touché : un champ non modifié (`form[key] === baseline[key]`)
 * prend la nouvelle valeur, dans la saisie comme dans la référence ; un champ
 * modifié garde sa saisie et sa référence d'origine.
 */
export function rebase(
  baseline: Record<string, string>,
  form: Record<string, string>,
  fresh: Record<string, string>,
): { baseline: Record<string, string>; form: Record<string, string> } {
  const nextBaseline: Record<string, string> = { ...baseline };
  const nextForm: Record<string, string> = { ...form };
  for (const key of Object.keys(fresh)) {
    if (form[key] === baseline[key]) {
      nextBaseline[key] = fresh[key];
      nextForm[key] = fresh[key];
    }
  }
  return { baseline: nextBaseline, form: nextForm };
}

export interface AccountForm {
  display_name: string;
  active: boolean;
  /** Nouveau mot de passe, vide pour ne pas le changer. */
  password: string;
  /** Nouveau PIN, vide pour ne pas le changer. */
  pin: string;
  removePin: boolean;
  /** Fiche de l'équipe (praticienne), en texte pour la liste déroulante ; vide si aucune. */
  staff_id: string;
  /** Langue du compte (spec § 3.2). */
  language: Lang;
}

/** Ce qui change dans un compte : rien d'autre n'est envoyé (ni journalisé). */
export function accountPatch(target: Account, f: AccountForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const name = f.display_name.trim();
  if (name !== target.display_name) patch.display_name = name;
  if ((f.active ? 1 : 0) !== target.active) patch.active = f.active;
  if (f.password) patch.password = f.password;
  if (f.removePin) patch.pin = null;
  else if (f.pin) patch.pin = f.pin;
  const staffId = f.staff_id === "" ? null : Number(f.staff_id);
  if (target.role === "practitioner" && staffId !== target.staff_id) patch.staff_id = staffId;
  if (f.language !== undefined && f.language !== target.language) patch.language = f.language;
  return patch;
}

export function accountPatchProblem(f: AccountForm): Key | null {
  return nameProblem(f.display_name)
    ?? (f.password ? passwordProblem(f.password) : null)
    ?? (f.pin && !f.removePin ? pinProblem(f.pin) : null);
}

/**
 * Commandes de la fiche d'un compte (sous-projet 4 § 7.1) : modifier selon la
 * règle du serveur (`mayManageAccount`), débloquer seulement un compte encore
 * bloqué à l'instant `now`.
 */
export function accountCommands(
  actor: { id: number; role: Role },
  target: { id: number; role: Role; locked_until: number | null },
  now: number,
): { edit: boolean; unlock: boolean } {
  const edit = mayManageAccount(actor, target);
  return { edit, unlock: edit && target.locked_until !== null && target.locked_until > now };
}

/** Même motif que le serveur : aucun chemin, aucun tiret initial. */
export const BACKUP_NAME = /^lama-\d{8}-\d{4}\.db\.gz\.age$/;

export function restoreProblem(f: { source: "usb" | "drive"; name: string; identity: string; understood: boolean }): Key | null {
  if (!BACKUP_NAME.test(f.name)) return "restauration.probleme.nom";
  if (!f.identity.trim().startsWith("AGE-SECRET-KEY-1")) return "restauration.probleme.cle";
  if (!f.understood) return "restauration.probleme.compris";
  return null;
}
