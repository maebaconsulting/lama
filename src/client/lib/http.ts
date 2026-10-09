/**
 * Couche HTTP du navigateur : en-têtes, lecture des réponses et signaux de
 * session. Sans dépendance au navigateur, pour être testée sous Node.
 */
import { translate, type Lang } from "../i18n/translate.ts";
import { ENTETE_VERSION_ECRAN, VERSION_ECRAN } from "../../shared/version-ecran.ts";

/** Refus qui changent l'écran affiché par la porte d'entrée. */
export type SessionSignal = "installation" | "connexion" | "verrouille" | "maintenance";

/** Refus du serveur, avec le statut, le code (`connexion`, `confirmation`…) et le corps. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: unknown;

  constructor(message: string, status: number, code: string | null, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

const SAFE = new Set(["GET", "HEAD"]);

/**
 * Options de `fetch` : JSON, cookies du même site, `X-Lama: 1` sur toute
 * modification (spec 2 § 3.3), langue de l'écran et version de l'écran (PWA, P-05).
 */
export function requestInit(method: string, body?: unknown, lang?: Lang): RequestInit {
  const upper = method.toUpperCase();
  const headers: Record<string, string> = { [ENTETE_VERSION_ECRAN]: String(VERSION_ECRAN) };
  if (!SAFE.has(upper)) headers["X-Lama"] = "1";
  if (lang) headers["Accept-Language"] = lang;
  const init: RequestInit = { method: upper, headers, credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return init;
}

/** Options de `fetch` pour déposer un fichier tel quel (corps binaire) : mêmes en-têtes que `requestInit`. */
export function uploadInit(method: string, file: Blob, lang?: Lang): RequestInit {
  const headers: Record<string, string> = { "X-Lama": "1", "Content-Type": "application/octet-stream", [ENTETE_VERSION_ECRAN]: String(VERSION_ECRAN) };
  if (lang) headers["Accept-Language"] = lang;
  return { method: method.toUpperCase(), headers, credentials: "same-origin", body: file };
}

/** Renvoie le JSON d'une réponse réussie, sinon lève une `ApiError` au message lisible. */
export function parseResponse<T>(status: number, text: string, lang: Lang = "fr"): T {
  let data: unknown = null;
  let readable = true;
  if (text) {
    try { data = JSON.parse(text); } catch { readable = false; }
  }
  if (status >= 200 && status < 300) {
    if (!readable) throw new ApiError(translate(lang, "erreur.illisible"), status, null, text);
    return data as T;
  }
  const obj = (readable && data && typeof data === "object" ? data : {}) as { error?: unknown; code?: unknown };
  const message = typeof obj.error === "string" && obj.error ? obj.error : translate(lang, "erreur.serveur", { status });
  throw new ApiError(message, status, typeof obj.code === "string" ? obj.code : null, readable ? data : text);
}

/** Traduit un refus en signal pour la porte d'entrée ; `null` si l'écran courant doit le gérer. */
export function signalFor(error: ApiError): SessionSignal | null {
  if (error.status === 409 && error.code === "installation") return "installation";
  if (error.status === 401 && error.code === "connexion") return "connexion";
  if (error.status === 401 && error.code === "verrouille") return "verrouille";
  if (error.status === 503 && error.code === "maintenance") return "maintenance";
  return null;
}
