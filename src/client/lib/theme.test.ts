import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTheme, resolveTheme, THEME_PREFS } from "./theme.ts";

test("trois choix, dans l'ordre des réglages : clair, sombre, comme l'appareil", () => {
  assert.deepEqual([...THEME_PREFS], ["light", "dark", "system"]);
});

test("normalizeTheme : light ou dark gardés, « system » pour tout le reste", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  for (const other of [undefined, null, "", "system", "DARK", "sepia", 1, {}]) assert.equal(normalizeTheme(other), "system", String(other));
});

test("resolveTheme : le choix du compte l'emporte, « system » suit l'appareil", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
});
