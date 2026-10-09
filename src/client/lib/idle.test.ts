import assert from "node:assert/strict";
import { test } from "node:test";
import { msUntilLock } from "./idle.ts";

test("délai restant avant verrouillage, jamais négatif", () => {
  const five = 5 * 60_000;
  assert.equal(msUntilLock(1_000, 1_000, five), five);
  assert.equal(msUntilLock(1_000, 1_000 + five - 1, five), 1);
  assert.equal(msUntilLock(1_000, 1_000 + five, five), 0);
  assert.equal(msUntilLock(1_000, 1_000 + 2 * five, five), 0);
});
