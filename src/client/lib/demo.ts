import type { CompteDemo } from "./auth-types.ts";

/** Vrai si `login` est un compte public de la démonstration publique : mot de passe, code PIN et fiche figés (démo publique DP-06). */
export function estCompteDemo(comptes: CompteDemo[] | null, login: string): boolean {
  return comptes?.some((c) => c.login === login) ?? false;
}
