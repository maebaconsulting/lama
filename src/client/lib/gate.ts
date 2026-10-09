import type { AuthState } from "./auth-types.ts";

export type Screen = "chargement" | "injoignable" | "maintenance" | "installation" | "connexion" | "poste" | "app";

export interface GateInput {
  state: AuthState | null;
  maintenance: boolean;
  /** Le dernier appel à `/api/auth/state` n'a pas pu joindre le serveur. */
  unreachable: boolean;
  /** Sur un poste partagé, quelqu'un a choisi « Connexion par mot de passe ». */
  wantsPassword: boolean;
}

/**
 * Refus `ecran_perime` (409) de l'appel initial : le serveur répond, mais cet écran date d'une
 * version précédente. Rend le message du serveur (déjà traduit), ou null pour toute autre erreur.
 */
export function refusEcranPerime(error: unknown): string | null {
  const refus = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (refus && refus.status === 409 && refus.code === "ecran_perime" && typeof refus.message === "string") return refus.message;
  return null;
}

/**
 * Écran à afficher. Le serveur tranche (état et refus) ; ce choix ne fait que
 * suivre : maintenance, puis installation, session ouverte, poste, connexion.
 */
export function screenFor({ state, maintenance, unreachable, wantsPassword }: GateInput): Screen {
  if (maintenance) return "maintenance";
  if (!state) return unreachable ? "injoignable" : "chargement";
  if (!state.installed) return "installation";
  if (state.account) return "app";
  if (state.device && !wantsPassword) return "poste";
  return "connexion";
}
