import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useEffect, useMemo, useState } from "preact/hooks";
import { readDeviceTheme, writeDeviceTheme } from "./i18n/device-lang";
import { resolveTheme, type Theme, type ThemePref } from "./lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Vrai si l'appareil est réglé en sombre. */
export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** Pose le thème résolu sur la page (`data-theme`, lu par styles.css) et le renvoie. */
export function applyTheme(pref: ThemePref): Theme {
  const theme = resolveTheme(pref, systemPrefersDark());
  document.documentElement.dataset.theme = theme;
  return theme;
}

export interface ThemeState {
  /** Choix du compte : clair, sombre ou comme l'appareil. */
  pref: ThemePref;
  /** Thème appliqué. */
  theme: Theme;
  /** Applique un choix à tout l'écran, sans rechargement, et le retient sur l'appareil. */
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeState>(null!);

/**
 * Thème de l'écran (sous-projet 4 § 3.2). Au départ, celui que l'appareil a
 * retenu (déjà posé par main.tsx avant le premier rendu) ; la porte d'entrée
 * le remplace par celui du compte à chaque chargement de l'état de
 * connexion. « Comme l'appareil » suit en direct les changements de
 * l'appareil. Limite connue (décision D3 du contrôleur, hors fiche) : entre
 * le premier rendu et ce remplacement, si le choix du compte diffère de
 * celui que l'appareil avait retenu, un bref éclair du mauvais thème reste
 * possible, car lire le stockage plus tôt sortirait de `device-lang.ts`.
 */
export function ThemeProvider({ children }: { children: ComponentChildren }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readDeviceTheme());
  const [theme, setTheme] = useState<Theme>(() => applyTheme(readDeviceTheme()));

  const setPref = useCallback((next: ThemePref) => {
    writeDeviceTheme(next);
    setPrefState(next);
    setTheme(applyTheme(next));
  }, []);

  useEffect(() => {
    if (pref !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(DARK_QUERY);
    const follow = () => setTheme(applyTheme("system"));
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [pref]);

  const value = useMemo<ThemeState>(() => ({ pref, theme, setPref }), [pref, theme, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
