/**
 * Sous-projet 4 § 3.2 : changer son thème l'applique tout de suite ; si
 * l'enregistrement échoue, le dernier thème enregistré revient et `onError`
 * est appelé une fois. Fonction pure, sans DOM ni API, testée en exécution
 * dans `theme-provider.test.ts` (décision D4 du contrôleur, hors fiche, point 3
 * des contraintes de relecture) plutôt que par relecture de la source de
 * `components/choix-theme.tsx`.
 */
import type { ThemePref } from "./theme.ts";

type ThemeChange = (
  current: ThemePref,
  next: ThemePref,
  save: (next: ThemePref) => Promise<void>,
  apply: (pref: ThemePref) => void,
  onError: () => void,
  onSaved?: () => void,
) => void;

/**
 * Crée un changeur de thème qui tient compte des demandes qui se croisent
 * (vague 2, report de la vague 1) : deux choix rapides, le premier échoue
 * après la réussite du second, c'est le thème enregistré (le second) qui
 * reste. Seul l'échec de la dernière demande ramène en arrière, et il ramène
 * au dernier thème que le serveur a accepté, pas au thème affiché avant.
 */
export function createThemeChanger(): ThemeChange {
  let latest = 0;
  let pending = 0;
  let confirmed: ThemePref = "system";
  let confirmedAt = 0;
  return (current, next, save, apply, onError, onSaved) => {
    if (next === current) return;
    // Aucune demande en cours : le thème affiché est celui du compte.
    if (pending === 0) confirmed = current;
    const token = ++latest;
    pending++;
    apply(next);
    save(next).then(
      () => {
        pending--;
        if (token > confirmedAt) {
          confirmed = next;
          confirmedAt = token;
        }
        if (token === latest) onSaved?.();
      },
      () => {
        pending--;
        if (token !== latest) return;
        apply(confirmed);
        onError();
      },
    );
  };
}

/** Changeur partagé par toute l'application (un seul thème par compte). */
export const attemptThemeChange: ThemeChange = createThemeChanger();
