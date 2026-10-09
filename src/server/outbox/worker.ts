import { purgeAudit } from "../audit.ts";
import { getSetting } from "../settings.ts";
import { httpCheck, isOnline, setOnline } from "./connectivity.ts";
import { processDue, purgeSent, recoverInterrupted, stalledOfflineCount } from "./outbox.ts";
import { decode } from "../messages.ts";

/** Boucle de fond : vérifie internet, expédie la file, purge chaque jour. Renvoie une fonction d'arrêt. */
export function startWorker(opts: { intervalMs?: number; checkEveryMs?: number; now?: () => number; check?: () => Promise<boolean>; onChange?: () => void } = {}): () => void {
  const now = opts.now ?? Date.now;
  const check = opts.check ?? (async () => httpCheck(await getSetting<string>("technique.test_internet_url")));
  let lastCheck = 0;
  let lastPurge = 0;
  // Hors ligne, rien ne part et processDue ne prévient plus : le passage d'un
  // message au-delà des 30 minutes (« Pas d'internet ») doit pourtant mettre à
  // jour la liste à la main et sa pastille sans recharger la page.
  let lastStalled = 0;
  let busy = false;
  // Un tick en cours quand on arrête (ex. fin de test) ne doit plus toucher la
  // base après coup : chaque étape passe par ce drapeau avant de continuer.
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const t = now();
      if (t - lastCheck >= (opts.checkEveryMs ?? 30_000)) {
        const was = isOnline();
        setOnline(await check());
        if (stopped) return;
        lastCheck = t;
        if (was !== isOnline()) opts.onChange?.();
      }
      const processed = await processDue(t, isOnline());
      if (stopped) return;
      if (processed > 0) opts.onChange?.();
      const stalled = isOnline() ? 0 : await stalledOfflineCount(t);
      if (stopped) return;
      if (stalled > lastStalled) opts.onChange?.();
      lastStalled = stalled;
      if (t - lastPurge >= 86_400_000) {
        await purgeSent(t);
        if (stopped) return;
        await purgeAudit(t);
        lastPurge = t;
      }
    } catch (error) {
      if (!stopped) console.error("File d'envoi\u00a0:", error instanceof Error ? decode("fr", error.message) : error);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, opts.intervalMs ?? 5000);
  timer.unref?.();
  // La reprise (envois « en cours » → en attente) doit être terminée avant le
  // premier battement, et ne doit jamais devenir un rejet non capturé si elle échoue.
  recoverInterrupted()
    .catch((error) => console.error("File d'envoi\u00a0:", error instanceof Error ? decode("fr", error.message) : error))
    .finally(() => void tick());
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
