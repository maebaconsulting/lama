import assert from "node:assert/strict";
import { test } from "node:test";
import { dernierEcart, ecartHeure, ecartTexte, ecartVisible, avertissementsReglage, heureSaisie, noterDate, SEUIL_ECART_MS, voitHeure } from "./heure.ts";

/** Heure du serveur vue de l'écran (distribution D-11, D-12) : fonctions pures. */

const APPAREIL = Date.parse("2026-10-05T13:00:00Z");

test("écart lu sur l'en-tête Date : positif si le serveur avance, null si illisible", () => {
  assert.equal(ecartHeure("Mon, 05 Oct 2026 13:14:00 GMT", APPAREIL), 14 * 60_000);
  assert.equal(ecartHeure("Mon, 05 Oct 2026 12:58:30 GMT", APPAREIL), -90_000);
  assert.equal(ecartHeure(null, APPAREIL), null);
  assert.equal(ecartHeure("pas une date", APPAREIL), null);
});

test("bandeau au-delà de 2 minutes, dans les deux sens ; administrateur et gérante seulement", () => {
  assert.equal(SEUIL_ECART_MS, 120_000);
  assert.equal(ecartVisible(null), false);
  assert.equal(ecartVisible(120_000), false, "2 minutes pile : pas de bandeau");
  assert.equal(ecartVisible(121_000), true);
  assert.equal(ecartVisible(-121_000), true);
  assert.deepEqual((["admin", "manager", "reception", "practitioner"] as const).map(voitHeure), [true, true, false, false]);
});

test("texte de l'écart : minutes, heures, jours, dans les deux langues", () => {
  assert.equal(ecartTexte(14 * 60_000, "fr"), "14\u00a0min");
  assert.equal(ecartTexte(-14 * 60_000, "en"), "14 min");
  assert.equal(ecartTexte(119 * 60_000, "fr"), "119\u00a0min");
  assert.equal(ecartTexte(5 * 3_600_000, "fr"), "5\u00a0h");
  assert.equal(ecartTexte(86_400_000 * 1.2, "fr"), "29\u00a0h");
  assert.equal(ecartTexte(86_400_000 * 3, "fr"), "3\u00a0jours");
  assert.equal(ecartTexte(86_400_000 * 400, "en"), "400 days");
});

test("heure saisie : date et heure de Douala en millisecondes, refus lisibles", () => {
  assert.deepEqual(heureSaisie("2026-10-05", "14:32"), { value: Date.parse("2026-10-05T13:32:00Z") });
  assert.deepEqual(heureSaisie("2026-10-05", "9h05"), { value: Date.parse("2026-10-05T08:05:00Z") });
  assert.deepEqual(heureSaisie("2026-01-01", "01:30"), { value: Date.parse("2026-01-01T00:30:00Z") }, "une heure de moins en UTC");
  assert.deepEqual(heureSaisie("", "14:32"), { error: "saisie.date_heure_manquantes" });
  assert.deepEqual(heureSaisie("2026-10-05", "25:00"), { error: "saisie.date_heure_manquantes" });
  assert.deepEqual(heureSaisie("2025-12-31", "23:00"), { error: "heure.hors_plage" });
  assert.deepEqual(heureSaisie("2100-01-01", "12:00"), { error: "heure.hors_plage" });
});

test("dernier écart noté à chaque réponse ; une réponse sans Date ne l'efface pas", () => {
  noterDate("Mon, 05 Oct 2026 13:14:00 GMT", APPAREIL);
  assert.equal(dernierEcart(), 14 * 60_000);
  noterDate(null, APPAREIL);
  assert.equal(dernierEcart(), 14 * 60_000);
  noterDate("Mon, 05 Oct 2026 13:00:00 GMT", APPAREIL);
  assert.equal(dernierEcart(), 0);
});

test("avertissements après réglage : synchronisation non réactivée, caisse encore bloquée", () => {
  assert.deepEqual(avertissementsReglage({ derniere_facture: null, caisse_bloquee: false }), []);
  assert.deepEqual(avertissementsReglage({ synchro: true, derniere_facture: 5, caisse_bloquee: false }), []);
  assert.deepEqual(avertissementsReglage({ synchro: false, derniere_facture: 5, caisse_bloquee: false }), [{ key: "heure.synchro_non_retablie" }]);
  assert.deepEqual(avertissementsReglage({ derniere_facture: 99, caisse_bloquee: true }), [{ key: "heure.caisse_reste_bloquee", derniere: 99 }]);
  assert.deepEqual(avertissementsReglage({ synchro: false, derniere_facture: 99, caisse_bloquee: true }).map((a) => a.key), ["heure.synchro_non_retablie", "heure.caisse_reste_bloquee"]);
});
