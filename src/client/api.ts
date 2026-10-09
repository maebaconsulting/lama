import type { Lang } from "./i18n/translate.ts";
import { translate } from "./i18n/translate.ts";
import { ApiError, parseResponse, requestInit, signalFor, uploadInit } from "./lib/http.ts";
import { emitSessionSignal } from "./lib/session-bus.ts";
import { noterDate } from "./lib/heure.ts";
import { rechargerEcranPerime } from "./lib/mise-a-jour.ts";
import { noterJoignable } from "./lib/joignable.ts";

export { ApiError };

let lang: Lang = "fr";

/** Langue envoyée au serveur (`Accept-Language`) et des messages d'erreur de l'écran ; posée par `I18nProvider`. */
export function setApiLang(next: Lang): void {
  lang = next;
}

/** Refus qui changent d'écran : signal à la porte d'entrée, ou écran trop ancien rechargé (PWA, P-05). */
function signaler(error: ApiError): void {
  const signal = signalFor(error);
  if (signal) emitSessionSignal(signal);
  if (error.status === 409 && error.code === "ecran_perime") rechargerEcranPerime();
}

/**
 * Seule porte vers l'API : ajoute `X-Lama` aux modifications et la langue de
 * l'écran, lève une `ApiError` au message lisible et prévient la porte
 * d'entrée quand la session est perdue, le poste verrouillé ou le serveur en
 * maintenance.
 */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, requestInit(method, body, lang));
  } catch {
    // Serveur injoignable (PWA, P-04) : le bandeau le dit tant qu'aucune réponse n'est revenue.
    noterJoignable(false);
    throw new ApiError(translate(lang, "erreur.reseau"), 0, "reseau", null);
  }
  noterJoignable(true);
  // Heure du serveur (distribution D-11) : l'en-tête Date de chaque réponse, comparé à l'horloge de l'appareil.
  noterDate(response.headers.get("date"), Date.now());
  const text = await response.text();
  try {
    return parseResponse<T>(response.status, text, lang);
  } catch (error) {
    if (error instanceof ApiError) signaler(error);
    throw error;
  }
}

/** Dépose un fichier (le logo de l'institut) en corps binaire ; mêmes erreurs et mêmes signaux de session que `api`. */
export async function apiUpload<T>(method: "PUT", path: string, file: Blob): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, uploadInit(method, file, lang));
  } catch {
    // Serveur injoignable (PWA, P-04) : le bandeau le dit tant qu'aucune réponse n'est revenue.
    noterJoignable(false);
    throw new ApiError(translate(lang, "erreur.reseau"), 0, "reseau", null);
  }
  noterJoignable(true);
  const text = await response.text();
  try {
    return parseResponse<T>(response.status, text, lang);
  } catch (error) {
    if (error instanceof ApiError) signaler(error);
    throw error;
  }
}

/**
 * Fichier binaire (le PDF du ticket, § 5.1) : le corps réussi est un `Blob`,
 * jamais du JSON ; un refus reste au message lisible du serveur, comme `api`.
 */
export async function apiBlob(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, requestInit("GET", undefined, lang));
  } catch {
    // Serveur injoignable (PWA, P-04) : le bandeau le dit tant qu'aucune réponse n'est revenue.
    noterJoignable(false);
    throw new ApiError(translate(lang, "erreur.reseau"), 0, "reseau", null);
  }
  noterJoignable(true);
  if (response.ok) return response.blob();
  const text = await response.text();
  try {
    return parseResponse<Blob>(response.status, text, lang);
  } catch (error) {
    if (error instanceof ApiError) signaler(error);
    throw error;
  }
}
