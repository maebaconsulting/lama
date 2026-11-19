import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const form = read("./create-appointment.tsx");

test("nouveau rendez-vous : un bouton crée la cliente sans quitter le formulaire", () => {
  assert.match(form, /onClick=\{\(\) => setCreatingClient\(true\)\}/);
  assert.match(form, /t\("cliente\.ajouter"\)/);
  assert.match(form, /<NouvelleCliente\b/, "même fenêtre que la caisse, pas une seconde");
  assert.match(read("./caisse/fenetres.tsx"), /export function NouvelleCliente\(/);
});

test("nouveau rendez-vous : la cliente créée est choisie, et revenir ne perd pas la saisie", () => {
  assert.match(form, /setClientId\(String\(id\)\)/);
  assert.match(form, /onBack=\{\(\) => setCreatingClient\(false\)\}/);
  assert.match(form, /onClose=\{\(\) => setCreatingClient\(false\)\}/);
});
