import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import type { Lang } from "../i18n/translate";
import {
  canonicalUrl, PANEL_STATE, panelCloseMode, panelOpenMode, parsePanel, parseRoute, withoutPanel, withPanel,
  type PanelKind, type PanelRef, type RouteState,
} from "../lib/routes";

export type { RouteState };

export interface Router extends RouteState {
  /** Élément ouvert dans le panneau de détail, d'après l'adresse (sous-projet 4 § 3.3). */
  panel: PanelRef | null;
  navigate: (to: string, state?: unknown) => void;
  replace: (to: string) => void;
  openPanel: (kind: PanelKind, id: number | string) => void;
  closePanel: () => void;
}

const here = () => window.location.pathname + window.location.search + window.location.hash;
const read = (url: string) => ({ ...parseRoute(url), panel: parsePanel(url) });

/**
 * Adresse de l'écran dans la langue en cours (spec § 7). `navigate` accepte
 * toute forme connue (`/calendar`, `/agenda`, `/appointments/12`…) et pousse
 * sa forme canonique dans la langue (`/rendez-vous?rdv=12`) ; à la bascule, l'adresse est remplacée sans nouvelle
 * entrée d'historique ni remontage de l'écran (la saisie en cours reste).
 * Le panneau de détail suit le paramètre de l'adresse : un lien direct
 * l'ouvre, « Précédent » le ferme.
 */
export function useRouter(lang: Lang): Router {
  const [route, setRoute] = useState(() => read(canonicalUrl(here(), lang)));
  const langRef = useRef(lang);
  langRef.current = lang;

  const navigate = useCallback((to: string, state: unknown = null) => {
    const target = canonicalUrl(to, langRef.current);
    window.history.pushState(state, "", target);
    setRoute(read(target));
  }, []);

  const replace = useCallback((to: string) => {
    const target = canonicalUrl(to, langRef.current);
    window.history.replaceState(window.history.state, "", target);
    setRoute(read(target));
  }, []);

  /**
   * Ouvre un élément sans quitter l'écran ; un panneau déjà ouvert de la même
   * sorte change d'élément sans nouvelle entrée d'historique. Panneau fermé,
   * ou ouvert d'une autre sorte (un rendez-vous depuis la fiche d'une
   * cliente) : une entrée est posée, pour que « Précédent » retrouve
   * l'élément précédent au lieu de la simple liste.
   */
  const openPanel = useCallback((kind: PanelKind, id: number | string) => {
    const current = here();
    const target = withPanel(current, { kind, id: String(id) }, langRef.current);
    if (panelOpenMode(parsePanel(current), kind) === "replace") replace(target);
    else navigate(target, PANEL_STATE);
  }, [navigate, replace]);

  const closePanel = useCallback(() => {
    if (!parsePanel(here())) return;
    if (panelCloseMode(window.history.state) === "back") window.history.back();
    else replace(withoutPanel(here()));
  }, [replace]);

  /**
   * Remplace l'adresse affichée par sa forme canonique dans la langue en cours
   * (une ancienne fiche en page devient le panneau), si elle diffère.
   */
  const localizeCurrent = useCallback(() => {
    const current = here();
    const target = canonicalUrl(current, langRef.current);
    if (target === current) return;
    window.history.replaceState(window.history.state, "", target);
    setRoute(read(target));
  }, []);

  useEffect(() => {
    localizeCurrent();
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => {
      setRoute(read(here()));
      localizeCurrent();
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [localizeCurrent]);

  return { ...route, navigate, replace, openPanel, closePanel };
}
