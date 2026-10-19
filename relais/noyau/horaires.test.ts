import assert from "node:assert/strict";
import { test } from "node:test";
import { jourDe, ouvertA, type Horaires } from "./horaires.ts";

const JOUR: [string, string][] = [["09:00", "20:00"]];
const SOIR: [string, string][] = [["09:30", "22:00"]];
const H: Horaires = { lun: JOUR, mar: JOUR, mer: JOUR, jeu: JOUR, ven: SOIR, sam: SOIR, dim: [] };
const DOUALA = "Africa/Douala";

test("jourDe : jour de la semaine d'une date, sans effet de fuseau", () => {
  assert.equal(jourDe("2026-10-20"), "mar");
  assert.equal(jourDe("2026-10-25"), "dim");
});

test("ouvertA : dans le fuseau de l'institut, début compris, fin exclue", () => {
  // Mardi 20 octobre 2026 : 07:00 UTC est 08:00 à Douala, avant l'ouverture.
  assert.equal(ouvertA(H, Date.UTC(2026, 9, 20, 7, 0), DOUALA), false);
  assert.equal(ouvertA(H, Date.UTC(2026, 9, 20, 8, 0), DOUALA), true, "09:00 pile");
  assert.equal(ouvertA(H, Date.UTC(2026, 9, 20, 18, 59), DOUALA), true, "19:59");
  // 19:30 UTC : encore ouvert en UTC, mais 20:30 à Douala, donc fermé.
  assert.equal(ouvertA(H, Date.UTC(2026, 9, 20, 19, 30), DOUALA), false);
  assert.equal(ouvertA(H, Date.UTC(2026, 9, 23, 20, 30), DOUALA), true, "vendredi 21:30 à Douala");
  assert.equal(ouvertA(H, Date.UTC(2026, 9, 25, 10, 0), DOUALA), false, "dimanche fermé");
});

test("ouvertA : sans horaires publiés, on ne sait pas", () => {
  assert.equal(ouvertA(undefined, Date.UTC(2026, 9, 20, 7, 0), DOUALA), null);
});
