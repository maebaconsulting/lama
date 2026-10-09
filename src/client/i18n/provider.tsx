import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useMemo, useState } from "preact/hooks";
import { setApiLang } from "../api";
import { readDeviceLang, writeDeviceLang } from "./device-lang";
import { translate, translatePlural, type Key, type Lang, type PluralBase, type Values } from "./translate";

export interface I18n {
  lang: Lang;
  /** Change la langue de tout l'écran, sans rechargement, et la retient sur l'appareil. */
  setLang: (lang: Lang) => void;
  t: (key: Key, values?: Values) => string;
  tn: (base: PluralBase, count: number, values?: Values) => string;
}

const I18nContext = createContext<I18n>(null!);

/** Attribut `lang` de la page (lecteurs d'écran, césure) et langue de l'API. */
function apply(lang: Lang): void {
  document.documentElement.lang = lang;
  setApiLang(lang);
}

/**
 * Langue de l'écran (spec § 3). Au départ, celle de l'appareil ; la porte
 * d'entrée la remplace par celle du compte à chaque chargement de l'état de
 * connexion. Un changement ne remonte aucun écran : la saisie en cours reste.
 */
export function I18nProvider({ children }: { children: ComponentChildren }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = readDeviceLang();
    apply(initial);
    return initial;
  });

  const setLang = useCallback((next: Lang) => {
    apply(next);
    writeDeviceLang(next);
    setLangState(next);
  }, []);

  const value = useMemo<I18n>(() => ({
    lang,
    setLang,
    t: (key, values) => translate(lang, key, values),
    tn: (base, count, values) => translatePlural(lang, base, count, values),
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  return useContext(I18nContext);
}
