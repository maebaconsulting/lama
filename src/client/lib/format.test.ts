import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountFontSize, EMPTY, formatInstant, formatInstantDate, formatInstantTime, formatLongDate, formatPrice, formatRange,
  formatShortDate, formatTimestamp, formatTimestampDate, hourLabel, modeSaisieMontant, parseAmount, parseSqliteTimestamp, readAmount, splitAmount, texteSaisie,
} from "./format.ts";
import { definirDevise } from "../../shared/devise-active.ts";

const NBSP = "\u00a0";
const THIN = "\u202f";

/** Exécute `fn` sous un autre fuseau de l'appareil, puis rétablit le précédent. */
function inZone(zone: string, fn: () => void) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { fn(); } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

// Décision produit du 30/09/2026 (§ 8) : le FCFA n'a pas de centimes, gagner de la
// place en écrivant seulement « F » à l'écran, dans les deux langues ; milliers séparés par
// l'espace fine insécable (comme le fait déjà Intl.NumberFormat("fr-FR")), même en anglais,
// pour qu'une virgule ne ressemble plus à des centimes.
test("montants en francs, entiers, au même format dans les deux langues", () => {
  assert.equal(formatPrice(15000, "fr"), `15${THIN}000${NBSP}F`);
  assert.equal(formatPrice(15000, "en"), `15${THIN}000${NBSP}F`);
  assert.equal(formatPrice(0, "fr"), `0${NBSP}F`);
  assert.equal(formatPrice(null, "en"), `0${NBSP}F`);
});

// Relecture finale, constat 1 bis (retour du contrôleur sur le constat 1) : `break-words`
// coupait « FCFA » au milieu (« FC »/« FA ») à 820 px. Un montant ne doit jamais se couper
// à l'intérieur du nombre ni de la devise ; seul l'espace entre les deux peut devenir un
// retour à la ligne. `splitAmount` isole les deux morceaux pour que le composant les
// enveloppe chacun dans un bloc insécable, séparé par une espace ordinaire cassable.
test("splitAmount sépare le nombre et « F », jamais ailleurs (constat 1 bis)", () => {
  assert.deepEqual(splitAmount(formatPrice(1350000, "fr")), { avant: "", nombre: `1${THIN}350${THIN}000`, apres: "F" });
  assert.deepEqual(splitAmount(formatPrice(1350000, "en")), { avant: "", nombre: `1${THIN}350${THIN}000`, apres: "F" });
  assert.deepEqual(splitAmount(formatPrice(0, "fr")), { avant: "", nombre: "0", apres: "F" });
  assert.equal(splitAmount("185 000"), null, "un texte qui n'est pas un montant formaté ne doit pas être coupé en deux");
  assert.equal(splitAmount(""), null);
});

// Retouche 2 (critique du 30/09/2026) : le chiffre clé rétrécit pour tenir sur une ligne dans sa
// tuile. Mesure de Jost 500 à chiffres tabulaires : « 133 000 F » = 4,57 em (0,51 em par signe),
// « 9 999 000 F » = 5,32 em (0,48 em par signe) ; 0,62 em par signe laisse une marge de 20 %.
test("amountFontSize : 1,5rem au plus, rétréci selon la largeur de la tuile (cqi), 1rem au moins", () => {
  assert.equal(amountFontSize(formatPrice(133000, "fr")), "clamp(1rem, calc(100cqi / 5.58), 1.5rem)");
  assert.equal(amountFontSize(formatPrice(9999000, "en")), "clamp(1rem, calc(100cqi / 6.82), 1.5rem)");
  assert.equal(amountFontSize(12), "clamp(1rem, calc(100cqi / 1.24), 1.5rem)", "un compteur garde sa taille pleine");
  // Tuile la plus étroite de l'accueil : 9rem (144 px) moins 2 × 16 px de marge, 112 px de texte.
  const px = Math.max(16, Math.min(24, 112 / 6.82));
  assert.ok(5.32 * px <= 112, "« 9 999 000 F » tient sur une ligne dans la tuile la plus étroite");
  // Téléphone de 390 px : environ 141 px de texte ; « 133 000 F » à 24 px (110 px) tient.
  assert.ok(4.57 * Math.min(24, 141 / 5.58) <= 141);
});

test("un montant hérité avec décimales est arrondi à l'affichage (spec § 10)", () => {
  assert.equal(formatPrice(1500.5, "fr"), `1${THIN}501${NBSP}F`);
  assert.equal(formatPrice(1500.4, "en"), `1${THIN}500${NBSP}F`);
});

test("saisie d'un prix : entier de francs, séparateurs tolérés, jamais NaN (Review Focus 4)", () => {
  assert.equal(parseAmount("15000"), 15000);
  assert.equal(parseAmount("15 000"), 15000);
  assert.equal(parseAmount(`15${NBSP}000`), 15000);
  assert.equal(parseAmount("15,000"), 15000);
  assert.equal(parseAmount("1500.5"), 1501);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount("abc"), 0);
  assert.equal(parseAmount("-20"), 0);
});

test("séparateur de milliers (point, virgule ou espace suivi de trois chiffres) vs décimale (relecture finale I1)", () => {
  assert.equal(parseAmount("15.000"), 15000, "point de milliers, écriture camerounaise");
  assert.equal(parseAmount("1.500.000"), 1500000, "plusieurs groupes de milliers");
  assert.equal(parseAmount("15,000"), 15000, "virgule de milliers");
  assert.equal(parseAmount(`15${THIN}000`), 15000, "espace fine de milliers");
  assert.equal(parseAmount("1500,5"), 1501, "virgule décimale, arrondie au franc entier");
  assert.equal(parseAmount("12.5"), 13, "point décimal, arrondi au franc entier");
});

