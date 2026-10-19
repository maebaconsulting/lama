/**
 * Praticiennes proposées pour un rendez-vous (spec du 16/10/2026 § 4.1) : celles qui
 * pratiquent toutes les prestations choisies d'abord, les autres ensuite. Simple
 * suggestion : au comptoir, aucune n'est retirée de la liste.
 */
export function parPrestations<T extends { service_ids: number[] }>(staff: T[], serviceIds: number[]): { pratiquent: T[]; autres: T[] } {
  const pratiquent: T[] = [];
  const autres: T[] = [];
  for (const s of staff) (serviceIds.every((id) => s.service_ids.includes(id)) ? pratiquent : autres).push(s);
  return { pratiquent, autres };
}
