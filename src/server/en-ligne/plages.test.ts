import assert from "node:assert/strict";
import { test } from "node:test";
import { SEMAINE_DEFAUT, type Semaine } from "../../shared/horaires.ts";
import type { Busy } from "../scheduling.ts";
import { plagesLibres } from "./plages.ts";

const institut: Semaine = { ...SEMAINE_DEFAUT, lun: [["09:00", "12:00"], ["13:00", "19:00"]] };
const rdv = (start_time: string, end_time: string): Busy => ({ kind: "appointment", start_time, end_time, label: "" });
const bloc = (start_time: string, end_time: string): Busy => ({ kind: "blocked", start_time, end_time, label: "" });
const LUNDI = "2026-10-19";

test("sans occupation : les heures de travail du jour", () => {
  assert.deepEqual(plagesLibres(null, institut, [], LUNDI), [{ start: 540, end: 720 }, { start: 780, end: 1140 }]);
});

test("rendez-vous et créneau bloqué retirés, y compris un blocage qui chevauche la pause de midi", () => {
  const libres = plagesLibres(null, institut, [rdv("09:00", "10:00"), bloc("11:30", "13:30"), rdv("18:00", "19:00")], LUNDI);
  assert.deepEqual(libres, [{ start: 600, end: 690 }, { start: 810, end: 1080 }]);
});

test("heures avec secondes (« 10:00:00 ») acceptées ; occupation vide ou inversée ignorée", () => {
  assert.deepEqual(plagesLibres(null, institut, [rdv("10:00:00", "11:00:00"), rdv("15:00", "15:00"), rdv("16:00", "15:00")], LUNDI),
    [{ start: 540, end: 600 }, { start: 660, end: 720 }, { start: 780, end: 1140 }]);
});

test("repos de la praticienne et dimanche : aucune plage", () => {
  assert.deepEqual(plagesLibres({ ...SEMAINE_DEFAUT, lun: [] }, institut, [], LUNDI), []);
  assert.deepEqual(plagesLibres(null, institut, [], "2026-10-25"), []);
});

test("grille jusqu'à 23:00 : une soirée jusqu'à 22:00 est publiée entière", () => {
  const soir: Semaine = { ...SEMAINE_DEFAUT, ven: [["09:30", "22:00"]] };
  assert.deepEqual(plagesLibres(null, soir, [rdv("21:00", "21:30")], "2026-10-23"), [{ start: 570, end: 1260 }, { start: 1290, end: 1320 }]);
});

test("date mal formée ou qui n'existe pas : aucune plage, jamais d'exception", () => {
  for (const date of ["2026-02-30", "20261019", "", "lundi"]) assert.deepEqual(plagesLibres(null, institut, [], date), [], date);
});
