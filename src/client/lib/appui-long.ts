/**
 * Garde de l'appui long du rail replié (sous-projet 4 § 3.3, décision D6) :
 * sur écran tactile, un appui long affiche le libellé du bouton ; le clic que
 * le navigateur envoie au relâchement ne doit alors pas ouvrir l'écran.
 * Sans dépendance au navigateur (testée sous Node) : les instants sont les
 * `timeStamp` des événements.
 */
export interface LongPressGate {
  /** Début d'un appui tactile, à l'instant `at` (ms). */
  press(at: number): void;
  /** Appui interrompu (défilement, pointeur non tactile) : aucun clic à ignorer. */
  cancel(): void;
  /**
   * Faut-il ignorer ce clic ? Oui s'il suit un appui tenu au moins le délai de
   * l'appui long ; jamais pour un clic au clavier. L'appui est oublié ensuite.
   */
  ignoreClick(at: number, fromKeyboard: boolean): boolean;
}

export function createLongPressGate(delayMs: number): LongPressGate {
  let pressedAt: number | null = null;
  return {
    press(at) { pressedAt = at; },
    cancel() { pressedAt = null; },
    ignoreClick(at, fromKeyboard) {
      const start = pressedAt;
      pressedAt = null;
      if (fromKeyboard || start === null) return false;
      return at - start >= delayMs;
    },
  };
}
