/**
 * Protections propres à la démonstration publique (démo publique DP-06), en
 * plus des coupures de la formation (`coupures.ts`) : sur internet, tout
 * visiteur se connecte avec les comptes affichés, et rien de ce qu'il fait ne
 * doit gêner le suivant. Mots de passe, codes PIN et fiches des trois comptes
 * publics ne se changent pas ; aucun fichier n'est reçu (logo de l'institut,
 * photos des produits). Refus 409, code `demo`, avant la route.
 */
import type { Context, Next } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { get } from "@clawnify/db";
import type { Account } from "../auth/accounts.ts";
import { msg } from "../messages.ts";
import { compteDemoFige } from "./demo.ts";
import { estDemoPublique } from "./mode.ts";

// Comparées au chemin décodé que le routeur de Hono utilise (`c.req.path`), comme les coupures de la formation.
const FICHIERS: { method: string; path: RegExp }[] = [
  // Logo de l'institut, clair et sombre : ni dépôt ni retrait.
  { method: "PUT", path: /^\/api\/institut\/logos\/[^/]+\/?$/ },
  { method: "DELETE", path: /^\/api\/institut\/logos\/[^/]+\/?$/ },
  // Photo d'un produit : ni dépôt ni retrait.
  { method: "PUT", path: /^\/api\/products\/[^/]+\/image\/?$/ },
  { method: "DELETE", path: /^\/api\/products\/[^/]+\/image\/?$/ },
  // Fichier d'un import : ni aperçu ni import (le modèle se télécharge).
  { method: "POST", path: /^\/api\/import\/[^/]+(\/apercu)?\/?$/ },
];

/** Vrai si la route envoie ou retire un fichier (refusée dans la démonstration publique). */
export function fichierRefuse(method: string, path: string): boolean {
  return FICHIERS.some((r) => r.method === method && r.path.test(path));
}

const SON_COMPTE = /^\/api\/auth\/me\/?$/;
const UN_COMPTE = /^\/api\/accounts\/([^/]+)\/?$/;

/** Vrai si la requête change un compte public : son propre mot de passe ou PIN, ou sa fiche par la gérante ou l'administration. */
async function compteFigeVise(c: Context): Promise<boolean> {
  if (c.req.method !== "PUT") return false;
  if (SON_COMPTE.test(c.req.path)) {
    const account = c.get("account") as Account | null;
    return account !== null && compteDemoFige(account.login);
  }
  const cible = UN_COMPTE.exec(c.req.path);
  if (!cible) return false;
  const ligne = await get<{ login: string }>("SELECT login FROM accounts WHERE id = ?", [Number(cible[1])]);
  return !!ligne && compteDemoFige(ligne.login);
}

/** Refus des gestes interdits au public, posé après l'authentification (un appareil sans session reçoit toujours 401). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installerProtectionsDemo(app: OpenAPIHono<any>): void {
  app.use("/api/*", async (c: Context, next: Next) => {
    if (!estDemoPublique()) return next();
    if (fichierRefuse(c.req.method, c.req.path)) return c.json({ error: msg(c, "demo.fichiers_coupes"), code: "demo" }, 409);
    if (await compteFigeVise(c)) return c.json({ error: msg(c, "demo.compte_fige"), code: "demo" }, 409);
    return next();
  });
}
