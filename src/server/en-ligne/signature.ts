import { createHash, createHmac } from "node:crypto";

/**
 * Signature des appels de lama à l'application de réservation (contrat v1, docs/reservation-en-ligne/contrat-v1.md) :
 * HMAC-SHA256 hexadécimal, clé partagée prise telle quelle, de `horodatage \n MÉTHODE \n chemin?requête \n SHA-256 du corps`.
 */
export function signerAppel(cle: string, horodatage: string, methode: string, chemin: string, corps: string): string {
  const empreinte = createHash("sha256").update(corps, "utf8").digest("hex");
  return createHmac("sha256", Buffer.from(cle, "utf8")).update(`${horodatage}\n${methode.toUpperCase()}\n${chemin}\n${empreinte}`, "utf8").digest("hex");
}
