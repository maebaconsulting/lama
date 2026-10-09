import { useEffect } from "preact/hooks";
import type { SessionInfo } from "../lib/auth-types";
import { ACTIVITY_EVENTS, CHECK_EVERY_MS, msUntilLock } from "../lib/idle";

/**
 * Sur un poste partagé, ferme la session après le délai réglé sans aucun geste.
 * Le serveur verrouille de toute façon à la requête suivante ; l'écran n'attend
 * pas qu'une requête parte pour cacher les données.
 */
export function useIdleLock(session: SessionInfo | null, lock: () => Promise<void>): void {
  const kind = session?.kind;
  const idleMs = session?.idle_ms ?? null;
  useEffect(() => {
    if (kind !== "poste" || !idleMs) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, touch, { passive: true, capture: true });
    const timer = setInterval(() => {
      if (msUntilLock(last, Date.now(), idleMs) === 0) void lock();
    }, CHECK_EVERY_MS);
    return () => {
      clearInterval(timer);
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, touch, { capture: true });
    };
  }, [kind, idleMs, lock]);
}
