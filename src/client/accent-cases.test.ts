import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Cases à cocher et boutons radio aux couleurs de lama, jamais au bleu du navigateur (iPad, 22/10/2026). */
test("cases et boutons radio : couleur de la charte (accent-color sur --primary)", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  assert.match(css, /input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{[^}]*accent-color:\s*var\(--primary\)/);
});
