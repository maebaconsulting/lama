/**
 * Démarrage de l'écran (V1-73) : le premier effet de `useAppState` charge
 * tout d'un coup ; les effets qui suivent la page, la recherche, le jour de
 * l'agenda ou le filtre ne doivent pas refaire la même requête à leur premier
 * passage. Module pur, testé sous Node.
 */

/** Listes chargées au démarrage et rechargées ensuite par leur propre effet. */
export type StartupKey = "appointments" | "calendar" | "clients" | "products";

/**
 * Garde du premier passage : rend `true` au premier appel pour une clé (l'effet
 * ne fait rien, le chargement initial s'en est chargé), `false` ensuite. Une
 * garde par montage de l'écran.
 */
export function createFirstPassSkip(): (key: StartupKey) => boolean {
  const seen = new Set<StartupKey>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}
