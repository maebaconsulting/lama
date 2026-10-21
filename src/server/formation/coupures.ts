/**
 * Coupures imposées par le serveur dans la base de formation (distribution
 * D-17) : rien ne sort de la base d'entraînement. La file d'envoi garde ses
 * messages (le travailleur n'est pas lancé, `boot.ts`), aucun fournisseur
 * WhatsApp ni SMS n'est construit (`envoi.ts`, `passerelle.ts`), et les gestes
 * ci-dessous, qui parlent au monde extérieur sans passer par la file, sont
 * refusés avant leur route (409, code `formation`).
 */
import type { Context, Next } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { msg } from "../messages.ts";
import { estFormation } from "./mode.ts";

// Comparées au chemin décodé que le routeur de Hono utilise (`c.req.path`). Le « / » final est toléré par prudence : le routeur,
// lui, est strict (`/api/backups/run/` donne 404).
// `:id` accepte tout segment, d'où `[^/]+`.
const COUPEES: { method: string; path: RegExp }[] = [
  // Sauvegarde sur le disque USB et Google Drive, restauration : la formation n'en fait aucune.
  { method: "POST", path: /^\/api\/backups\/(run|restore)\/?$/ },
  // Horloge du système, partagée avec la vraie base : jamais réglée depuis la formation.
  { method: "POST", path: /^\/api\/heure\/?$/ },
  // WhatsApp et SMS : ni session liée, ni message d'essai.
  { method: "POST", path: /^\/api\/whatsapp\/session\/(start|logout)\/?$/ },
  { method: "GET", path: /^\/api\/whatsapp\/qr\/?$/ },
  { method: "POST", path: /^\/api\/sms\/test\/?$/ },
  // WhatsApp Business : test de connexion, message d'essai et vérification des modèles parlent à Meta.
  { method: "POST", path: /^\/api\/whatsapp\/meta\/(tester|essai|modeles\/verifier)\/?$/ },
  // « Ouvrir WhatsApp » ou « Ouvrir les SMS » : la tablette enverrait elle-même le message à un numéro peut-être réel.
  { method: "POST", path: /^\/api\/whatsapp\/manual\/[^/]+\/open\/?$/ },
  // Mise à jour par le réseau (M-16) : la formation suit la version du service principal, sans rubrique.
  { method: "POST", path: /^\/api\/mise-a-jour(\/verifier)?\/?$/ },
  { method: "PUT", path: /^\/api\/mise-a-jour\/mode\/?$/ },
];

/** Vrai si la route est coupée en formation. */
export function coupeeEnFormation(method: string, path: string): boolean {
  return COUPEES.some((r) => r.method === method && r.path.test(path));
}

/** Refus 409 de formation (même code et même texte que la coupure), ou `null` hors formation. */
export function refusFormation(c: Context): Response | null {
  return estFormation() ? c.json({ error: msg(c, "formation.coupe"), code: "formation" }, 409) : null;
}

/** Refus des routes coupées, posé après l'authentification (un appareil sans session reçoit toujours 401). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installerCoupuresFormation(app: OpenAPIHono<any>): void {
  app.use("/api/*", async (c: Context, next: Next) => {
    return (coupeeEnFormation(c.req.method, c.req.path) ? refusFormation(c) : null) ?? next();
  });
}
