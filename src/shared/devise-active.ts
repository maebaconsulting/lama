/**
 * Devise de l'installation (spec du 15/10/2026, § 2) : une seule, posée au
 * démarrage du serveur (réglages) et à chaque chargement de l'état côté
 * écran (`/api/auth/state`). Les tests la changent avec `definirDevise`.
 */
import { DEVISE_DEFAUT, DEVISES, estCodeDevise, type CodeDevise, type Devise, type PositionSymbole } from "./devises.ts";

export interface ConfigDevise {
  code: CodeDevise;
  /** `null` : position par défaut de la devise. */
  position: PositionSymbole | null;
  symboleEcran: boolean;
}

export interface DeviseActive extends Devise {
  symboleEcran: boolean;
}

let config: ConfigDevise = { code: DEVISE_DEFAUT, position: null, symboleEcran: true };
let active: DeviseActive = { ...DEVISES[DEVISE_DEFAUT], symboleEcran: true };

export function definirDevise(c: ConfigDevise): void {
  const code = estCodeDevise(c.code) ? c.code : DEVISE_DEFAUT;
  const position = c.position === "avant" || c.position === "apres" ? c.position : null;
  config = { code, position, symboleEcran: c.symboleEcran !== false };
  const base = DEVISES[code];
  active = { ...base, position: position ?? base.position, symboleEcran: config.symboleEcran };
}

export function deviseActive(): DeviseActive {
  return active;
}

export function configDevise(): ConfigDevise {
  return { ...config };
}
