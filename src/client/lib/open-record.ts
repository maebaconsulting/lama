import { ApiError } from "./http.ts";

/**
 * Recharge en arrière-plan une fiche ouverte (rendez-vous ou cliente) après un
 * signal temps réel. La réponse n'est appliquée que si la même fiche est
 * toujours ouverte (la réception a pu en ouvrir une autre entre-temps), et la
 * fiche n'est fermée que si le serveur dit qu'elle n'existe plus (404) ou n'est
 * plus permise (403) : une erreur passagère du Wi-Fi la laisse à l'écran.
 */
export async function reloadOpenRecord<R>(o: {
  id: number;
  load: () => Promise<R>;
  currentId: () => number | undefined;
  apply: (result: R) => void;
  close: () => void;
}): Promise<void> {
  try {
    const result = await o.load();
    if (o.currentId() === o.id) o.apply(result);
  } catch (err) {
    if (o.currentId() !== o.id) return;
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) o.close();
  }
}
