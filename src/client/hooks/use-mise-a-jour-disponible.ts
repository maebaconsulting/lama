import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useAuth } from "../auth-context";
import { pastilleMiseAJour, type EtatMiseAJour } from "../lib/mise-a-jour-reseau";
import { shareRequests } from "../lib/partage";
import { useRefresh } from "./use-refresh";

/** La pastille est montée deux fois (rail et barre du téléphone) : une seule lecture au démarrage et à chaque signal « settings ». */
const lire = shareRequests((url: string) => api<EtatMiseAJour>("GET", url), 5_000);

/** Vrai si la pastille « nouvelle version » s'affiche sur Réglages (spec du 21/10/2026, M-15) : administrateur seulement. */
export function useMiseAJourDisponible(): boolean {
  const { account } = useAuth();
  const admin = account.role === "admin";
  const [visible, setVisible] = useState(false);
  const dernier = useRef(0);
  const charger = useCallback((reuseRecent: boolean) => {
    const ticket = ++dernier.current;
    if (!admin) {
      setVisible(false);
      return;
    }
    // Échec passager, ou base de formation (404) : pas de pastille.
    lire("/api/mise-a-jour", reuseRecent).then((e) => { if (ticket === dernier.current) setVisible(pastilleMiseAJour(e)); }, () => { if (ticket === dernier.current) setVisible(false); });
  }, [admin]);
  useEffect(() => { charger(true); }, [charger]);
  useRefresh(["settings"], () => charger(false));
  return visible;
}
