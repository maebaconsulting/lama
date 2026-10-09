import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fiche = readFileSync(new URL("./appointment-detail.tsx", import.meta.url), "utf8");

test("note de rendez-vous (V1-13) : « Ajouter » désactivé tant que le champ est vide", () => {
  assert.match(fiche, /<Button type="submit" variant="outline" size="icon" disabled=\{sending \|\| !noteText\.trim\(\)\} aria-label=\{t\("rdv\.envoyer_note"\)\}>/);
});
