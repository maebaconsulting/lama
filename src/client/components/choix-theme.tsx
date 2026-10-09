import { Check, Monitor, Moon, Sun } from "lucide-preact";
import { api } from "../api";
import { useI18n } from "@/i18n/provider";
import type { Key } from "@/i18n/translate";
import { attemptThemeChange } from "@/lib/theme-change";
import { THEME_PREFS, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useTheme } from "../theme-provider";

/** Libellé de chaque choix : `t(THEME_KEYS[pref])`. */
export const THEME_KEYS: Record<ThemePref, Key> = { light: "theme.clair", dark: "theme.sombre", system: "theme.systeme" };
export const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor };

/**
 * Change le thème de son propre compte (sous-projet 4 § 3.2) : appliqué
 * aussitôt à tout l'écran, puis enregistré ; si l'enregistrement échoue,
 * l'ancien thème revient et `onError` reçoit le message. Le retour en
 * arrière est la fonction pure `attemptThemeChange`, testée en exécution
 * dans `theme-provider.test.ts` (décision D4 du contrôleur, hors fiche).
 */
export function useChoixTheme(onError: (message: string) => void, onSaved?: () => void): (next: ThemePref) => void {
  const { pref, setPref } = useTheme();
  const { t } = useI18n();
  return (next: ThemePref) => {
    attemptThemeChange(
      pref,
      next,
      (chosen) => api("PUT", "/api/auth/me/theme", { theme: chosen }),
      setPref,
      () => onError(t("theme.echec")),
      onSaved,
    );
  };
}

/**
 * Trois gros boutons, Clair, Sombre, Comme l'appareil (Mon compte, « Plus »
 * sur téléphone). `surface="couverture"` pour un fond cuir ; `grand` pour
 * les sélecteurs de 64 px de Mon compte (sous-projet 4 § 7.1).
 */
export function ChoixTheme({ onError, onSaved, surface = "page", grand = false }: {
  onError: (message: string) => void;
  onSaved?: () => void;
  surface?: "page" | "couverture";
  grand?: boolean;
}) {
  const { pref } = useTheme();
  const { t } = useI18n();
  const choose = useChoixTheme(onError, onSaved);
  return (
    <div role="group" aria-label={t("theme.choix")} className="grid grid-cols-3 gap-2">
      {THEME_PREFS.map((code) => {
        const Icon = THEME_ICONS[code];
        const active = pref === code;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={active}
            onClick={() => choose(code)}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 rounded-sm border px-2 py-2 text-center text-sm leading-tight transition-colors duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 relative",
              grand && "min-h-16 text-base",
              surface === "page"
                ? cn("focus-visible:outline-ring", active ? "border-foreground bg-muted text-foreground" : "border-input text-muted-foreground hover:bg-muted hover:text-foreground")
                : cn("focus-visible:outline-sidebar-ring", active ? "border-sidebar-foreground bg-sidebar-accent text-sidebar-foreground" : "border-sidebar-border text-sidebar-foreground/70 hover:text-sidebar-foreground"),
            )}
          >
            {/* Coche du choix actif (retouche 9), seulement sur les gros sélecteurs de 64 px ; aria-pressed porte déjà l'état. */}
            {grand && active && <Check aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 text-foreground" />}
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span>{t(THEME_KEYS[code])}</span>
          </button>
        );
      })}
    </div>
  );
}
