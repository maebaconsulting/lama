/**
 * Prestations regroupées par catégorie (revue impeccable G4 ; même motif prévu
 * pour la liste des prestations, sous-projet 4 § 6). Module pur, testé sous Node.
 */
import type { Lang } from "../i18n/translate.ts";
import { pickText } from "./bilingual.ts";

export interface CategoryGroup<T> {
  /** Nom de la catégorie dans la langue de l'écran ; vide pour les prestations sans catégorie. */
  category: string;
  services: T[];
}

/**
 * Prestations actives par catégorie : groupes dans l'ordre de leur première
 * apparition, prestations dans l'ordre reçu ; les prestations sans catégorie
 * forment un dernier groupe au nom vide. `withInactive` garde aussi les
 * inactives, à leur place (liste des prestations, vague 4 : pour les réactiver).
 */
export function byCategory<T extends { category: string; category_en?: string | null; active: number }>(
  services: T[],
  lang: Lang,
  { withInactive = false }: { withInactive?: boolean } = {},
): CategoryGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const service of services) {
    if (!service.active && !withInactive) continue;
    const name = pickText(lang, service.category, service.category_en).trim();
    groups.set(name, [...(groups.get(name) ?? []), service]);
  }
  const named = [...groups].filter(([name]) => name !== "");
  const unnamed = groups.get("");
  return [...named, ...(unnamed ? [["", unnamed] as const] : [])].map(([category, list]) => ({ category, services: list }));
}
