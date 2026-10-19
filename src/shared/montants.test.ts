import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { configDevise, definirDevise, deviseActive } from "./devise-active.ts";
import { entierMineur, formatEntier, formatMontantDocument, formatMontantEcran, formatNombre, lireMontant } from "./montants.ts";

const N = "\u00a0";
const T = "\u202f";
afterEach(() => definirDevise({ code: "XAF", position: null, symboleEcran: true }));

test("XAF par défaut : formats d'avant le chantier", () => {
  assert.deepEqual(configDevise(), { code: "XAF", position: null, symboleEcran: true });
  assert.equal(formatNombre(15000, "fr"), `15${T}000`);
  assert.equal(formatNombre(15000, "en"), `15${T}000`);
  assert.equal(formatMontantEcran(15000, "en"), `15${T}000${N}F`);
  assert.equal(formatMontantDocument(13000, "fr"), `13${T}000${N}FCFA`);
  assert.equal(formatMontantEcran(-500, "fr"), `-500${N}F`);
  assert.equal(formatNombre(1234.6, "fr"), `1${T}235`);
});

test("euro : deux décimales, virgule ou point selon la langue", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  assert.equal(formatNombre(1500050, "fr"), `15${T}000,50`);
  assert.equal(formatNombre(1500050, "en"), `15${T}000.50`);
  assert.equal(formatMontantEcran(1500, "fr"), `15,00${N}€`);
  assert.equal(formatMontantDocument(1500050, "fr"), `15${T}000,50${N}EUR`);
  assert.equal(formatMontantDocument(150000000, "fr"), `1${T}500${T}000,00${N}EUR`);
});

test("symbole avant, négatif : le signe précède le symbole", () => {
  definirDevise({ code: "USD", position: null, symboleEcran: true });
  assert.equal(deviseActive().position, "avant");
  assert.equal(formatMontantEcran(1550, "en"), `$${N}15.50`);
  assert.equal(formatMontantEcran(-1550, "en"), `-$${N}15.50`);
  assert.equal(formatMontantDocument(1550, "en"), `USD${N}15.50`);
});

test("position réglée et symbole masqué à l'écran seulement", () => {
  definirDevise({ code: "XAF", position: "avant", symboleEcran: false });
  assert.equal(formatMontantEcran(15000, "fr"), `15${T}000`);
  assert.equal(formatMontantDocument(15000, "fr"), `FCFA${N}15${T}000`);
});

test("formatEntier ne prend jamais de décimales ; entierMineur", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  assert.equal(formatEntier(1200), `1${T}200`);
  assert.equal(entierMineur(1550.4), 1550);
  assert.equal(entierMineur(-3), 0);
  assert.equal(entierMineur(null), 0);
});

test("code inconnu : retour au XAF", () => {
  definirDevise({ code: "ZZZ" as never, position: null, symboleEcran: true });
  assert.equal(deviseActive().code, "XAF");
});

test("lireMontant en XAF : règles d'avant le chantier", () => {
  for (const [t, v] of [["15000", 15000], ["15 000", 15000], ["15.000", 15000], ["15,000", 15000], ["1.500.000", 1500000], ["15 000 F", 15000], ["15000 FCFA", 15000], ["3 500 francs", 3500], ["1,5", 2], ["", 0]] as const) {
    assert.equal(lireMontant(t), v, t);
  }
  for (const t of ["abc", "-20", "douze mille", "1e3"]) assert.equal(lireMontant(t), null, t);
});

test("lireMontant en euros : centimes, milliers, refus de trois décimales", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  for (const [t, v] of [["15", 1500], ["15,5", 1550], ["15.50", 1550], ["1.500", 150000], ["1 500,25", 150025], ["€ 15", 1500], ["15 EUR", 1500], ["15€", 1500], [",5", 50]] as const) {
    assert.equal(lireMontant(t), v, t);
  }
  for (const t of ["1,5555", "1.5.5", "15 F"]) assert.equal(lireMontant(t), null, t);
});

test("lireMontant en dollars : symbole avant", () => {
  definirDevise({ code: "USD", position: null, symboleEcran: true });
  assert.equal(lireMontant("$15.50"), 1550);
  assert.equal(lireMontant("USD 15"), 1500);
});
