/**
 * Fournisseur WAHA (sous-projet 7 § 4) : passerelle HTTP locale branchée sur
 * WhatsApp Web. Points d'API vérifiés sur la documentation de WAHA 2026.9
 * (https://waha.devlike.pro/docs/) et un conteneur réel, moteur GOWS : voir
 * le plan de la vague 1. En-tête `X-Api-Key` sur chaque appel, délai court.
 */
import { coded } from "../messages.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import type { LinkedSession, ProviderStatus, WhatsappProvider } from "./fournisseur.ts";

export interface WahaOptions {
  baseUrl: string;
  apiKey: string;
  session: string;
  fetch?: typeof fetch;
  /** Délai d'attente de chaque appel (10 s par défaut, 45 s pour l'envoi du texte). */
  timeoutMs?: number;
}

/**
 * Délai de l'envoi du texte lui-même (`POST /api/sendText`), plus long que les
 * autres appels : une relance après un délai dépassé doit viser « au moins
 * une fois », pas « au plus une fois ». Sur une connexion lente, un délai
 * court ferait relancer un envoi qui a en réalité abouti côté WAHA, doublant
 * le message reçu par la cliente ; 45 s laisse à la passerelle le temps de
 * vraiment échouer avant que la file ne réessaie.
 */
const SEND_TEXT_TIMEOUT_MS = 45_000;

/**
 * Réponses par lesquelles la passerelle refuse la commande `sendImage`
 * elle-même (absente de l'édition installée, moteur qui ne la prend pas) ;
 * le numéro et la session viennent d'être vérifiés. Repli sur `sendFile`.
 */
const IMAGE_REFUSED = new Set([400, 404, 405, 422, 501]);

const STATES: Record<string, ProviderStatus["state"]> = {
  WORKING: "connecte", SCAN_QR_CODE: "qr", STARTING: "demarrage", STOPPED: "deconnecte", FAILED: "erreur",
};

export function createWaha(opts: WahaOptions): WhatsappProvider & LinkedSession {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const fetchImpl = opts.fetch ?? fetch;
  const session = encodeURIComponent(opts.session);

  /**
   * Appel brut ; réseau coupé ou délai dépassé : passerelle injoignable
   * (temporaire). `timeoutMs` : délai propre à cet appel (45 s pour l'envoi
   * du texte) ; un délai explicite sur `opts` (tests) garde la priorité.
   */
  async function call(method: string, path: string, body?: unknown, accept = "application/json", timeoutMs?: number): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, {
        method,
        headers: { "X-Api-Key": opts.apiKey, accept, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? timeoutMs ?? 10_000),
      });
    } catch {
      throw new TemporaryError(coded("whatsapp.injoignable"));
    }
  }

  /** Classement d'une réponse en échec (spec § 3, « Fournisseurs »). */
  function failure(res: Response): Error {
    if (res.status === 401 || res.status === 403) return new TemporaryError(coded("whatsapp.cle_refusee"));
    if (res.status === 404 || res.status === 422) return new TemporaryError(coded("whatsapp.session_non_connectee"));
    if (res.status === 429) return new TemporaryError(coded("whatsapp.debit"));
    if (res.status >= 500) return new TemporaryError(coded("whatsapp.passerelle_erreur", { code: res.status }));
    return new PermanentError(coded("whatsapp.refus", { code: res.status }));
  }

  async function ok(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<Response> {
    const res = await call(method, path, body, "application/json", timeoutMs);
    if (!res.ok) throw failure(res);
    return res;
  }

  /** Numéro sur WhatsApp, avant tout envoi (texte ou document). */
  async function checkNumber(to: string): Promise<void> {
    const check = await ok("GET", `/api/contacts/check-exists?phone=${encodeURIComponent(to)}&session=${session}`);
    const { numberExists } = (await check.json()) as { numberExists?: boolean };
    // Échec définitif seulement si la passerelle répond explicitement « non » ; toute autre forme
    // (absente, non booléenne) est une erreur temporaire, pas un numéro à écarter pour de bon.
    if (numberExists === false) throw new PermanentError(coded("whatsapp.numero_absent"));
    if (numberExists !== true) throw new TemporaryError(coded("whatsapp.reponse_inattendue"));
  }

  return {
    async status() {
      let res: Response;
      try {
        res = await call("GET", `/api/sessions/${session}`);
      } catch {
        return { state: "injoignable" };
      }
      if (res.status === 404) return { state: "deconnecte" };
      if (!res.ok) return { state: "erreur" };
      const info = (await res.json()) as { status?: string; me?: { id?: string } | null };
      const state = STATES[info.status ?? ""] ?? "erreur";
      const phone = state === "connecte" ? info.me?.id?.replace(/@.*$/, "") : undefined;
      return phone ? { state, phone } : { state };
    },

    async start() {
      // Déjà démarrée : WAHA répond 201 sans rien changer.
      const res = await call("POST", `/api/sessions/${session}/start`);
      if (res.ok) return;
      if (res.status !== 404) throw failure(res);
      // Aucune session au premier démarrage du conteneur (ou autre nom) : création et démarrage.
      await ok("POST", "/api/sessions", { name: opts.session, start: true });
    },

    async logout() {
      await ok("POST", `/api/sessions/${session}/logout`);
    },

    async qr() {
      const res = await ok("GET", `/api/${session}/auth/qr?format=image`);
      const body = (await res.json()) as { mimetype: string; data: string };
      return { mimetype: body.mimetype, data: body.data };
    },

    async sendText(to, text) {
      await checkNumber(to);
      await ok("POST", "/api/sendText", { session: opts.session, chatId: `${to}@c.us`, text }, SEND_TEXT_TIMEOUT_MS);
    },

    /**
     * Vague 2 : ticket, avoir ou reçu d'acompte. `POST /api/sendFile` avec le
     * PDF en base64 (`file.data`), son nom, son type et le texte en légende
     * (vérifié sur la documentation et un conteneur réel, moteur GOWS) ; même
     * délai long que le texte, même contrôle du numéro.
     */
    async sendDocument(to, file, caption) {
      await checkNumber(to);
      await ok("POST", "/api/sendFile", {
        session: opts.session, chatId: `${to}@c.us`, caption,
        file: { mimetype: file.mime, filename: file.name, data: file.data.toString("base64") },
      }, SEND_TEXT_TIMEOUT_MS);
    },

    /**
     * Photo d'un produit (images des produits) : `POST /api/sendImage`, vue
     * comme une photo par la cliente, texte en légende ; si la passerelle
     * refuse la commande (`IMAGE_REFUSED`), repli sur `POST /api/sendFile`,
     * éprouvé pour les tickets. À vérifier sur le conteneur de l'institut.
     */
    async sendImage(to, file, caption) {
      await checkNumber(to);
      const body = {
        session: opts.session, chatId: `${to}@c.us`, caption,
        file: { mimetype: file.mime, filename: file.name, data: file.data.toString("base64") },
      };
      const res = await call("POST", "/api/sendImage", body, "application/json", SEND_TEXT_TIMEOUT_MS);
      if (res.ok) return;
      if (!IMAGE_REFUSED.has(res.status)) throw failure(res);
      console.warn(`[whatsapp] sendImage refusé (HTTP ${res.status}), repli sur sendFile`);
      await ok("POST", "/api/sendFile", body, SEND_TEXT_TIMEOUT_MS);
    },
  };
}
