import assert from "node:assert/strict";
import { test } from "node:test";
import { STATUSES, statusLabel } from "./statuses.ts";

test("libellés des statuts dans les deux langues, valeur inconnue rendue telle quelle", () => {
  assert.deepEqual(STATUSES.map((s) => statusLabel("fr", s)), ["Réservé", "Confirmé", "En cours", "Terminé", "Annulé", "Absente"]);
  assert.deepEqual(STATUSES.map((s) => statusLabel("en", s)), ["Booked", "Confirmed", "In progress", "Completed", "Cancelled", "No-show"]);
  assert.equal(statusLabel("en", "archived"), "archived");
});
