/**
 * Contrôles de saisie avant envoi. Mêmes règles que le serveur, qui reste juge.
 * Chaque contrôle renvoie une clé de dictionnaire, traduite par l'écran.
 */
import type { Key } from "../i18n/translate.ts";
import { readAmount } from "./format.ts";
import { pinFormatOk, pinTooSimple } from "../../shared/pin.ts";

export function nameProblem(name: string): Key | null {
  return name.trim() ? null : "formulaire.nom_obligatoire";
}

export function loginProblem(login: string): Key | null {
  return /^[a-z0-9._-]{3,32}$/i.test(login) ? null : "formulaire.identifiant_invalide";
}

export function passwordProblem(password: string): Key | null {
  return [...password].length >= 10 ? null : "formulaire.mot_de_passe_court";
}

export function confirmationProblem(password: string, confirmation: string): Key | null {
  return password === confirmation ? null : "formulaire.confirmation_differente";
}

/** Format, puis PIN trop simple (0000, 1234…), mêmes règles que le serveur (shared/pin.ts). */
export function pinProblem(pin: string): Key | null {
  if (!pinFormatOk(pin)) return "formulaire.pin_format";
  return pinTooSimple(pin) ? "formulaire.pin_simple" : null;
}

/** Premier problème d'un formulaire de nouveau compte, ou `null`. Le PIN est facultatif. */
export function newAccountProblem(input: { display_name: string; login: string; password: string; confirmation: string; pin: string }): Key | null {
  return nameProblem(input.display_name)
    ?? loginProblem(input.login.trim())
    ?? passwordProblem(input.password)
    ?? confirmationProblem(input.password, input.confirmation)
    ?? (input.pin ? pinProblem(input.pin) : null);
}

/** Seuil d'alerte de stock saisi : 0 reste 0 ; un champ vide ou illisible vaut 5 (V1-19). */
export function lowStockValue(text: string): number {
  const value = parseInt(text, 10);
  return Number.isFinite(value) ? value : 5;
}

/**
 * Prix ou coût saisi : `null` s'il se lit (vide compris, il vaut 0), sinon la
 * clé du message qui le refuse dans la fenêtre, saisie gardée (décision 8, V1-12).
 */
export function amountProblem(text: string, field: "prix" | "cout"): Key | null {
  if (readAmount(text) !== null) return null;
  return field === "prix" ? "formulaire.prix_illisible" : "formulaire.cout_illisible";
}
