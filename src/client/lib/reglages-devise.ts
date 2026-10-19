/**
 * Rubrique Devise (spec du 15/10/2026, § 5), sans dépendance au navigateur :
 * état lu dans `/api/settings`, aperçu d'une configuration sans changer la
 * devise active de l'écran.
 */
import type { Lang } from "../i18n/translate.ts";
import type { Setting } from "./api-types.ts";
import { configDevise, definirDevise, type ConfigDevise } from "../../shared/devise-active.ts";
import { DEVISE_DEFAUT, DEVISES, estCodeDevise, type CodeDevise, type PositionSymbole } from "../../shared/devises.ts";
import { formatMontantDocument, formatMontantEcran } from "../../shared/montants.ts";

export function deviseEtat(settings: Setting[]) {
  const get = (key: string) => settings.find((s) => s.key === key);
  const devise = get("institut.devise");
  const code: CodeDevise = estCodeDevise(devise?.value) ? devise.value : DEVISE_DEFAUT;
  const pos = get("affichage.symbole_position")?.value;
  const position: PositionSymbole | null = pos === "avant" || pos === "apres" ? pos : null;
  const symboleEcran = get("affichage.symbole_ecran")?.value !== false;
  const frozen = devise?.frozen ?? null;
  return { code, position, symboleEcran, modifiable: (devise?.editable ?? false) && frozen === null, fige: frozen?.numero ?? null };
}

/** Aperçu de 15 000 (15 000,50 avec centimes) dans la configuration `c`, la devise active étant rétablie ensuite. */
export function apercuDevise(c: ConfigDevise, lang: Lang): { ecran: string; document: string } {
  const avant = configDevise();
  definirDevise(c);
  try {
    const exemple = DEVISES[c.code].decimales === 0 ? 15000 : 1500050;
    return { ecran: formatMontantEcran(exemple, lang), document: formatMontantDocument(exemple, lang) };
  } finally {
    definirDevise(avant);
  }
}

/**
 * Avertissement du changement de devise (spec § 5) : un prix de 15 000 dans la
 * devise `actuelle` et ce qu'il devient dans la devise `cible` (même nombre,
 * unités entières) : « 15 000 F » → « 15 000,00 € ». Symboles toujours montrés,
 * même masqués à l'écran ; la devise active est rétablie ensuite.
 */
export function prixConserve(actuelle: ConfigDevise, cible: ConfigDevise, lang: Lang): { depart: string; exemple: string } {
  const avant = configDevise();
  const prix = (c: ConfigDevise) => {
    definirDevise({ ...c, symboleEcran: true });
    return formatMontantEcran(15000 * 10 ** DEVISES[c.code].decimales, lang);
  };
  try {
    return { depart: prix(actuelle), exemple: prix(cible) };
  } finally {
    definirDevise(avant);
  }
}
