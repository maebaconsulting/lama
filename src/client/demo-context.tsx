import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { CompteDemo } from "./lib/auth-types";

/**
 * Démonstration publique (démo publique DP-03, DP-04, DP-06) : les comptes
 * publics lus dans l'état public (`GET /api/auth/state`, champ `demo`), posés
 * par la porte d'entrée pour tous les écrans. `null` hors démonstration
 * publique (vraie base, formation de l'institut, essais).
 */
export const DemoContext = createContext<CompteDemo[] | null>(null);

/** Comptes publics de la démonstration, ou `null` hors démonstration publique. */
export function useDemo(): CompteDemo[] | null {
  return useContext(DemoContext);
}
