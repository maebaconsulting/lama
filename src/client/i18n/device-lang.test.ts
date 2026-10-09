import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEVICE_LANG_KEY, DEVICE_RAIL_KEY, DEVICE_THEME_KEY, readDeviceLang, readDeviceTheme, readRailExpanded,
  writeDeviceLang, writeDeviceTheme, writeRailExpanded, type DeviceStore,
} from "./device-lang.ts";

function memory(initial: Record<string, string> = {}): DeviceStore & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

const broken: DeviceStore = {
  getItem() { throw new Error("stockage bloqué"); },
  setItem() { throw new Error("stockage bloqué"); },
};

test("langue retenue par l'appareil, le français sinon", () => {
  assert.equal(readDeviceLang(memory({ [DEVICE_LANG_KEY]: "en" })), "en");
  assert.equal(readDeviceLang(memory({ [DEVICE_LANG_KEY]: "fr" })), "fr");
  assert.equal(readDeviceLang(memory()), "fr");
  assert.equal(readDeviceLang(memory({ [DEVICE_LANG_KEY]: "de" })), "fr", "valeur inconnue");
});

test("stockage indisponible (navigation privée, stockage bloqué) : français, aucune erreur (spec § 10)", () => {
  assert.equal(readDeviceLang(null), "fr");
  assert.equal(readDeviceLang(broken), "fr");
  assert.doesNotThrow(() => writeDeviceLang("en", broken));
  assert.doesNotThrow(() => writeDeviceLang("en", null));
});

test("écrit seulement la langue, sous sa clé", () => {
  const store = memory();
  writeDeviceLang("en", store);
  assert.deepEqual(store.data, { [DEVICE_LANG_KEY]: "en" });
});

test("thème retenu par l'appareil, « comme l'appareil » sinon (sous-projet 4 § 3.2)", () => {
  assert.equal(readDeviceTheme(memory({ [DEVICE_THEME_KEY]: "dark" })), "dark");
  assert.equal(readDeviceTheme(memory({ [DEVICE_THEME_KEY]: "light" })), "light");
  assert.equal(readDeviceTheme(memory()), "system");
  assert.equal(readDeviceTheme(memory({ [DEVICE_THEME_KEY]: "sepia" })), "system", "valeur inconnue");
  assert.equal(readDeviceTheme(null), "system");
  assert.equal(readDeviceTheme(broken), "system");
  assert.doesNotThrow(() => writeDeviceTheme("dark", broken));
});

test("le thème s'écrit sous sa propre clé, sans toucher à la langue", () => {
  const store = memory({ [DEVICE_LANG_KEY]: "en" });
  writeDeviceTheme("system", store);
  assert.deepEqual(store.data, { [DEVICE_LANG_KEY]: "en", [DEVICE_THEME_KEY]: "system" });
});

test("rail : replié par défaut, déployé seulement s'il a été retenu ainsi (sous-projet 4 § 3.3)", () => {
  assert.equal(readRailExpanded(memory()), false);
  assert.equal(readRailExpanded(broken), false);
  const store = memory();
  writeRailExpanded(true, store);
  assert.equal(store.data[DEVICE_RAIL_KEY], "ouvert");
  assert.equal(readRailExpanded(store), true);
  writeRailExpanded(false, store);
  assert.equal(readRailExpanded(store), false);
  assert.doesNotThrow(() => writeRailExpanded(true, broken));
});
