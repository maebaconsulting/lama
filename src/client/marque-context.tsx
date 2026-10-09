import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { AffichageMarque, MarqueEtat } from "./lib/marque";

/** Marque de l'institut (réglage d'affichage, nom, logos), posée par la porte d'entrée pour tous les écrans, connexion comprise. */
export const MarqueContext = createContext<MarqueEtat>({ ecran: "logo_nom", nom: "", clair: null, sombre: null });

export function useMarque(): MarqueEtat {
  return useContext(MarqueContext);
}

export function useAffichageMarque(): AffichageMarque {
  return useContext(MarqueContext).ecran;
}
