import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { RefreshKey } from "../lib/realtime";
import { useRefresh } from "./use-refresh";
import { useI18n } from "@/i18n/provider";

/**
 * Charge une donnée au montage, et de nouveau quand un signal temps réel la
 * concerne. `reloadOnLang` : la réponse porte du texte traduit par le serveur
 * à la lecture (dernière erreur de la file d'envoi, message d'une sauvegarde),
 * redemandé à chaque bascule pour ne laisser aucun mot de l'autre langue.
 */
export function useLoad<T>(loader: () => Promise<T>, refreshKeys: RefreshKey[] = [], { reloadOnLang = false }: { reloadOnLang?: boolean } = {}) {
  const { lang } = useI18n();
  const loadedLang = useRef(lang);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(loader);
  latest.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await latest.current());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!reloadOnLang || loadedLang.current === lang) return;
    loadedLang.current = lang;
    void reload();
  }, [lang]);
  useRefresh(refreshKeys, () => { void reload(); });

  return { data, error, reload };
}
