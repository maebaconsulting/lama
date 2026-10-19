/**
 * Coffre des clés partagées des salons : AES-GCM 256, avec une clé dérivée (SHA-256) de la clé générale de
 * l'exploitant (`RELAIS_CLE_MAITRE`). Le scellé est lié à l'identifiant du salon (données authentifiées) : copié
 * dans la ligne d'un autre salon, il ne se déchiffre pas. Scellé : `v1.<iv base 64>.<chiffré base 64>`. Web Crypto seulement.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function versBase64(octets: Uint8Array): string {
  let s = "";
  for (const o of octets) s += String.fromCharCode(o);
  return btoa(s);
}

function deBase64(texte: string): Uint8Array<ArrayBuffer> {
  const s = atob(texte);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function cleAes(maitre: string, usage: KeyUsage): Promise<CryptoKey> {
  const derivee = await crypto.subtle.digest("SHA-256", enc.encode(`lama-relais/coffre\n${maitre}`));
  return crypto.subtle.importKey("raw", derivee, "AES-GCM", false, [usage]);
}

export async function chiffrer(maitre: string, id: string, clair: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(id) }, await cleAes(maitre, "encrypt"), enc.encode(clair));
  return `v1.${versBase64(iv)}.${versBase64(new Uint8Array(chiffre))}`;
}

/** Texte clair, ou `null` si le scellé est mal formé, abîmé ou chiffré avec une autre clé générale. */
export async function dechiffrer(maitre: string, id: string, scelle: string): Promise<string | null> {
  const [version, iv, chiffre] = scelle.split(".");
  if (version !== "v1" || !iv || !chiffre) return null;
  try {
    const vecteur = deBase64(iv);
    if (vecteur.length !== 12) return null;
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: vecteur, additionalData: enc.encode(id) }, await cleAes(maitre, "decrypt"), deBase64(chiffre)));
  } catch {
    return null;
  }
}

/** Clé partagée d'un salon : 32 octets aléatoires, en hexadécimal minuscule. */
export function nouvelleCle(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/** Égalité de deux chaînes sans s'arrêter au premier écart (mot de passe, session). */
export function egal(a: string, b: string): boolean {
  let ecart = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) ecart |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return ecart === 0;
}
