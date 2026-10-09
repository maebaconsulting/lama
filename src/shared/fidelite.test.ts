import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TIERS, nextTier, pointsFor, reachableTiers, reprisePoints, tiersProblem } from "./fidelite.ts";

/** Règles de la fidélité (mini CRM § 2, décisions 12, 13, 17), communes à l'écran et au serveur. */

const RULE = { tranche: 1000, points: 1 };
const TIERS = [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }];

test("gain : tranches entières du total TTC, arrondi à la tranche inférieure, jamais négatif", () => {
  assert.equal(pointsFor(23500, RULE), 23);
  assert.equal(pointsFor(999, RULE), 0);
  assert.equal(pointsFor(0, RULE), 0);
  assert.equal(pointsFor(-5000, RULE), 0);
  assert.equal(pointsFor(25000, { tranche: 5000, points: 3 }), 15);
});

test("paliers atteints et prochain palier, solde négatif compris", () => {
  assert.deepEqual(reachableTiers(90, TIERS), []);
  assert.deepEqual(reachableTiers(120, TIERS), [{ points: 100, montant: 5000 }]);
  assert.deepEqual(reachableTiers(250, [...TIERS].reverse()), TIERS, "rangés du plus petit au plus grand");
  assert.deepEqual(nextTier(70, TIERS), { points: 100, montant: 5000, missing: 30 });
  assert.deepEqual(nextTier(100, TIERS), { points: 250, montant: 15000, missing: 150 });
  assert.equal(nextTier(300, TIERS), null);
  assert.deepEqual(nextTier(-20, TIERS), { points: 100, montant: 5000, missing: 120 });
});

test("reprise par un avoir : prorata arrondi au point supérieur, jamais plus que ce qui reste ; tout le reste à l'annulation", () => {
  // 55 × 32 083 ÷ 55 000 = 32,08 : 33 points.
  assert.equal(reprisePoints(55, 0, 32083, 55000, false), 33);
  assert.equal(reprisePoints(55, 33, 22917, 55000, true), 22);
  assert.equal(reprisePoints(10, 9, 50000, 55000, false), 1, "plafonné à ce qui reste");
  assert.equal(reprisePoints(10, 12, 1000, 1000, true), 0, "jamais négatif");
  assert.equal(reprisePoints(0, 0, 1000, 1000, true), 0);
  assert.equal(reprisePoints(20, 0, 10000, 0, false), 0, "facture à 0 F : rien au prorata");
  assert.equal(reprisePoints(60, 0, 60000, 60000, false), 60, "montant exact : pas d'arrondi en trop");
});

test("paliers réglés : 1 à 5, points de 1 à 100 000 strictement croissants, remise de 100 à 10 000 000 F", () => {
  assert.equal(tiersProblem(DEFAULT_TIERS), null);
  assert.equal(tiersProblem([{ points: 100000, montant: 10000000 }]), null);
  assert.equal(tiersProblem([]), "reglage.paliers_nombre");
  assert.equal(tiersProblem("100"), "reglage.paliers_nombre");
  assert.equal(tiersProblem(Array.from({ length: 6 }, (_, i) => ({ points: (i + 1) * 10, montant: 1000 }))), "reglage.paliers_nombre");
  assert.equal(tiersProblem([{ points: 0, montant: 5000 }]), "reglage.paliers_points");
  assert.equal(tiersProblem([{ points: 1.5, montant: 5000 }]), "reglage.paliers_points");
  assert.equal(tiersProblem([{ points: 100, montant: 50 }]), "reglage.paliers_montant");
  assert.equal(tiersProblem([{ points: 100, montant: 5000 }, { points: 100, montant: 6000 }]), "reglage.paliers_ordre");
  assert.equal(tiersProblem([null]), "reglage.paliers_points");
});
