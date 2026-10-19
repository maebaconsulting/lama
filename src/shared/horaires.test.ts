import assert from "node:assert/strict";
import { test } from "node:test";
import { avecPause, dateValide, enHeure, heuresFermees, heuresTravail, intersection, jourDe, SEMAINE_DEFAUT, semaineProblem, soustraire, type Semaine } from "./horaires.ts";

const semaine = (over: Partial<Semaine> = {}): Semaine => ({ ...SEMAINE_DEFAUT, ...over });

test("semaine par défaut : du lundi au samedi 09:00 à 19:00, dimanche fermé, et valide", () => {
  assert.deepEqual(SEMAINE_DEFAUT.lun, [["09:00", "19:00"]]);
  assert.deepEqual(SEMAINE_DEFAUT.sam, [["09:00", "19:00"]]);
  assert.deepEqual(SEMAINE_DEFAUT.dim, []);
  assert.equal(semaineProblem(SEMAINE_DEFAUT), false);
});

test("validation : refuse les semaines malformées", () => {
  assert.equal(semaineProblem(null), true);
  assert.equal(semaineProblem([]), true);
  const { dim: _dim, ...sansDimanche } = SEMAINE_DEFAUT;
  assert.equal(semaineProblem(sansDimanche), true, "jour manquant");
  assert.equal(semaineProblem({ ...SEMAINE_DEFAUT, xyz: [] }), true, "jour inconnu");
  assert.equal(semaineProblem(semaine({ lun: [["09:00", "12:00"], ["13:00", "15:00"], ["16:00", "18:00"]] })), true, "trois plages");
  assert.equal(semaineProblem(semaine({ lun: [["06:00", "12:00"]] })), true, "avant 07:00");
  assert.equal(semaineProblem(semaine({ lun: [["09:00", "23:05"]] })), true, "après 23:00");
  assert.equal(semaineProblem(semaine({ ven: [["09:30", "22:00"]], sam: [["09:30", "23:00"]] })), false, "soirée jusqu'à 22:00 ou 23:00");
  assert.equal(semaineProblem(semaine({ lun: [["09:03", "12:00"]] })), true, "minutes non multiples de 5");
  assert.equal(semaineProblem(semaine({ lun: [["12:00", "12:00"]] })), true, "plage vide");
  assert.equal(semaineProblem(semaine({ lun: [["09:00", "13:00"], ["12:00", "18:00"]] })), true, "chevauchement");
  assert.equal(semaineProblem(semaine({ lun: [["14:00", "18:00"], ["09:00", "12:00"]] })), true, "désordre");
  assert.equal(semaineProblem(semaine({ lun: [["09:00", "12:00"], ["12:00", "18:00"]] })), true, "plages collées : une seule plage attendue");
  assert.equal(semaineProblem(semaine({ lun: [["9:00", "12:00"]] })), true, "format hh:mm");
  assert.equal(semaineProblem(semaine({ lun: [["07:00", "21:00"]], mar: [["09:00", "12:00"], ["13:00", "19:00"]] })), false);
});

test("jourDe : jour de la semaine d'une date, sans dépendre du fuseau de la machine", () => {
  assert.equal(jourDe("2026-10-19"), "lun");
  assert.equal(jourDe("2026-10-24"), "sam");
  assert.equal(jourDe("2026-10-25"), "dim");
});

test("intersection et soustraction d'intervalles", () => {
  assert.deepEqual(intersection([{ start: 540, end: 1140 }], [{ start: 600, end: 720 }, { start: 780, end: 1200 }]), [{ start: 600, end: 720 }, { start: 780, end: 1140 }]);
  assert.deepEqual(intersection([{ start: 540, end: 600 }], [{ start: 600, end: 700 }]), [], "bords qui se touchent : rien en commun");
  assert.deepEqual(soustraire([{ start: 540, end: 1140 }], [{ start: 600, end: 660 }, { start: 630, end: 700 }]), [{ start: 540, end: 600 }, { start: 700, end: 1140 }], "retraits qui se chevauchent");
  assert.deepEqual(soustraire([{ start: 540, end: 600 }], [{ start: 500, end: 700 }]), [], "tout retiré");
  assert.deepEqual(soustraire([{ start: 540, end: 600 }], [{ start: 600, end: 700 }]), [{ start: 540, end: 600 }], "retrait collé : rien retiré");
});

test("heures de travail : semaine propre tronquée à l'institut ; null = comme l'institut ; repos", () => {
  const institut = semaine({ lun: [["09:00", "18:00"]] });
  assert.deepEqual(heuresTravail(null, institut, "2026-10-19"), [{ start: 540, end: 1080 }]);
  const propre = semaine({ lun: [["08:00", "12:00"], ["14:00", "20:00"]] });
  assert.deepEqual(heuresTravail(propre, institut, "2026-10-19"), [{ start: 540, end: 720 }, { start: 840, end: 1080 }]);
  assert.deepEqual(heuresTravail(semaine({ lun: [] }), institut, "2026-10-19"), [], "repos");
  assert.deepEqual(heuresTravail(null, institut, "2026-10-25"), [], "dimanche fermé");
});

test("heures fermées : complément des heures de travail dans la grille 07:00 à 23:00", () => {
  const institut = semaine({ lun: [["09:00", "12:00"], ["13:00", "19:00"]] });
  assert.deepEqual(heuresFermees(null, institut, "2026-10-19"), [{ start: 420, end: 540 }, { start: 720, end: 780 }, { start: 1140, end: 1380 }]);
  assert.deepEqual(heuresFermees(null, institut, "2026-10-25"), [{ start: 420, end: 1380 }]);
});

test("avecPause : coupe 12:00 à 13:00 quand la plage l'englobe, sinon rien", () => {
  assert.deepEqual(avecPause(["09:00", "19:00"]), [["09:00", "12:00"], ["13:00", "19:00"]]);
  assert.deepEqual(avecPause(["13:00", "19:00"]), [["13:00", "19:00"]]);
  assert.deepEqual(avecPause(["09:00", "12:30"]), [["09:00", "12:30"]]);
});

test("enHeure : minutes vers hh:mm", () => {
  assert.equal(enHeure(545), "09:05");
  assert.equal(enHeure(1260), "21:00");
});

test("dateValide : AAAA-MM-JJ d'un jour qui existe", () => {
  assert.equal(dateValide("2026-10-19"), true);
  assert.equal(dateValide("2028-02-29"), true);
  for (const d of ["2026-02-30", "2026-13-01", "20261019", "", "2026-1-19"]) assert.equal(dateValide(d), false, d);
});
