import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { msToNextMinute, timeAt } from "../lib/cadre";
import { todayAt } from "../lib/calendrier";
import { shareRequests } from "../lib/partage";
import { onRefresh } from "../lib/refresh-bus";
import type { Appointment, BlockedSlot } from "../types";

/**
 * Jour et heure de l'institut (Douala), relus à chaque minute pleine (hh:mm:00,
 * pas 60 s après l'ouverture) : le jour change à minuit même si l'écran reste
 * ouvert (tablette du comptoir allumée la nuit).
 */
export function useDoualaClock(): { day: string; time: string } {
  const [clock, setClock] = useState(() => ({ day: todayAt(), time: timeAt() }));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => { setClock({ day: todayAt(), time: timeAt() }); timer = setTimeout(tick, msToNextMinute(Date.now())); };
    timer = setTimeout(tick, msToNextMinute(Date.now()));
    return () => clearTimeout(timer);
  }, []);
  return clock;
}

/**
 * Même jour demandé par le « + » et « Ma journée » du téléphone à quelques
 * millisecondes d'écart, ou par le chargement initial de `useAppState` et
 * l'accueil « Aujourd'hui » au démarrage (V1-73) : une seule requête.
 */
export const getCalendar = shareRequests((url: string) => api<{ appointments: Appointment[]; blocked_slots: BlockedSlot[] }>("GET", url), 5_000);

export interface CalendarRange {
  appointments: Appointment[];
  /** Vrai dès la première réponse reçue pour cette période. */
  loaded: boolean;
  /** Message du dernier échec (réseau coupé), effacé à la réponse suivante. */
  error: string | null;
  reload: () => void;
}

/**
 * Rendez-vous d'une période (`/api/calendar`, annulés déjà exclus par le
 * serveur), indépendants du jour affiché dans l'agenda. Rechargés quand la
 * période change, à chaque signal de l'agenda ou des rendez-vous, et par
 * `reload` ; seule la réponse de la dernière demande est appliquée. `null` :
 * rien n'est chargé (compte sans fiche de l'équipe, « + » masqué).
 */
export function useCalendarRange(range: { start: string; end: string } | null): CalendarRange {
  const [state, setState] = useState<Omit<CalendarRange, "reload">>({ appointments: [], loaded: false, error: null });
  const last = useRef(0);
  const start = range?.start ?? null;
  const end = range?.end ?? null;

  /** `reuseRecent` : ouverture de l'écran seulement ; un rechargement demandé repart toujours au serveur. */
  const load = useCallback((reuseRecent = false) => {
    if (start === null || end === null) return;
    const ticket = ++last.current;
    getCalendar(`/api/calendar?start=${start}&end=${end}`, reuseRecent).then(
      (res) => { if (ticket === last.current) setState({ appointments: res.appointments, loaded: true, error: null }); },
      // Échec passager : la liste reçue avant reste affichée, avec le message.
      (err: Error) => { if (ticket === last.current) setState((s) => ({ ...s, error: err.message })); },
    );
  }, [start, end]);

  useEffect(() => {
    setState({ appointments: [], loaded: false, error: null });
    if (start === null) return;
    load(true);
    const stop = onRefresh((keys) => { if (keys.includes("calendar") || keys.includes("appointments")) load(); });
    return () => { last.current++; stop(); };
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...state, reload: () => load() };
}
