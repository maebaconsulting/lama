/**
 * Horaires de l'institut et semaine type des praticiennes (réservation en ligne,
 * spec du 16/10/2026 § 4.1). Module pur, partagé par le serveur et l'écran :
 * format d'une semaine, validation, et arithmétique d'intervalles en minutes
 * depuis minuit, bornes de fin exclusives (comme `scheduling.ts`).
 */

export const JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"] as const;
export type Jour = (typeof JOURS)[number];
/** Plage `["09:00", "12:00"]`, fin exclusive. */
export type Plage = [string, string];
/** Jour sans plage : fermé (institut) ou repos (praticienne). Au plus deux plages par jour. */
export type Semaine = Record<Jour, Plage[]>;
export type Intervalle = { start: number; end: number };

/** Bornes de la grille de l'agenda (`DAY_OPEN`, `DAY_CLOSE` de `scheduling.ts`) : 07:00 à 23:00 (spec du 18/10/2026 § 9.4). */
export const OUVERTURE_MIN = 7 * 60;
export const FERMETURE_MAX = 23 * 60;

const JOURNEE: Plage[] = [["09:00", "19:00"]];
export const SEMAINE_DEFAUT: Semaine = { lun: JOURNEE, mar: JOURNEE, mer: JOURNEE, jeu: JOURNEE, ven: JOURNEE, sam: JOURNEE, dim: [] };

function minutes(h: unknown): number | null {
  if (typeof h !== "string") return null;
  const m = /^(\d{2}):(\d{2})$/.exec(h);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `545` -> `"09:05"`. */
export function enHeure(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Vrai si `v` n'est pas une semaine valide : 7 jours, au plus 2 plages triées, disjointes, non collées, dans la grille, minutes multiples de 5. */
export function semaineProblem(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return true;
  const keys = Object.keys(v);
  if (keys.length !== JOURS.length || !JOURS.every((j) => keys.includes(j))) return true;
  for (const j of JOURS) {
    const plages = (v as Record<string, unknown>)[j];
    if (!Array.isArray(plages) || plages.length > 2) return true;
    let fin = -1;
    for (const p of plages) {
      if (!Array.isArray(p) || p.length !== 2) return true;
      const a = minutes(p[0]);
      const b = minutes(p[1]);
      if (a === null || b === null || a % 5 !== 0 || b % 5 !== 0) return true;
      if (a < OUVERTURE_MIN || b > FERMETURE_MAX || a >= b || a <= fin) return true;
      fin = b;
    }
  }
  return false;
}

/** Jour de la semaine d'une date `AAAA-MM-JJ`, calculé à midi UTC pour ne pas dépendre du fuseau de la machine. */
export function jourDe(date: string): Jour {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return (["dim", "lun", "mar", "mer", "jeu", "ven", "sam"] as const)[d];
}

/** Vrai pour une date `aaaa-mm-jj` qui existe au calendrier (le 30 février est refusé). */
export function dateValide(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function versIntervalles(plages: Plage[]): Intervalle[] {
  return plages.map(([a, b]) => ({ start: minutes(a) ?? 0, end: minutes(b) ?? 0 })).filter((i) => i.end > i.start);
}

/** Parties communes de deux listes d'intervalles, triées. */
export function intersection(a: Intervalle[], b: Intervalle[]): Intervalle[] {
  const out: Intervalle[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (start < end) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

/** `base` privée de `retraits` (qui peuvent se chevaucher et être dans le désordre). */
export function soustraire(base: Intervalle[], retraits: Intervalle[]): Intervalle[] {
  let reste = base.map((i) => ({ ...i }));
  for (const r of retraits) {
    reste = reste.flatMap((i) => {
      if (r.end <= i.start || r.start >= i.end) return [i];
      const out: Intervalle[] = [];
      if (r.start > i.start) out.push({ start: i.start, end: r.start });
      if (r.end < i.end) out.push({ start: r.end, end: i.end });
      return out;
    });
  }
  return reste.sort((p, q) => p.start - q.start);
}

/** Heures de travail d'une praticienne ce jour-là : sa semaine (ou celle de l'institut si `null`), tronquée aux horaires de l'institut. */
export function heuresTravail(semaine: Semaine | null, institut: Semaine, date: string): Intervalle[] {
  const jour = jourDe(date);
  return intersection(versIntervalles((semaine ?? institut)[jour]), versIntervalles(institut[jour]));
}

/** Heures de la grille (07:00 à 23:00) où la praticienne ne travaille pas : grisées dans l'agenda. */
export function heuresFermees(semaine: Semaine | null, institut: Semaine, date: string): Intervalle[] {
  return soustraire([{ start: OUVERTURE_MIN, end: FERMETURE_MAX }], heuresTravail(semaine, institut, date));
}

/** Pause de midi proposée par l'éditeur : 12:00 à 13:00 si la plage l'englobe, sinon la plage telle quelle. */
export function avecPause(p: Plage): Plage[] {
  const a = minutes(p[0]) ?? 0;
  const b = minutes(p[1]) ?? 0;
  return a < 12 * 60 && b > 13 * 60 ? [[p[0], "12:00"], ["13:00", p[1]]] : [p];
}
