import type { Config } from "./app.ts";

/** Variables d'environnement du relais, les mêmes pour Cloudflare (secrets et variables) et pour Node. */
export type VariablesRelais = {
  RELAIS_CLE_MAITRE?: string;
  RELAIS_ADMIN_MOT_DE_PASSE?: string;
  RELAIS_DEMANDES_PAR_HEURE?: string;
  TURNSTILE_CLE_SITE?: string;
  TURNSTILE_SECRET?: string;
};

/**
 * Configuration du relais depuis l'environnement ; refuse de démarrer (erreur en français) si la clé générale
 * (32 caractères au moins) ou le mot de passe de gestion (12 au moins) manque ou est trop court.
 */
export function configDepuis(env: VariablesRelais): Config {
  const cleMaitre = env.RELAIS_CLE_MAITRE?.trim() ?? "";
  const motDePasse = env.RELAIS_ADMIN_MOT_DE_PASSE ?? "";
  if (cleMaitre.length < 32) throw new Error("RELAIS_CLE_MAITRE manquante ou trop courte (32 caractères au moins)\u00a0: le relais ne démarre pas");
  if (motDePasse.length < 12) throw new Error("RELAIS_ADMIN_MOT_DE_PASSE manquant ou trop court (12 caractères au moins)\u00a0: le relais ne démarre pas");
  const limite = Number(env.RELAIS_DEMANDES_PAR_HEURE ?? "10");
  return {
    cleMaitre,
    motDePasseGestion: motDePasse,
    demandesParHeureParIp: Number.isInteger(limite) && limite > 0 ? limite : 10,
    // Turnstile est global au relais : les noms d'hôte du widget doivent couvrir les origines déclarées de tous les salons
    // (voir la documentation du relais).
    turnstile: env.TURNSTILE_CLE_SITE && env.TURNSTILE_SECRET ? { cleSite: env.TURNSTILE_CLE_SITE, secret: env.TURNSTILE_SECRET } : null,
  };
}
