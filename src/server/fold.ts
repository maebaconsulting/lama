/**
 * Texte sans accents ni majuscules, même règle que l'écran (`fold` de
 * `src/client/lib/bilingual.ts`) : « Aïcha » et « aicha » se retrouvent.
 * Module sans dépendance : utilisé par les routes (paramètre de recherche) et
 * par la base (fonction SQL `fold`, `storage.ts`).
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Motif `LIKE` d'une recherche : `%texte replié%`, à comparer à `fold(colonne)`. */
export function foldPattern(search: string): string {
  return `%${fold(search.trim())}%`;
}
