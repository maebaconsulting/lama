import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Account, Device, SessionInfo } from "./lib/auth-types";

export interface AuthContextValue {
  account: Account;
  device: Device | null;
  session: SessionInfo | null;
  /** Interrupteur général du mini CRM (`crm.active`) : faux, les écrans reviennent à ce qu'ils étaient avant le chantier. */
  crm: boolean;
  /** Relit l'état de session (après la déclaration d'un poste, par exemple). */
  reload: () => Promise<void>;
  /** Ferme la session : retour à la connexion, ou à la liste de l'équipe sur un poste. */
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>(null!);

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/** Mini CRM activé ? Vrai hors de la porte (essais, écrans montés sans session). */
export function useCrm(): boolean {
  return useContext(AuthContext)?.crm ?? true;
}
