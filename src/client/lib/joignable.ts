/**
 * Serveur joignable ou non, vu par l'écran (PWA, P-04) : chaque réponse de
 * l'API le rend joignable, chaque échec réseau injoignable. Le bandeau
 * « Serveur injoignable » s'y abonne ; l'enveloppe de l'application s'ouvre
 * sans serveur, mais aucune donnée n'est présentée comme actuelle.
 */
type Ecouteur = (joignable: boolean) => void;

let joignable = true;
const abonnes = new Set<Ecouteur>();

export function serveurJoignable(): boolean {
  return joignable;
}

/** Note l'issue d'une requête ; les abonnés ne sont prévenus que d'un changement. */
export function noterJoignable(ok: boolean): void {
  if (ok === joignable) return;
  joignable = ok;
  for (const abonne of [...abonnes]) abonne(ok);
}

export function onJoignable(ecouteur: Ecouteur): () => void {
  abonnes.add(ecouteur);
  return () => { abonnes.delete(ecouteur); };
}

/**
 * « Réessayer » : interroge le serveur ; s'il répond, tous les écrans relisent
 * leurs données (`rafraichir`). Rend vrai si l'appel de sondage n'a pas échoué, faux s'il a levé
 * une erreur : réseau coupé, mais aussi réponse du serveur en erreur HTTP (alors `api` a déjà
 * noté le serveur joignable, et `rafraichir` n'est pas appelé).
 */
export async function reessayer(sonder: () => Promise<unknown>, rafraichir: () => void): Promise<boolean> {
  try {
    await sonder();
  } catch {
    return false;
  }
  rafraichir();
  return true;
}

/** Remet l'état à zéro entre deux essais. */
export function oublierJoignablePourEssai(): void {
  joignable = true;
  abonnes.clear();
}
