/**
 * Règles de l'agenda (sous-projet 4 § 4.1 et § 4.2), sans dépendance au
 * navigateur pour être testées sous Node : colonnes, ligne « maintenant »,
 * défilement à l'ouverture, créneau touché, praticienne montrée sur téléphone
 * et glissement latéral. Les heures sont des chaînes `HH:MM` à l'heure de
 * Douala ; la journée va de 07:00 à 23:00 (`lib/creneaux.ts`).
 */
import { DAY_END_HOUR, DAY_START_HOUR, SLOT_MINUTES } from "./creneaux.ts";
import { awaitingArrival } from "./fiche-rdv.ts";

/** Hauteur d'une heure sur la grille, en pixels (un créneau de 15 minutes fait 16 px). */
export const HOUR_HEIGHT_PX = 64;

const DAY_START = DAY_START_HOUR * 60;
const DAY_END = DAY_END_HOUR * 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes depuis minuit d'une heure `HH:MM` (ou `HH:MM:SS`) ; `NaN` si elle est illisible. */
export function minutesOf(time: string): number {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!m) return Number.NaN;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : Number.NaN;
}

/**
 * Nombre de lignes qu'un bloc de rendez-vous de `height` pixels peut écrire
 * sans en couper une : 1 (heure et cliente sur la même ligne), 2 (heure et
 * statut, puis cliente) ou 3 (plus la prestation). Seuils mesurés dans le
 * navigateur : 16,5 px par ligne à 11 px, 16 px à 12 px, 10 px de marges et
 * de bords. Un rendez-vous de 15 ou 30 minutes tient sur une ligne, un de
 * 45 minutes sur deux, une heure et plus sur trois.
 */
export function blockLines(height: number): 1 | 2 | 3 {
  if (height >= 60) return 3;
  if (height >= 44) return 2;
  return 1;
}

/**
 * Praticienne pré-remplie dans « Nouveau rendez-vous » (valeur du champ
 * « Membre ») : seulement si la liste proposée la contient. Une colonne de
 * praticienne désactivée (§ 4.1) donne « Non attribué » : le formulaire ne
 * crée jamais chez quelqu'un qu'il n'affiche pas.
 */
export function offeredStaffId(wanted: number | null | undefined, staff: { id: number }[]): string {
  return wanted != null && staff.some((s) => s.id === wanted) ? String(wanted) : "";
}

/** Hauteur totale de la grille, de 07:00 à 23:00. */
export function gridHeight(hourHeight: number = HOUR_HEIGHT_PX): number {
  return ((DAY_END - DAY_START) / 60) * hourHeight;
}

/**
 * Position verticale (px) de l'heure `time` sur la grille : celle de la ligne
 * « maintenant ». `null` avant 07:00, après 23:00 ou pour une heure illisible :
 * la ligne n'est alors pas dessinée.
 */
export function nowLineTop(time: string, hourHeight: number = HOUR_HEIGHT_PX): number | null {
  const minutes = minutesOf(time);
  if (!(minutes >= DAY_START && minutes <= DAY_END)) return null;
  return ((minutes - DAY_START) / 60) * hourHeight;
}

/**
 * Défilement vertical à l'ouverture d'un jour. Jour courant : une heure au-dessus
 * de l'heure courante, pour garder le rendez-vous qui vient de commencer en vue ;
 * tout en bas après 23:00 ; le début d'un soin encore en cours (`ongoingStart`) reste
 * en vue. Autre jour, ou heure illisible : le haut de la journée.
 */
export function initialScrollTop(day: string, today: string, time: string, hourHeight: number = HOUR_HEIGHT_PX, ongoingStart?: string): number {
  if (day !== today) return 0;
  const minutes = minutesOf(time);
  if (Number.isNaN(minutes)) return 0;
  if (minutes > DAY_END) return gridHeight(hourHeight);
  const top = nowLineTop(time, hourHeight);
  if (top === null) return 0;
  // Soin en cours commencé plus tôt : son début reste en vue, avec un quart d'heure de marge.
  const ongoing = ongoingStart === undefined ? null : nowLineTop(ongoingStart, hourHeight);
  const wanted = ongoing === null ? top - hourHeight : Math.min(top - hourHeight, ongoing - hourHeight / 4);
  return Math.max(0, wanted);
}

/** Ton d'un bloc de l'agenda : estompé une fois passé, marqué quand la cliente est attendue. */
export type BlockTone = "passe" | "retard" | "normal";

/**
 * Terminé, Absente et Annulé : « passe » (bloc estompé) ; réservé ou confirmé
 * dont l'heure est passée : « retard » (règle `awaitingArrival`) ; sinon « normal ».
 */
export function blockTone(apt: { status: string; scheduled_date: string; start_time: string }, today: string, now: string): BlockTone {
  if (apt.status === "completed" || apt.status === "no_show" || apt.status === "cancelled") return "passe";
  return awaitingArrival(apt, today, now) ? "retard" : "normal";
}

/**
 * Heure de début proposée pour un créneau vide touché à `offsetY` pixels du
 * haut de la grille : le quart d'heure qui contient le point touché, entre
 * 07:00 et 20:45 (dernier début possible, comme les listes de `ChampHeure`).
 */
