/**
 * Ce que l'appareil retient (spec § 3.1 et sous-projet 4 § 3.2, § 3.3) : la
 * langue et le thème du dernier compte connecté, pour les écrans d'entrée et
 * l'ouverture sans flash, le rail déployé ou replié, l'heure du dernier
 * rechargement d'un écran périmé (PWA, P-05) et le bandeau d'installation
 * fermé (P-06). Seul accès du client au stockage du navigateur (test
 * `fetch-guard`), jamais pour un secret.
 */
import { normalizeTheme, type ThemePref } from "../lib/theme.ts";
import { normalizeLang, type Lang } from "./translate.ts";

export type DeviceStore = Pick<Storage, "getItem" | "setItem">;
export const DEVICE_LANG_KEY = "lama.langue";
export const DEVICE_THEME_KEY = "lama.theme";
export const DEVICE_RAIL_KEY = "lama.rail";
export const DEVICE_RELOAD_KEY = "lama.rechargement";
export const DEVICE_INSTALL_KEY = "lama.installation";

function browserStore(): DeviceStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Langue de l'appareil ; le français si rien n'est retenu ou si le stockage est indisponible. */
export function readDeviceLang(store: DeviceStore | null = browserStore()): Lang {
  try {
    return normalizeLang(store?.getItem(DEVICE_LANG_KEY));
  } catch {
    return "fr";
  }
}

/** Retient la langue ; sans stockage (navigation privée, stockage bloqué), elle vaut pour cet onglet seulement. */
export function writeDeviceLang(lang: Lang, store: DeviceStore | null = browserStore()): void {
  try {
    store?.setItem(DEVICE_LANG_KEY, lang);
  } catch {
    // Stockage refusé : rien à faire, l'écran garde la langue en mémoire.
  }
}

/** Thème retenu par l'appareil ; « comme l'appareil » si rien n'est retenu ou si le stockage est indisponible. */
export function readDeviceTheme(store: DeviceStore | null = browserStore()): ThemePref {
  try {
    return normalizeTheme(store?.getItem(DEVICE_THEME_KEY));
  } catch {
    return "system";
  }
}

/** Retient le choix de thème (et non le thème résolu) : « comme l'appareil » continue de suivre l'appareil. */
export function writeDeviceTheme(pref: ThemePref, store: DeviceStore | null = browserStore()): void {
  try {
    store?.setItem(DEVICE_THEME_KEY, pref);
  } catch {
    // Stockage refusé : le thème vaut pour cet onglet seulement.
  }
}

/** Rail déployé (libellés visibles) sur cet appareil ; replié par défaut. */
export function readRailExpanded(store: DeviceStore | null = browserStore()): boolean {
  try {
    return store?.getItem(DEVICE_RAIL_KEY) === "ouvert";
  } catch {
    return false;
  }
}

export function writeRailExpanded(expanded: boolean, store: DeviceStore | null = browserStore()): void {
  try {
    store?.setItem(DEVICE_RAIL_KEY, expanded ? "ouvert" : "replie");
  } catch {
    // Stockage refusé : le rail garde son état pour cet onglet seulement.
  }
}

/** Heure (ms) du dernier rechargement d'un écran que le serveur n'acceptait plus ; `null` si aucun ou stockage indisponible. */
export function readReloadMark(store: DeviceStore | null = browserStore()): number | null {
  try {
    const valeur = store?.getItem(DEVICE_RELOAD_KEY);
    return valeur && Number.isFinite(Number(valeur)) ? Number(valeur) : null;
  } catch {
    return null;
  }
}

/** Retient l'heure du rechargement ; faux si le stockage est indisponible (l'écran ne recharge alors pas : aucune boucle possible). */
export function writeReloadMark(at: number, store: DeviceStore | null = browserStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(DEVICE_RELOAD_KEY, `${at}`);
    return true;
  } catch {
    return false;
  }
}

/** Bandeau « Installez lama » déjà fermé sur cet appareil ; stockage indisponible : faux (il reviendra, sans erreur). */
export function readInstallBannerClosed(store: DeviceStore | null = browserStore()): boolean {
  try {
    return store?.getItem(DEVICE_INSTALL_KEY) === "ferme";
  } catch {
    return false;
  }
}

export function writeInstallBannerClosed(store: DeviceStore | null = browserStore()): void {
  try {
    store?.setItem(DEVICE_INSTALL_KEY, "ferme");
  } catch {
    // Stockage refusé : le bandeau reste fermé pour cet onglet seulement.
  }
}
