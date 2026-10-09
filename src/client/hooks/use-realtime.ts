import { useEffect } from "preact/hooks";
import { api } from "../api";
import { createLiveConnection, type SourceLike } from "../lib/realtime";
import { emitRefresh } from "../lib/refresh-bus";
import { emitSessionSignal } from "../lib/session-bus";

/** Ouvre le flux `/api/events` tant que l'app est montée (session ouverte). */
export function useRealtime(): void {
  useEffect(() => {
    const live = createLiveConnection({
      open: () => new EventSource("/api/events") as unknown as SourceLike,
      onKeys: emitRefresh,
      check: () => api("GET", "/api/auth/me"),
      // Diffusé par le serveur avant sa coupure : cet écran n'a pas besoin
      // d'attendre un 503 sur sa prochaine requête pour afficher la maintenance.
      onMaintenance: () => emitSessionSignal("maintenance"),
    });
    return () => live.close();
  }, []);
}
