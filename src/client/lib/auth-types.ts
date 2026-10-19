/** Types des réponses de `/api/auth/*`, tels que les renvoie le serveur (plan 2A). */
import type { Lang } from "../i18n/translate.ts";
import type { AffichageMarque } from "./marque.ts";
import type { ThemePref } from "./theme.ts";
import type { ConfigDevise } from "../../shared/devise-active.ts";

export type Role = "admin" | "manager" | "reception" | "practitioner";

export interface Account {
  id: number;
  display_name: string;
  login: string;
  role: Role;
  staff_id: number | null;
  active: number;
  has_pin: boolean;
  locked_until: number | null;
  language: Lang;
  theme: ThemePref;
}

export interface Device { id: number; name: string }

/** Compte public de la démonstration publique (démo publique DP-03), tel que le donne l'état public. */
export interface CompteDemo { login: string; role: Exclude<Role, "admin">; mot_de_passe: string; pin: string }

export interface SessionInfo { kind: "personnel" | "poste"; idle_ms: number | null }

export interface AuthState {
  installed: boolean;
  account: Account | null;
  device: Device | null;
  session: SessionInfo | null;
  /** Réglages publics de la marque : affichage à l'écran (`logo_nom` ou `logo`), nom de l'institut, versions des logos (`null` sans logo). */
  marque: { ecran: AffichageMarque; nom: string; logos: { clair: number | null; sombre: number | null } };
  /** Devise de l'institut (spec du 15/10/2026) : code, position du symbole, symbole à l'écran. */
  devise: ConfigDevise;
  /** Interrupteur général du mini CRM (`crm.active`), pour tous les rôles ; `null` avant la connexion. */
  crm?: { active: boolean } | null;
  /** Base de formation (distribution D-18) : bandeau sur chaque écran, rubrique Réglages > Formation. */
  formation?: boolean;
  /** Démonstration publique (démo publique DP-03) : ses trois comptes publics ; `null` ailleurs. */
  demo?: { comptes: CompteDemo[] } | null;
}
