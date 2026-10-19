import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults, placeholders, titleCaseFaults } from "../../src/client/i18n/typography.ts";
import { TEXTES_GESTION, tg, type CleGestion } from "./gestion-textes.ts";

const cles = Object.keys(TEXTES_GESTION) as CleGestion[];

test("textes de la gestion : français et anglais, mêmes variables, typographie, jamais « booking »", () => {
  for (const cle of cles) {
    assert.ok(TEXTES_GESTION[cle].fr && TEXTES_GESTION[cle].en, cle);
    assert.deepEqual(placeholders(TEXTES_GESTION[cle].fr), placeholders(TEXTES_GESTION[cle].en), cle);
  }
  assert.deepEqual(cles.flatMap((c) => frenchFaults(TEXTES_GESTION[c].fr).map((f) => `${c} : ${f}`)), []);
  assert.deepEqual(cles.flatMap((c) => englishFaults(TEXTES_GESTION[c].en).map((f) => `${c} : ${f}`)), []);
  assert.deepEqual(cles.flatMap((c) => titleCaseFaults(TEXTES_GESTION[c].fr).map((f) => `${c} : ${f}`)), []);
  assert.deepEqual(cles.filter((c) => /booking/i.test(TEXTES_GESTION[c].en)), []);
});

test("tg : variables remplacées", () => {
  assert.equal(tg("fr", "cle.titre", { salon: "eclat" }), "Clé partagée de eclat");
});

test("textes de la gestion : jamais « réservation »", () => {
  assert.deepEqual(cles.filter((c) => /réservation/i.test(TEXTES_GESTION[c].fr)), []);
  assert.doesNotMatch(readFileSync(new URL("./gestion.html", import.meta.url), "utf8"), /réservation/i);
});
