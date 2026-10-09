import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { useRefresh } from "./use-refresh";

/**
 * Solde de fidélité de la cliente du ticket (mini CRM § 2) : relu quand la
 * cliente change, après chaque facture ou fiche modifiée (signal temps
 * réel) ; `null` sans cliente, pendant le chargement ou si la lecture échoue.
 * Une réponse arrivée pour une cliente qui n'est plus celle du ticket est ignorée.
 */
export function useSoldeFidelite(clientId: number | null): number | null {
  const [state, setState] = useState<{ id: number; balance: number } | null>(null);
  const wanted = useRef(clientId);
  wanted.current = clientId;
  const load = async () => {
    const id = wanted.current;
    if (id === null) return;
    try {
      const { balance } = await api<{ balance: number }>("GET", `/api/clients/${id}/loyalty`);
      if (wanted.current === id) setState({ id, balance });
    } catch {
      if (wanted.current === id) setState(null);
    }
  };
  useEffect(() => { void load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  useRefresh(["invoices", "clients"], () => { void load(); });
  return state !== null && state.id === clientId ? state.balance : null;
}
