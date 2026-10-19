import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults, placeholders, titleCaseFaults } from "../../src/client/i18n/typography.ts";
import { t, TEXTES, type CleTexte } from "./textes.ts";

const cles = Object.keys(TEXTES) as CleTexte[];

test("textes de la page : chaque clé a son français et son anglais, mêmes variables", () => {
  for (const cle of cles) {
    assert.ok(TEXTES[cle].fr && TEXTES[cle].en, cle);
    assert.deepEqual(placeholders(TEXTES[cle].fr), placeholders(TEXTES[cle].en), cle);
  }
});

test("textes de la page : typographie française et anglaise, pas de « Title Case », jamais « booking »", () => {
  assert.deepEqual(cles.flatMap((c) => frenchFaults(TEXTES[c].fr).map((f) => `${c} : ${f}`)), []);
  assert.deepEqual(cles.flatMap((c) => englishFaults(TEXTES[c].en).map((f) => `${c} : ${f}`)), []);
  assert.deepEqual(cles.flatMap((c) => titleCaseFaults(TEXTES[c].fr).map((f) => `${c} : ${f}`)), []);
  assert.deepEqual(cles.filter((c) => /booking/i.test(TEXTES[c].en)), []);
});

test("t : variables remplacées, variable inconnue laissée telle quelle", () => {
  assert.equal(t("fr", "praticienne.seule", { prenom: "Awa" }), "Avec Awa");
  assert.equal(t("en", "commun.le", { date: "Tuesday, October 20", heure: "10:00" }), "Tuesday, October 20 at 10:00");
  assert.equal(t("fr", "praticienne.seule"), "Avec {prenom}");
});

test("textes de la page : jamais « réservation » ; la cliente demande un rendez-vous", () => {
  assert.deepEqual(cles.filter((c) => /réservation/i.test(TEXTES[c].fr)), []);
  assert.doesNotMatch(readFileSync(new URL("./index.html", import.meta.url), "utf8"), /réservation/i);
  assert.equal(t("fr", "refus.ferme"), "La prise de rendez-vous en ligne est momentanément indisponible.");
  assert.equal(t("en", "refus.ferme"), "Online appointments are temporarily unavailable.");
});
