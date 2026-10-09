import { useCallback, useEffect, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { useI18n } from "../i18n/provider";
import { normalizeLang } from "../i18n/translate";
import { normalizeTheme } from "../lib/theme";
import { useTheme } from "../theme-provider";
import type { AuthState } from "../lib/auth-types";
import { refusEcranPerime, screenFor, type Screen } from "../lib/gate";
import { onSessionSignal } from "../lib/session-bus";
import { useRefresh } from "./use-refresh";

const MAINTENANCE_POLL_MS = 3000;

export interface AuthGate {
  screen: Screen;
  state: AuthState | null;
  /** Message du serveur quand l'écran est refusé comme périmé (`ecran_perime`), sinon null. */
  refus: string | null;
  reload: () => Promise<void>;
  setWantsPassword: (value: boolean) => void;
  logout: () => Promise<void>;
}

/**
 * Tient l'état d'authentification à jour : au chargement, à chaque refus qui
 * change d'écran (session perdue, poste verrouillé), et pendant une maintenance
 * (le serveur est interrogé jusqu'à son retour, puis la page est rechargée).
 */
export function useAuthGate(): AuthGate {
  const { setLang } = useI18n();
  const { setPref } = useTheme();
  const [state, setState] = useState<AuthState | null>(null);
  const [maintenance, setMaintenance] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [refus, setRefus] = useState<string | null>(null);
  const [wantsPassword, setWantsPassword] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await api<AuthState>("GET", "/api/auth/state");
      setState(next);
      setUnreachable(false);
      setRefus(null);
      setMaintenance(false);
      if (next.account) setWantsPassword(false);
      // La langue suit la personne ; l'appareil retient celle du dernier compte connecté (spec § 3.1).
      if (next.account) setLang(normalizeLang(next.account.language));
      // Le thème aussi (sous-projet 4 § 3.2) ; l'appareil retient le dernier appliqué.
      if (next.account) setPref(normalizeTheme(next.account.theme));
    } catch (error) {
      // En maintenance, le signal a déjà basculé l'écran.
      if (error instanceof ApiError && error.code === "maintenance") return;
      // Écran périmé : le serveur répond, la porte d'entrée affiche son message (le rechargement est fait par `api`).
      setRefus(refusEcranPerime(error));
      setUnreachable(true);
    }
  }, [setLang, setPref]);

  useEffect(() => { void reload(); }, [reload]);

  // Réglage changé (signal temps réel « settings ») : l'état est relu, pour que l'interrupteur
  // du mini CRM (`crm`) s'applique tout de suite à l'écran de chaque rôle.
  useRefresh(["settings"], reload);

  useEffect(() => onSessionSignal((signal) => {
    if (signal === "maintenance") setMaintenance(true);
    else void reload();
  }), [reload]);

  useEffect(() => {
    if (!maintenance) return;
    const timer = setInterval(() => {
      // La base a pu être restaurée : on repart d'une page neuve.
      api("GET", "/api/auth/state").then(() => window.location.reload(), () => undefined);
    }, MAINTENANCE_POLL_MS);
    return () => clearInterval(timer);
  }, [maintenance]);

  const logout = useCallback(async () => {
    await api("POST", "/api/auth/logout").catch(() => undefined);
    await reload();
  }, [reload]);

  return { screen: screenFor({ state, maintenance, unreachable, wantsPassword }), state, refus, reload, setWantsPassword, logout };
}
