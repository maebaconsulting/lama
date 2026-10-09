/**
 * Fournisseur SMS (spec du 04/10/2026, § 2) : application SMS Gateway for
 * Android (capcom6, Apache-2.0) en mode serveur local sur un téléphone de
 * l'institut. `POST /message` avec `{ textMessage: { text }, phoneNumbers }`,
 * authentification basique, port 8080 (README du projet, 04/10/2026) ; état
 * par `GET /health` (à confirmer sur `/docs` du vrai téléphone). Délai de
 * 10 s par appel. Le téléphone envoie par le réseau mobile : pas besoin
 * d'internet.
 */
import { coded } from "../messages.ts";
import { estFormation } from "../formation/mode.ts";
import { PermanentError, TemporaryError } from "../outbox/outbox.ts";
import { parseLocalAddress } from "../reseau-local.ts";
import { getSetting } from "../settings.ts";

export type SmsStatus = { state: "joignable" | "identifiants" | "injoignable" };

export interface SmsProvider {
  status(): Promise<SmsStatus>;
  /** `to` : numéro international en chiffres seuls (`237699123456`). */
  sendText(to: string, text: string): Promise<void>;
}

export function createGateway(opts: { address: string; username: string; password: string; fetch?: typeof fetch; timeoutMs?: number }): SmsProvider {
  const fetchImpl = opts.fetch ?? fetch;
  const auth = `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString("base64")}`;
  const parsed = parseLocalAddress(opts.address, 8080, process.env.LAMA_SMS_ESSAI === "1");
  const base = parsed ? `http://${parsed.host}:${parsed.port}` : "";

  async function call(method: string, path: string, body?: unknown): Promise<Response> {
    if (!base) throw new TemporaryError(coded("sms.injoignable"));
    try {
      return await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: auth, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch {
      throw new TemporaryError(coded("sms.injoignable"));
    }
  }

  return {
    async status() {
      let res: Response;
      try {
        res = await call("GET", "/health");
      } catch {
        return { state: "injoignable" };
      }
      if (res.status === 401 || res.status === 403) return { state: "identifiants" };
      return res.ok ? { state: "joignable" } : { state: "injoignable" };
    },

    async sendText(to, text) {
      const res = await call("POST", "/message", { textMessage: { text }, phoneNumbers: [`+${to}`] });
      if (res.ok) return;
      if (res.status === 401 || res.status === 403) throw new TemporaryError(coded("sms.identifiants"));
      if (res.status >= 500) throw new TemporaryError(coded("sms.passerelle_erreur", { code: res.status }));
      throw new PermanentError(coded("sms.refus", { code: res.status }));
    },
  };
}

/** Fournisseur choisi par l'administrateur ; `null` pour « aucun » ou une adresse vide ou invalide. */
export async function smsProviderFromSettings(fetchImpl: typeof fetch = fetch): Promise<SmsProvider | null> {
  // Base de formation (D-17) : aucune passerelle, même réglée ; rien ne part.
  if (estFormation()) return null;
  if ((await getSetting<string>("sms.fournisseur")) !== "passerelle") return null;
  const address = await getSetting<string>("sms.adresse");
  if (!parseLocalAddress(address, 8080, process.env.LAMA_SMS_ESSAI === "1")) return null;
  return createGateway({
    address,
    username: await getSetting<string>("sms.identifiant"),
    password: (await getSetting<string | null>("sms.mot_de_passe")) ?? "",
    fetch: fetchImpl,
  });
}
