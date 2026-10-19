import assert from "node:assert/strict";
import { test } from "node:test";
import { apercuDevise, deviseEtat, prixConserve } from "./reglages-devise.ts";
import { configDevise } from "../../shared/devise-active.ts";

test("état de la rubrique : figée par une facture, position par défaut", () => {
  const settings = [
    { key: "institut.devise", secret: false, value: "XAF", set: true, editable: false, frozen: { numero: "FAC-2026-000001" } },
    { key: "affichage.symbole_position", secret: false, value: null, set: true },
    { key: "affichage.symbole_ecran", secret: false, value: true, set: true },
  ];
  assert.deepEqual(deviseEtat(settings as never), { code: "XAF", position: null, symboleEcran: true, modifiable: false, fige: "FAC-2026-000001" });
});

test("aperçu : sans toucher à la devise active", () => {
  const avant = configDevise();
  assert.deepEqual(apercuDevise({ code: "XAF", position: null, symboleEcran: true }, "fr"), { ecran: "15 000 F", document: "15 000 FCFA" });
  assert.deepEqual(apercuDevise({ code: "EUR", position: null, symboleEcran: true }, "fr"), { ecran: "15 000,50 €", document: "15 000,50 EUR" });
  assert.deepEqual(apercuDevise({ code: "USD", position: "apres", symboleEcran: false }, "en"), { ecran: "15 000.50", document: "15 000.50 USD" });
  assert.deepEqual(configDevise(), avant);
});

test("avertissement du changement : le prix de départ porte le symbole de la devise actuelle, sans toucher à la devise active", () => {
  const avant = configDevise();
  assert.deepEqual(
    prixConserve({ code: "XAF", position: null, symboleEcran: true }, { code: "EUR", position: null, symboleEcran: true }, "fr"),
    { depart: "15\u202f000\u00a0F", exemple: "15\u202f000,00\u00a0€" },
  );
  assert.deepEqual(
    prixConserve({ code: "EUR", position: null, symboleEcran: true }, { code: "XAF", position: null, symboleEcran: true }, "fr"),
    { depart: "15\u202f000,00\u00a0€", exemple: "15\u202f000\u00a0F" },
  );
  // Symbole masqué à l'écran : l'avertissement le montre quand même, sinon « 15 000 deviendra 15 000,00 » ne dit rien.
  assert.deepEqual(
    prixConserve({ code: "XAF", position: null, symboleEcran: false }, { code: "USD", position: null, symboleEcran: false }, "en"),
    { depart: "15\u202f000\u00a0F", exemple: "$\u00a015\u202f000.00" },
  );
  assert.deepEqual(configDevise(), avant);
});
