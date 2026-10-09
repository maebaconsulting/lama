export const MAX_FAILURES = 5;
const BASE_LOCK_MS = 5 * 60_000;
const MAX_LOCK_MS = 24 * 60 * 60_000;

export function lockDuration(series: number): number {
  return Math.min(BASE_LOCK_MS * 2 ** (series - 1), MAX_LOCK_MS);
}

/** État après un échec : au cinquième, blocage et nouvelle série. */
export function afterFailure(state: { failed_attempts: number; lock_series: number }, now: number) {
  const failed = state.failed_attempts + 1;
  if (failed < MAX_FAILURES) return { failed_attempts: failed, lock_series: state.lock_series, locked_until: null as number | null };
  const series = state.lock_series + 1;
  return { failed_attempts: 0, lock_series: series, locked_until: now + lockDuration(series) };
}
