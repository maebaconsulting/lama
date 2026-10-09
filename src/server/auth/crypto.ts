import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { MessageKey } from "../messages.ts";
import { pinFormatOk, pinTooSimple } from "../../shared/pin.ts";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const HASH_BYTES = 32;

// Empreinte factice pour un compte inconnu : sel et empreinte aléatoires, tirés
// une fois au chargement (aucun calcul scrypt ici). La vérification calcule
// quand même un scrypt complet, pour une durée identique à celle d'un compte connu.
const DUMMY_HASH = `scrypt$${randomBytes(16).toString("base64")}$${randomBytes(HASH_BYTES).toString("base64")}`;

// Deux calculs scrypt au plus en même temps (32 Mo chacun) : les autres
// attendent leur tour, et le reste du pool libuv (fichiers, zlib) reste libre.
const MAX_CONCURRENT = 2;
let active = 0;
const waiting: (() => void)[] = [];

/** Calcul scrypt asynchrone (pool libuv), jamais sur la boucle d'événements. */
async function derive(secret: string, salt: Buffer, length: number): Promise<Buffer> {
  // Le créneau libéré passe directement au suivant en attente (sans décompte
  // intermédiaire), pour ne jamais dépasser la limite.
  if (active < MAX_CONCURRENT) active++;
  else await new Promise<void>((ok) => waiting.push(ok));
  try {
    return await new Promise<Buffer>((ok, fail) => {
      scrypt(secret.normalize("NFKC"), salt, length, SCRYPT, (error, key) => (error ? fail(error) : ok(key)));
    });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

/** Empreinte scrypt salée : `scrypt$<sel base64>$<empreinte base64>`. */
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(secret, salt, HASH_BYTES);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Vérification à temps constant ; calcule une empreinte même sans compte, pour ne rien révéler par la durée. */
export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  const [algo, saltB64, hashB64] = (stored ?? DUMMY_HASH).split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await derive(secret, Buffer.from(saltB64, "base64"), expected.length);
  return stored != null && expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function passwordProblem(password: string): MessageKey | null {
  return [...password].length < 10 ? "compte.mot_de_passe_court" : null;
}

export function pinProblem(pin: string): MessageKey | null {
  if (!pinFormatOk(pin)) return "compte.pin_format";
  return pinTooSimple(pin) ? "compte.pin_simple" : null;
}

/** Chiffre un secret (AES-256-GCM) : `v1.<iv>.<étiquette>.<chiffré>` en base64url. */
export function sealSecret(plain: string, key: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function openSecret(sealed: string, key: Uint8Array): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Secret illisible.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
