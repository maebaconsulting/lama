import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Garde-fou B1 / D11 (audit-responsive.md) : la rangée des 8 pastilles de
 * couleur doit passer à la ligne au lieu de déborder de la fenêtre membre
 * (`create-staff.tsx`) et de la fenêtre prestation (`create-service.tsx`).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("B1 / D11 : le sélecteur de couleurs passe à la ligne au lieu de déborder", () => {
  const text = read("./ink-picker.tsx");
  const row = text.match(/<div className="([^"]*)">\s*\{STAFF_INKS\.map/);
  assert.ok(row, "rangée des encres introuvable");
  assert.match(row![1], /\bflex-wrap\b/, "les 8 pastilles doivent passer à la ligne");
});
