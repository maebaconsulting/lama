/** Pavé de PIN du poste partagé : saisie au doigt, sans clavier système. */

export const PIN_MIN = 4;
export const PIN_MAX = 6;
export const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "effacer", "0", "valider"] as const;

/**
 * Cases du PIN affichées au-dessus du pavé : quatre au moins (la longueur
 * minimale), une de plus par chiffre au-delà ; `true` pour un chiffre tapé.
 */
export function pinSlots(length: number): boolean[] {
  return Array.from({ length: Math.min(PIN_MAX, Math.max(PIN_MIN, length)) }, (_, i) => i < length);
}

/** Nouvelle saisie après une touche ; `submit` vaut vrai quand on valide avec assez de chiffres. */
export function press(current: string, key: string): { value: string; submit: boolean } {
  if (key === "effacer") return { value: current.slice(0, -1), submit: false };
  if (key === "valider") return { value: current, submit: current.length >= PIN_MIN };
  if (/^\d$/.test(key) && current.length < PIN_MAX) return { value: current + key, submit: false };
  return { value: current, submit: false };
}
