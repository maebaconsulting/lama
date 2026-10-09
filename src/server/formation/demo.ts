/**
 * Comptes et données propres à la démonstration publique (démo publique DP-02,
 * DP-03, DP-05, DP-06). Module feuille : lu par les comptes (`auth/accounts.ts`,
 * blocage), l'état public, le semis et la remise à zéro, sans rien importer
 * d'eux.
 */
import type { Role } from "../auth/accounts.ts";
import type { MessageKey } from "../messages.ts";
import { estDemoPublique } from "./mode.ts";

/** Compte public de la démonstration : affiché à l'écran de connexion, mot de passe et code PIN figés. */
export interface CompteDemo {
  login: string;
  role: Exclude<Role, "admin">;
  motDePasse: string;
  pin: string;
  nom: MessageKey;
  staff_id: number | null;
}

/**
 * Les trois comptes publics (DP-02), mots de passe et codes PIN publics, montrés
 * à l'écran de connexion. La praticienne est reliée à la fiche n° 1 de la
 * démonstration (Solange Ekambi), recréée à chaque remise à zéro.
 */
export const COMPTES_DEMO: readonly CompteDemo[] = [
  { login: "gerante", role: "manager", motDePasse: "gerante-demo", pin: "2580", nom: "demo.compte.gerante", staff_id: null },
  { login: "reception", role: "reception", motDePasse: "reception-demo", pin: "1357", nom: "demo.compte.reception", staff_id: null },
  { login: "praticienne", role: "practitioner", motDePasse: "praticienne-demo", pin: "2468", nom: "demo.compte.praticienne", staff_id: 1 },
];

/** Administration cachée de la démonstration (DP-02) : mot de passe donné par `LAMA_DEMO_MDP_ADMIN`, jamais affiché. */
export const ADMIN_DEMO = { login: "administration", nom: "demo.compte.admin" } as const satisfies { login: string; nom: MessageKey };

/** Vrai si `login` est un compte public de la démonstration publique en cours : mot de passe, code PIN et fiche figés, jamais bloqué. */
export function compteDemoFige(login: string): boolean {
  return estDemoPublique() && COMPTES_DEMO.some((c) => c.login === login);
}

/** Numéro visiblement fictif d'une fiche de la démonstration publique (DP-06) : `+237 600 00 00 01` pour la fiche n° 1. */
export function numeroFictif(n: number): string {
  return `+237 600 00 00 ${String(n).padStart(2, "0")}`;
}
