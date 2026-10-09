/** Données saisies en deux langues (spec § 5.2) : prestations, produits, fonctions de l'équipe. */
import type { Lang } from "../i18n/translate.ts";

/** Seule fonction qui choisit le texte : l'anglais s'il est rempli et si l'écran est en anglais, sinon le français. */
export function pickText(lang: Lang, fr: string | null | undefined, en: string | null | undefined): string {
  const english = (en ?? "").trim();
  return lang === "en" && english ? english : (fr ?? "");
}

/** Minuscules, sans accents : « Épilation » et « epilation » se valent. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Vrai si la recherche se trouve dans l'un des textes (nom français, nom anglais) ; une recherche vide correspond à tout. */
export function matchesSearch(query: string, ...texts: (string | null | undefined)[]): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  return texts.some((text) => fold(text ?? "").includes(q));
}
