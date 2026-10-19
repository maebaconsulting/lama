import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agendaColumns, blockLines, blockTone, offeredStaffId, countByColumn, defaultColumnKey, gridHeight, HOUR_HEIGHT_PX, inColumn, initialScrollTop,
  minutesOf, neighborColumn, nowLineTop, shownColumnKey, slotAt, swipeStep,
} from "./agenda.ts";

/** Sous-projet 4 § 4.1 et § 4.2 : règles de l'agenda, vérifiées en exécution. */

test("minutesOf : HH:MM et HH:MM:SS lus, heure illisible ou hors bornes en NaN", () => {
  assert.equal(minutesOf("07:00"), 420);
  assert.equal(minutesOf("9:05"), 545);
  assert.equal(minutesOf("14:30:00"), 870);
  for (const bad of ["", "abc", "24:00", "12:60", "12h30"]) assert.ok(Number.isNaN(minutesOf(bad)), bad);
});

test("ligne « maintenant » : 64 px par heure depuis 07:00, absente hors de la journée", () => {
  assert.equal(gridHeight(), 16 * HOUR_HEIGHT_PX);
  assert.equal(nowLineTop("07:00"), 0);
  assert.equal(nowLineTop("09:30"), 160);
  assert.equal(nowLineTop("21:00"), 896);
  assert.equal(nowLineTop("23:00"), 1024);
  assert.equal(nowLineTop("06:59"), null);
  assert.equal(nowLineTop("23:01"), null);
  assert.equal(nowLineTop("n'importe quoi"), null);
  assert.equal(nowLineTop("08:00", 100), 100);
});

test("défilement à l'ouverture : une heure au-dessus de l'heure courante le jour même, le haut les autres jours", () => {
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "14:00"), 7 * 64 - 64);
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "07:20"), 0, "jamais négatif");
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "06:00"), 0, "avant l'ouverture : le haut");
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "23:30"), gridHeight(), "après la fermeture : tout en bas");
  assert.equal(initialScrollTop("2026-09-30", "2026-09-29", "14:00"), 0, "autre jour : le haut");
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "??"), 0);
});

test("créneau touché : le quart d'heure qui contient le point, entre 07:00 et 22:45", () => {
  assert.equal(slotAt(0), "07:00");
  assert.equal(slotAt(15.9), "07:00");
  assert.equal(slotAt(16), "07:15");
  assert.equal(slotAt(64 * 2 + 40), "09:30");
  assert.equal(slotAt(-30), "07:00", "au-dessus de la grille");
  assert.equal(slotAt(gridHeight()), "22:45", "bas de la grille : dernier début possible");
  assert.equal(slotAt(99999), "22:45");
  assert.equal(slotAt(Number.NaN), "07:00");
  assert.equal(slotAt(100, 0), "07:00", "hauteur nulle : pas de division par zéro");
});

const STAFF = [
  { id: 3, name: "Awa", color: "rose" },
  { id: 5, name: "Brenda", color: "vert" },
  { id: 8, name: "Carine", color: "bleu" },
];

test("colonnes : une par praticienne, « Non attribué » seulement s'il sert ce jour-là", () => {
  assert.deepEqual(agendaColumns(STAFF, [{ staff_id: 3 }], "Non attribué").map((c) => c.key), ["s-3", "s-5", "s-8"]);
  const columns = agendaColumns(STAFF, [{ staff_id: 3 }, { staff_id: null }], "Non attribué");
  assert.deepEqual(columns.at(-1), { key: "sans", staffId: null, name: "Non attribué", color: null });
  assert.deepEqual(agendaColumns([], [], "x"), []);
});

test("colonnes : une praticienne désactivée qui garde des rendez-vous ce jour-là a sa colonne, rien n'est caché", () => {
  const columns = agendaColumns(STAFF, [{ staff_id: 12, staff_name: "Delphine", staff_color: "or" }, { staff_id: 12, staff_name: "Delphine" }], "Non attribué");
  assert.deepEqual(columns.map((c) => c.key), ["s-3", "s-5", "s-8", "s-12"]);
  assert.deepEqual(columns[3], { key: "s-12", staffId: 12, name: "Delphine", color: "or" });
});

test("pastilles : nombre de rendez-vous du jour par colonne", () => {
  const appointments = [{ staff_id: 3 }, { staff_id: 3 }, { staff_id: 8 }, { staff_id: null }];
  const columns = agendaColumns(STAFF, appointments, "Non attribué");
  assert.deepEqual(countByColumn(columns, appointments), { "s-3": 2, "s-5": 0, "s-8": 1, sans: 1 });
  // Même règle d'appartenance pour la grille (rendez-vous et créneaux bloqués).
  const own = columns.find((c) => c.key === "s-3")!;
  const unassigned = columns.find((c) => c.key === "sans")!;
  assert.equal(inColumn(own, 3), true);
  assert.equal(inColumn(own, 8), false);
  assert.equal(inColumn(own, null), false, "un rendez-vous non attribué n'est pas dans la colonne d'une praticienne");
  assert.equal(inColumn(unassigned, null), true);
  assert.equal(inColumn(unassigned, 0), true, "praticienne 0 lue comme absente, comme `!staff_id`");
  assert.equal(inColumn(unassigned, 3), false);
});

