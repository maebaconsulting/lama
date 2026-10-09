import { ApiError } from "../api";
import type { Conflict } from "./conflit-texte";

export { conflictSentence, describeConflict, type Conflict } from "./conflit-texte";

/**
 * The clashes behind a rejected booking, or `null` if it failed for some other
 * reason. Lets a caller answer a clash in place and leave everything else to the
 * usual error path.
 */
export function conflictsFrom(err: unknown): Conflict[] | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  return (err.body as { conflicts?: Conflict[] }).conflicts ?? [];
}
