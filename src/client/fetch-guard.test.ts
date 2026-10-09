import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL(".", import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("seul api.ts appelle fetch : l'en-tête X-Lama ne peut pas être oublié", () => {
  const offenders = files(ROOT).filter((f) => /\bfetch\(/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, ["api.ts"]);
});

test("aucun stockage navigateur sauf les préférences d'affichage de l'appareil : pas de secret qui survive à l'onglet", () => {
  const offenders = files(ROOT).filter((f) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, ["i18n/device-lang.ts"]);
  const text = readFileSync(join(ROOT, "i18n/device-lang.ts"), "utf8");
  assert.match(text, /DEVICE_LANG_KEY = "lama\.langue"/);
  assert.match(text, /DEVICE_THEME_KEY = "lama\.theme"/);
  assert.match(text, /DEVICE_RAIL_KEY = "lama\.rail"/);
  assert.match(text, /DEVICE_RELOAD_KEY = "lama\.rechargement"/);
  assert.match(text, /DEVICE_INSTALL_KEY = "lama\.installation"/);
  assert.deepEqual(text.match(/setItem\([^)]*\)/g), [
    "setItem(DEVICE_LANG_KEY, lang)",
    "setItem(DEVICE_THEME_KEY, pref)",
    'setItem(DEVICE_RAIL_KEY, expanded ? "ouvert" : "replie")',
    "setItem(DEVICE_RELOAD_KEY, `${at}`)",
    'setItem(DEVICE_INSTALL_KEY, "ferme")',
  ], "cinq setItem seulement : langue, thème, rail, rechargement d'un écran périmé, bandeau d'installation fermé");
});
