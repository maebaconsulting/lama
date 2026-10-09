/**
 * Requêtes partagées : le « + » du téléphone (monté au démarrage) et « Ma
 * journée » (montée après le chargement initial) demandent le même jour à
 * quelques millisecondes d'écart. Une demande en vol est partagée ; un écran
 * qui s'ouvre (`reuseRecent`) reprend une réponse reçue depuis moins de
 * `maxAgeMs`. Un rechargement demandé (Réessayer, statut changé, signal du
 * serveur) repart toujours au serveur. Un échec n'est jamais gardé.
 */
export function shareRequests<T>(
  fetcher: (url: string) => Promise<T>,
  maxAgeMs: number,
  now: () => number = Date.now,
): (url: string, reuseRecent: boolean) => Promise<T> {
  const inFlight = new Map<string, Promise<T>>();
  const recent = new Map<string, { at: number; value: T }>();
  return (url, reuseRecent) => {
    const pending = inFlight.get(url);
    if (pending) return pending;
    const kept = recent.get(url);
    if (reuseRecent && kept && now() - kept.at < maxAgeMs) return Promise.resolve(kept.value);
    const request = fetcher(url).then(
      (value) => { recent.set(url, { at: now(), value }); return value; },
      (err: unknown) => { recent.delete(url); throw err; },
    ).finally(() => inFlight.delete(url));
    inFlight.set(url, request);
    return request;
  };
}
