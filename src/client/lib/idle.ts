/** Verrouillage d'un poste partagé après un délai sans geste (spec § 3.3). */

export const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
export const CHECK_EVERY_MS = 5_000;

/** Délai restant avant verrouillage, jamais négatif. */
export function msUntilLock(lastActivity: number, now: number, idleMs: number): number {
  return Math.max(0, lastActivity + idleMs - now);
}
