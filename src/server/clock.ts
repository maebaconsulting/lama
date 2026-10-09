/** Heure courante en millisecondes ; les tests injectent `CLOCK` dans l'environnement Hono. */
export function nowOf(c: { env?: { CLOCK?: () => number } }): number {
  return c.env?.CLOCK ? c.env.CLOCK() : Date.now();
}
