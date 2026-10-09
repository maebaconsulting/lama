import { createContext } from "preact";
import { useContext } from "preact/hooks";

/**
 * Base de formation (distribution D-18) : lue dans l'état public
 * (`GET /api/auth/state`), posée par la porte d'entrée pour tous les écrans,
 * ceux d'entrée compris. Faux par défaut (vraie base, essais).
 */
export const FormationContext = createContext(false);

/** Vrai si l'écran sert la base de formation. */
export function useFormation(): boolean {
  return useContext(FormationContext);
}
