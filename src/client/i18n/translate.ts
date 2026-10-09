/**
 * Traduction de l'interface, sans dépendance au navigateur (testée sous Node).
 * `fr.ts` est la référence ; `en.ts` est typé d'après elle.
 */
import { en } from "./en.ts";
import { fr, type Dictionary, type Key } from "./fr.ts";

export type Lang = "fr" | "en";
export type { Dictionary, Key };
export type Values = Record<string, string | number>;

export const LANGS: readonly Lang[] = ["fr", "en"];
export const DICTIONARIES: Record<Lang, Dictionary> = { fr, en };
/** Locales `Intl` : chiffres, dates et règles de pluriel. */
export const LOCALES: Record<Lang, string> = { fr: "fr-FR", en: "en-GB" };

/** Bases de pluriel : `base.one` et `base.other` existent toutes deux. */
export type PluralBase = {
  [K in Key]: K extends `${infer B}.other` ? (`${B}.one` extends Key ? B : never) : never;
}[Key];

/** `fr` ou `en` ; toute autre valeur (absente, inconnue, illisible) donne le français (spec § 10). */
export function normalizeLang(value: unknown): Lang {
  return value === "en" ? "en" : "fr";
}

/** Texte de `key` dans `lang`, `{nom}` remplacé par `values.nom` ; une variable absente reste visible. */
export function translate(lang: Lang, key: Key, values?: Values): string {
  const template = DICTIONARIES[lang][key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

const pluralRules = new Map<Lang, Intl.PluralRules>();

/** Accord selon `count` (règles `Intl.PluralRules` de la langue) ; `{count}` est fourni d'office. */
export function translatePlural(lang: Lang, base: PluralBase, count: number, values: Values = {}): string {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(LOCALES[lang]);
    pluralRules.set(lang, rules);
  }
  const key = `${base}.${rules.select(count) === "one" ? "one" : "other"}` as Key;
  return translate(lang, key, { count, ...values });
}
