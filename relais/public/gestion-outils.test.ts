import assert from "node:assert/strict";
import { test } from "node:test";
import { adressePage, codeIntegration, dateHeure, duree, etatLiaison, lireOrigines } from "./gestion-outils.ts";

test("origines saisies une par ligne : vides ignorées, doublons retirés, invalides signalées", () => {
  assert.deepEqual(lireOrigines(" https://www.eclat.cm \n\nhttps://www.eclat.cm\nwww.eclat.cm\nhttp://localhost:5173\n"), {
    origines: ["https://www.eclat.cm", "http://localhost:5173"], invalides: ["www.eclat.cm"],
  });
  assert.deepEqual(lireOrigines(""), { origines: [], invalides: [] });
});

test("état de la liaison : jamais, récente jusqu'à 5 minutes, silencieuse au-delà", () => {
  const T = 1_792_000_000_000;
  assert.deepEqual(etatLiaison(null, T), { cle: "liaison.jamais", duree: 0 });
  assert.deepEqual(etatLiaison(T - 2 * 60_000, T), { cle: "liaison.recente", duree: 2 });
  assert.deepEqual(etatLiaison(T - 5 * 60_000, T), { cle: "liaison.recente", duree: 5 });
  assert.deepEqual(etatLiaison(T - 6 * 60_000, T), { cle: "liaison.silencieuse", duree: 6 });
});

test("durée lisible : minutes, heures, jours", () => {
  assert.equal(duree(0, "fr"), "moins d'une minute");
  assert.equal(duree(3, "fr"), "3\u00a0min");
  assert.equal(duree(125, "fr"), "2\u00a0h");
  assert.equal(duree(3 * 24 * 60, "fr"), "3\u00a0j");
  assert.equal(duree(3 * 24 * 60, "en"), "3\u00a0d");
  assert.equal(duree(0, "en"), "less than a minute");
});

test("adresse de la page et code d'intégration du salon", () => {
  assert.equal(adressePage("https://reserver.exemple.com", "eclat"), "https://reserver.exemple.com/eclat/");
  assert.equal(codeIntegration("https://reserver.exemple.com", "eclat"), '<script src="https://reserver.exemple.com/integrer.js" data-salon="eclat" async></script>');
});

test("date et heure d'un instant, en français et en anglais", () => {
  const t = new Date(2026, 9, 17, 14, 32).getTime();
  assert.equal(dateHeure(t, "fr"), "17/10/2026 à 14:32");
  assert.equal(dateHeure(t, "en"), "10/17/2026 at 14:32");
});
