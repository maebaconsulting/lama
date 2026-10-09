import { useEffect, useState } from "preact/hooks";
import { BREAKPOINT_PX, PANEL_COLUMN_PX } from "../lib/cadre";

const QUERY = `(min-width: ${BREAKPOINT_PX}px)`;

const matches = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;

/**
 * Vrai à partir de 768 px (rail, panneau à côté de la page, agenda en
 * colonnes), suivi en direct quand la fenêtre ou l'appareil tourne.
 */
export function useWide(): boolean {
  const [wide, setWide] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const follow = () => setWide(media.matches);
    follow();
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  return wide;
}

const LARGE_QUERY = `(min-width: ${PANEL_COLUMN_PX}px)`;

/** Vrai à partir de 1280 px (panneau de détail en colonne), suivi en direct. */
export function useLarge(): boolean {
  const [large, setLarge] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(LARGE_QUERY).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(LARGE_QUERY);
    const follow = () => setLarge(media.matches);
    follow();
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);
  return large;
}
