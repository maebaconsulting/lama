/**
 * Signature des appels de lama (contrat v1) : HMAC-SHA256, en hexadécimal minuscule, avec la clé partagée prise
 * telle quelle (octets UTF-8 de la chaîne), de `horodatage \n MÉTHODE \n chemin?requête \n SHA-256 hex du corps`.
 * Web Crypto seulement : le même code tourne dans un Worker de Cloudflare et dans Node.
 */

const enc = new TextEncoder();

/** Écart toléré entre l'horodatage de l'appel et l'heure de l'application. */
export const ECART_MAX_MS = 5 * 60 * 1000;

function hex(octets: ArrayBuffer): string {
  return [...new Uint8Array(octets)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Octets d'une chaîne hexadécimale minuscule, ou `null` si elle n'en est pas une. */
function deHex(texte: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(texte)) return null;
  const out = new Uint8Array(texte.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(texte.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export async function sha256Hex(corps: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(corps)));
}

export async function chaineASigner(horodatage: string, methode: string, chemin: string, corps: string): Promise<string> {
  return `${horodatage}\n${methode.toUpperCase()}\n${chemin}\n${await sha256Hex(corps)}`;
}

function cleHmac(cle: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(cle), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signer(cle: string, horodatage: string, methode: string, chemin: string, corps: string): Promise<string> {
  const chaine = await chaineASigner(horodatage, methode, chemin, corps);
  return hex(await crypto.subtle.sign("HMAC", await cleHmac(cle), enc.encode(chaine)));
}

/** Horodatage bien formé et à moins de 5 minutes de l'heure de l'application. */
export function horodatageValide(horodatage: string | null, maintenant: number): boolean {
  return !!horodatage && /^\d{1,16}$/.test(horodatage) && Math.abs(maintenant - Number(horodatage)) <= ECART_MAX_MS;
}

export type Verdict = "ok" | "signature" | "horodatage";

/** Contrôle d'un appel reçu ; la comparaison est faite par Web Crypto, en temps constant. */
export async function verifierSignature(e: {
  cle: string; horodatage: string | null; signature: string | null; methode: string; chemin: string; corps: string; maintenant: number;
}): Promise<Verdict> {
  if (!e.horodatage || !horodatageValide(e.horodatage, e.maintenant)) return "horodatage";
  const recue = e.signature ? deHex(e.signature) : null;
  if (!recue || recue.length !== 32) return "signature";
  const chaine = await chaineASigner(e.horodatage, e.methode, e.chemin, e.corps);
  return (await crypto.subtle.verify("HMAC", await cleHmac(e.cle), recue, enc.encode(chaine))) ? "ok" : "signature";
}
