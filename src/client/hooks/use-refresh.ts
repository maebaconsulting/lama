import { useEffect, useRef } from "preact/hooks";
import type { RefreshKey } from "../lib/realtime";
import { onRefresh } from "../lib/refresh-bus";

/** Appelle `fn` quand un signal temps réel touche l'une des clés données. */
export function useRefresh(keys: RefreshKey[], fn: () => void): void {
  const latest = useRef(fn);
  latest.current = fn;
  const wanted = keys.join(",");
  useEffect(() => {
    const set = new Set(wanted.split(","));
    return onRefresh((changed) => {
      if (changed.some((k) => set.has(k))) latest.current();
    });
  }, [wanted]);
}