test("téléphone, ouverture : la praticienne connectée, sinon la première qui a des rendez-vous", () => {
  const appointments = [{ staff_id: 8 }, { staff_id: null }];
  const columns = agendaColumns(STAFF, appointments, "Non attribué");
  const counts = countByColumn(columns, appointments);
  assert.equal(defaultColumnKey("practitioner", 5, columns, counts), "s-5", "sa propre colonne, même vide");
  assert.equal(defaultColumnKey("practitioner", 99, columns, counts), "s-8", "fiche de l'équipe absente : règle générale");
  assert.equal(defaultColumnKey("practitioner", null, columns, counts), "s-8");
  assert.equal(defaultColumnKey("reception", null, columns, counts), "s-8", "Awa et Brenda n'ont rien : Carine");
  assert.equal(defaultColumnKey("manager", null, agendaColumns(STAFF, [], "x"), {}), "s-3", "journée vide : la première");
  assert.equal(defaultColumnKey("manager", null, [], {}), null);
  const onlyUnassigned = agendaColumns(STAFF, [{ staff_id: null }], "x");
  assert.equal(defaultColumnKey("reception", null, onlyUnassigned, countByColumn(onlyUnassigned, [{ staff_id: null }])), "s-3", "une praticienne passe avant « Non attribué »");
});

test("téléphone : le choix fait à la main est gardé tant que la colonne existe", () => {
  const columns = agendaColumns(STAFF, [], "x");
  assert.equal(shownColumnKey("s-5", columns, "s-3"), "s-5");
  assert.equal(shownColumnKey("sans", columns, "s-3"), "s-3", "plus de non attribués ce jour-là");
  assert.equal(shownColumnKey(null, columns, "s-3"), "s-3");
});

test("glissement : vers la gauche la suivante, vers la droite la précédente, rien pour un geste court ou vertical", () => {
  assert.equal(swipeStep(-80, 10), 1);
  assert.equal(swipeStep(80, -10), -1);
  assert.equal(swipeStep(-30, 0), 0, "trop court");
  assert.equal(swipeStep(-80, 70), 0, "surtout vertical : défilement des heures");
  assert.equal(swipeStep(Number.NaN, 0), 0);
});

test("colonne voisine : sans boucler aux extrémités", () => {
  const columns = agendaColumns(STAFF, [], "x");
  assert.equal(neighborColumn(columns, "s-3", 1), "s-5");
  assert.equal(neighborColumn(columns, "s-8", 1), "s-8");
  assert.equal(neighborColumn(columns, "s-3", -1), "s-3");
  assert.equal(neighborColumn(columns, "inconnue", 1), "s-3");
  assert.equal(neighborColumn([], null, 1), null);
});

// Tâche 10 : lignes mesurées dans le navigateur (heure 16,5 px, cliente 16 px, prestation
// 16,5 px, marges et bords 10 px) : deux lignes à partir de 44 px, trois à partir de 60 px.
test("blockLines : 15 et 30 min sur une ligne, 45 min sur deux, une heure et plus sur trois", () => {
  assert.equal(blockLines(28), 1, "15 min, hauteur minimale");
  assert.equal(blockLines(32), 1, "30 min");
  assert.equal(blockLines(43), 1);
  assert.equal(blockLines(44), 2);
  assert.equal(blockLines(48), 2, "45 min");
  assert.equal(blockLines(59), 2);
  assert.equal(blockLines(60), 3);
  assert.equal(blockLines(64), 3, "une heure");
});

// Relecture finale (point 1) : une colonne de praticienne désactivée (§ 4.1) ne pré-remplit
// jamais « Nouveau rendez-vous » avec quelqu'un que la liste « Membre » ne propose pas.
test("offeredStaffId : seulement une praticienne de la liste proposée, sinon « Non attribué »", () => {
  const staff = [{ id: 1 }, { id: 2 }];
  assert.equal(offeredStaffId(2, staff), "2");
  assert.equal(offeredStaffId(9, staff), "", "praticienne désactivée : absente de la liste");
  assert.equal(offeredStaffId(null, staff), "");
  assert.equal(offeredStaffId(undefined, staff), "");
});

test("ton d'un bloc : passé pour terminé, absente ou annulé ; en retard si l'arrivée est attendue ; sinon normal", () => {
  const apt = (status: string, start = "15:30") => ({ status, scheduled_date: "2026-09-29", start_time: start });
  assert.equal(blockTone(apt("completed"), "2026-09-29", "16:00"), "passe");
  assert.equal(blockTone(apt("no_show"), "2026-09-29", "16:00"), "passe");
  assert.equal(blockTone(apt("cancelled"), "2026-09-29", "16:00"), "passe");
  assert.equal(blockTone(apt("confirmed"), "2026-09-29", "16:00"), "retard");
  assert.equal(blockTone(apt("confirmed", "17:00"), "2026-09-29", "16:00"), "normal");
  assert.equal(blockTone(apt("in_progress"), "2026-09-29", "16:00"), "normal");
});

test("ouverture du jour : le début du soin en cours reste en vue s'il a commencé plus d'une heure avant", () => {
  // 16:00, soin en cours depuis 14:00 : on remonte à 14:00 moins un quart d'heure de marge.
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "16:00", 64, "14:00"), 7 * 64 - 16);
  // Soin commencé à 15:30 : l'heure au-dessus de maintenant le montre déjà.
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "16:00", 64, "15:30"), 8 * 64);
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "16:00", 64, "07:00"), 0, "jamais négatif");
  assert.equal(initialScrollTop("2026-09-30", "2026-09-29", "16:00", 64, "14:00"), 0, "autre jour : le haut");
  assert.equal(initialScrollTop("2026-09-29", "2026-09-29", "16:00", 64, "??"), 8 * 64, "heure du soin illisible : ignorée");
});
