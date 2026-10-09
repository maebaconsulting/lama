import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useAuth } from "../auth-context";
import { shareRequests } from "../lib/partage";
import { canSeeManual } from "../lib/roles";
import type { ManualItem } from "../lib/whatsapp";
import { useRefresh } from "./use-refresh";

/**
 * La pastille est montée deux fois (rail et barre du téléphone) : une seule
 * lecture au démarrage et à chaque signal « outbox » (lib/partage.ts).
 */
export const getManual = shareRequests((url: string) => api<{ items: ManualItem[] }>("GET", url), 5_000);

/** Nombre de messages « À envoyer à la main » (pastille du menu) ; zéro pour les rôles qui ne voient pas la liste. */
export function useAEnvoyer(): number {
  const { account } = useAuth();
  const allowed = canSeeManual(account.role);
  const [count, setCount] = useState(0);
  const last = useRef(0);

  /** `reuseRecent` : montage seulement ; un signal du serveur repart toujours au serveur. */
  const load = useCallback((reuseRecent: boolean) => {
    const ticket = ++last.current;
    if (!allowed) { setCount(0); return; }
    // Échec passager : le dernier nombre reçu reste affiché.
    getManual("/api/whatsapp/manual", reuseRecent).then((res) => { if (ticket === last.current) setCount(res.items.length); }, () => {});
  }, [allowed]);

  useEffect(() => { load(true); }, [load]);
  useRefresh(["outbox"], () => load(false));
  return count;
}
