import assert from "node:assert/strict";
import { test } from "node:test";
import { afterFailure, lockDuration } from "./lockout.ts";

const MIN = 60_000;

test("la durée de blocage double à chaque série, plafonnée à 24 h", () => {
  assert.equal(lockDuration(1), 5 * MIN);
  assert.equal(lockDuration(2), 10 * MIN);
  assert.equal(lockDuration(3), 20 * MIN);
  assert.equal(lockDuration(20), 24 * 60 * MIN);
});

test("le cinquième échec bloque et remet le compteur à zéro", () => {
  let state = { failed_attempts: 0, lock_series: 0 };
  for (let i = 1; i <= 4; i++) {
    const next = afterFailure(state, 1000);
    assert.equal(next.locked_until, null);
    state = next;
  }
  const locked = afterFailure(state, 1000);
  assert.deepEqual(locked, { failed_attempts: 0, lock_series: 1, locked_until: 1000 + 5 * MIN });
});