export function slotAt(offsetY: number, hourHeight: number = HOUR_HEIGHT_PX): string {
  const raw = Number.isFinite(offsetY) && hourHeight > 0
    ? DAY_START + Math.floor(((offsetY / hourHeight) * 60) / SLOT_MINUTES) * SLOT_MINUTES
    : DAY_START;
  const minutes = Math.min(Math.max(raw, DAY_START), DAY_END - SLOT_MINUTES);
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Une colonne de l'agenda : une praticienne, ou les rendez-vous non attribués. */
export interface AgendaColumn {
  key: string;
  staffId: number | null;
  name: string;
  color: string | null;
}

/**
 * Colonnes du jour : une par praticienne active (ordre de l'équipe), puis une
 * par praticienne désactivée qui garde des rendez-vous ce jour-là (nom et
 * couleur lus sur le rendez-vous), puis « Non attribué » seulement si un
 * rendez-vous du jour n'a pas de praticienne. Aucun rendez-vous n'est caché.
 */
export function agendaColumns(
  staff: { id: number; name: string; color: string }[],
  appointments: { staff_id: number | null; staff_name?: string | null; staff_color?: string | null }[],
  unassignedLabel: string,
): AgendaColumn[] {
  const columns: AgendaColumn[] = staff.map((s) => ({ key: `s-${s.id}`, staffId: s.id, name: s.name, color: s.color }));
  for (const a of appointments) {
    if (a.staff_id && !columns.some((c) => c.staffId === a.staff_id)) {
      columns.push({ key: `s-${a.staff_id}`, staffId: a.staff_id, name: a.staff_name || unassignedLabel, color: a.staff_color ?? null });
    }
  }
  if (appointments.some((a) => !a.staff_id)) columns.push({ key: "sans", staffId: null, name: unassignedLabel, color: null });
  return columns;
}

/**
 * Appartenance d'un rendez-vous ou d'un créneau bloqué (par sa praticienne
 * `staffId`) à une colonne : « Non attribué » reçoit ce qui n'a pas de
 * praticienne, une colonne de praticienne ce qui lui est attribué.
 */
export function inColumn(column: AgendaColumn, staffId: number | null): boolean {
  return column.staffId === null ? !staffId : staffId === column.staffId;
}

/** Nombre de rendez-vous du jour dans chaque colonne (pastilles du téléphone). */
export function countByColumn(columns: AgendaColumn[], appointments: { staff_id: number | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const column of columns) {
    counts[column.key] = appointments.filter((a) => inColumn(column, a.staff_id)).length;
  }
  return counts;
}

/**
 * Colonne montrée à l'ouverture de l'agenda sur téléphone (§ 4.2) : celle de
 * la praticienne connectée ; sinon la première praticienne qui a des
 * rendez-vous ce jour-là ; sinon la première colonne ; `null` sans colonne.
 */
export function defaultColumnKey(
  role: string,
  ownStaffId: number | null,
  columns: AgendaColumn[],
  counts: Record<string, number>,
): string | null {
  if (role === "practitioner" && ownStaffId !== null) {
    const own = columns.find((c) => c.staffId === ownStaffId);
    if (own) return own.key;
  }
  const busy = columns.find((c) => c.staffId !== null && (counts[c.key] ?? 0) > 0);
  return (busy ?? columns[0])?.key ?? null;
}

/**
 * Colonne montrée : le choix fait à la main s'il existe encore ce jour-là,
 * sinon la colonne par défaut (praticienne retirée de l'équipe, jour changé
 * sans rendez-vous non attribué).
 */
export function shownColumnKey(chosen: string | null, columns: AgendaColumn[], fallback: string | null): string | null {
  return chosen !== null && columns.some((c) => c.key === chosen) ? chosen : fallback;
}

/** Distance horizontale minimale d'un glissement, en pixels. */
export const SWIPE_MIN_PX = 50;

/**
 * Sens d'un glissement sur la grille du téléphone : +1 (vers la gauche,
 * praticienne suivante), -1 (vers la droite, précédente), 0 si le geste est
 * trop court ou surtout vertical (défilement des heures).
 */
export function swipeStep(dx: number, dy: number, min: number = SWIPE_MIN_PX): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

/** Colonne voisine de `current` dans le sens `step`, sans boucler : la même aux extrémités. */
export function neighborColumn(columns: AgendaColumn[], current: string | null, step: -1 | 0 | 1): string | null {
  const index = columns.findIndex((c) => c.key === current);
  if (index === -1) return columns[0]?.key ?? null;
  const next = Math.min(Math.max(index + step, 0), columns.length - 1);
  return columns[next].key;
}

/**
 * Clé du nom lu d'un bloc de rendez-vous (lecteur d'écran) : sans cliente,
 * une variante sans `{cliente}`, jamais « 09:00, , Réservé » (passe V 1.0, V1-34).
 */
export function blockLabelKey(late: boolean, clientName: string | null | undefined) {
  const sans = !(clientName ?? "").trim();
  if (late) return sans ? ("agenda.bloc_rdv_sans_cliente_retard" as const) : ("agenda.bloc_rdv_retard" as const);
  return sans ? ("agenda.bloc_rdv_sans_cliente" as const) : ("agenda.bloc_rdv" as const);
}
