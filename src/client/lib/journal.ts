/** Filtres du journal des accès (spec § 3.5), en jours de l'institut. */

// Africa/Douala : UTC+1 toute l'année, sans heure d'été.
const DOUALA = "+01:00";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function dayStart(date: string): number | null {
  return DAY.test(date) ? Date.parse(`${date}T00:00:00${DOUALA}`) : null;
}

export function dayEnd(date: string): number | null {
  return DAY.test(date) ? Date.parse(`${date}T23:59:59.999${DOUALA}`) : null;
}

export function auditQuery(f: { accountId: string; from: string; to: string }, limit = 200): string {
  const params = new URLSearchParams();
  if (f.accountId) params.set("account_id", f.accountId);
  const from = dayStart(f.from);
  if (from !== null) params.set("from", String(from));
  const to = dayEnd(f.to);
  if (to !== null) params.set("to", String(to));
  params.set("limit", String(limit));
  return params.toString();
}
