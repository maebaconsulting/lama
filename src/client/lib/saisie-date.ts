/**
 * Saisie des dates et des heures au format de l'institut (spec § 3.3) :
 * `27/09/2026` et `14:30` sur 24 h, dans les deux langues. Les champs natifs
 * `type="date"` et `type="time"` suivent la langue du navigateur, pas celle
 * de l'écran (`lang` est ignoré) : un navigateur réglé en anglais américain
 * affiche `09/27/2026` et `02:30 PM`. Les champs de saisie sont donc du texte,
 * lu et écrit ici. Sans dépendance au navigateur, pour être testé sous Node.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Vrai si le jour existe (31/02 et 29/02 d'une année non bissextile refusés) et l'année est plausible (M2, relecture finale). */
function realDay(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

/** `jj/mm/aaaa` (ou `-`, `.`, huit chiffres `jjmmaaaa`, ou la forme `aaaa-mm-jj` de l'API) vers `aaaa-mm-jj` ; `null` si incomplet ou impossible. */
export function dateFromText(text: string): string | null {
  const t = text.trim();
  let y: number, m: number, d: number;
  // Huit chiffres jjmmaaaa : le pavé numérique de l'iPhone (`inputMode="numeric"`) n'a ni `/`, ni `-`, ni `.`.
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (fr) [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;
  return realDay(y, m, d) ? `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}` : null;
}

/** Comme `dateFromText`, avec des bornes facultatives incluses (`aaaa-mm-jj`, vide = aucune) : `null` hors bornes. */
export function dateWithin(text: string, min?: string, max?: string): string | null {
  const day = dateFromText(text);
  if (day === null || (min && day < min) || (max && day > max)) return null;
  return day;
}

/** `aaaa-mm-jj` vers `jj/mm/aaaa` ; vide pour une valeur vide ou illisible. */
export function dateToText(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** `14:30`, `9:05`, `14h30`, `1430`, `9` vers `hh:mm` sur 24 h ; `null` si impossible. */
export function timeFromText(text: string): string | null {
  const t = text.trim().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?:[:h](\d{2})?)?$/i.exec(t) ?? /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** `hh:mm` (ou `hh:mm:ss`) vers `hh:mm` ; vide pour une valeur vide ou illisible. */
export function timeToText(value: string): string {
  const m = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(value);
  return m ? `${m[1]}:${m[2]}` : "";
}
