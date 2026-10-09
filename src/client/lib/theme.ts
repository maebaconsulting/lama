/**
 * Thème d'affichage (spec § 3.1 et § 3.2), sans dépendance au navigateur
 * (testé sous Node). Le compte retient un choix (`ThemePref`) ; l'écran
 * applique un thème résolu (`Theme`), celui de l'appareil pour `system`.
 */
export type ThemePref = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_PREFS: readonly ThemePref[] = ["light", "dark", "system"];

/** `light`, `dark` ou `system` ; toute autre valeur (absente, inconnue, illisible) donne `system`. */
export function normalizeTheme(value: unknown): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

/** Thème appliqué : le choix du compte, ou celui de l'appareil pour `system`. */
export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === "system") return systemDark ? "dark" : "light";
  return pref;
}