test("saisie illisible : readAmount la signale (null) au lieu de 0 F, vide vaut 0 (décision 8, V1-12)", () => {
  for (const illegible of ["abc", "3 5OO francs", "douze mille", "-20", "F", "1e3", "0x10", "."]) {
    assert.equal(readAmount(illegible), null, illegible);
    assert.equal(parseAmount(illegible), 0, `parseAmount garde 0 pour « ${illegible} » (caisse)`);
  }
  assert.equal(readAmount(""), 0);
  assert.equal(readAmount("   "), 0);
  assert.equal(readAmount("0"), 0);
  assert.equal(readAmount("15.000"), 15000);
  assert.equal(readAmount(`15${THIN}000`), 15000);
  assert.equal(readAmount("3 500"), 3500);
  assert.equal(readAmount("1500,5"), 1501);
  assert.equal(readAmount(",5"), 1);
  assert.equal(readAmount("15 000 F"), 15000, "unité recopiée tolérée");
  assert.equal(readAmount("3 500 francs"), 3500);
  assert.equal(readAmount("8000FCFA"), 8000);
});

test("dates courtes et longues dans les deux langues", () => {
  assert.equal(formatShortDate("2026-09-27", "fr"), "27/09/2026");
  assert.equal(formatShortDate("2026-09-27", "en"), "27/09/2026");
  assert.equal(formatLongDate("2026-09-27", "fr"), "dimanche 27 septembre 2026");
  assert.equal(formatLongDate("2026-09-27", "en"), "Sunday, 27 September 2026");
});

test("une date de calendrier ne change pas de jour selon le fuseau de l'appareil", () => {
  for (const zone of ["Africa/Douala", "Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Santiago"]) {
    inZone(zone, () => {
      assert.equal(formatLongDate("2026-01-01", "fr"), "jeudi 1 janvier 2026", zone);
      assert.equal(formatShortDate("2026-01-01", "en"), "01/01/2026", zone);
    });
  }
});

test("heures sur 24 h, plages au demi-cadratin, cellule vide", () => {
  assert.equal(formatRange("14:30", "15:30"), "14:30–15:30");
  assert.equal(hourLabel(7), "07:00");
  assert.equal(hourLabel(18), "18:00");
  assert.equal(EMPTY, "–");
});

test("un horodatage SQLite est de l'UTC, affiché à l'heure de Douala quel que soit le fuseau de l'appareil", () => {
  assert.equal(parseSqliteTimestamp("2026-09-27 13:49:54"), Date.parse("2026-09-27T13:49:54Z"));
  assert.equal(parseSqliteTimestamp("2026-09-27T13:49:54Z"), Date.parse("2026-09-27T13:49:54Z"));
  for (const zone of ["Africa/Douala", "America/New_York", "Asia/Tokyo"]) {
    inZone(zone, () => {
      assert.equal(formatTimestamp("2026-09-27 13:49:54", "fr"), "27/09/2026 14:49", zone);
      assert.equal(formatTimestamp("2026-09-27 13:49:54", "en"), "27/09/2026 14:49", zone);
      assert.equal(formatTimestampDate("2026-09-27 23:30:00", "fr"), "28/09/2026", zone);
    });
  }
});

test("un instant en millisecondes s'affiche à l'heure de Douala", () => {
  const ms = Date.parse("2026-09-28T08:00:00Z");
  assert.equal(formatInstant(ms, "fr"), "28/09/2026 09:00");
  assert.equal(formatInstantDate(ms, "en"), "28/09/2026");
  assert.equal(formatInstantTime(ms, "en"), "09:00");
});

test("splitAmount : symbole après, avant, absent ; signe moins ASCII ou typographique", () => {
  assert.deepEqual(splitAmount(`15${THIN}000${NBSP}F`), { avant: "", nombre: `15${THIN}000`, apres: "F" });
  assert.deepEqual(splitAmount(`\u22129${THIN}750${NBSP}F`), { avant: "", nombre: `\u22129${THIN}750`, apres: "F" });
  definirDevise({ code: "USD", position: null, symboleEcran: true });
  try {
    assert.deepEqual(splitAmount(formatPrice(1550, "en")), { avant: "$", nombre: "15.50", apres: "" });
    assert.deepEqual(splitAmount(formatPrice(-1550, "en")), { avant: "-$", nombre: "15.50", apres: "" });
    assert.deepEqual(splitAmount(`\u2212${formatPrice(975, "en")}`), { avant: "\u2212$", nombre: "9.75", apres: "" });
    assert.equal(splitAmount("abc"), null);
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});

test("texteSaisie : texte prérempli relu à l'identique par parseAmount, sans séparateur de milliers ; clavier du champ", () => {
  assert.equal(texteSaisie(15000, "fr"), "15000");
  assert.equal(texteSaisie(15000.4, "en"), "15000");
  assert.equal(texteSaisie(0, "fr"), "0");
  assert.equal(modeSaisieMontant(), "numeric");
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    assert.equal(texteSaisie(1550, "fr"), "15,50");
    assert.equal(texteSaisie(150000, "en"), "1500.00");
    assert.equal(texteSaisie(5, "fr"), "0,05");
    for (const n of [0, 5, 1550, 150000, 123456789]) {
      for (const lang of ["fr", "en"] as const) assert.equal(parseAmount(texteSaisie(n, lang)), n, `${n} ${lang}`);
    }
    assert.equal(modeSaisieMontant(), "decimal");
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});
