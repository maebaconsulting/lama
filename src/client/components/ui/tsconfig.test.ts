import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** V1-71 : tsc lit les composants `ui` (écrits pour React) avec les types de preact/compat, comme Vite les assemble. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("tsconfig : react et react-dom mènent à preact/compat, comme l'alias de vite.config.ts", () => {
  const paths = JSON.parse(read("../../../../tsconfig.json")).compilerOptions.paths as Record<string, string[]>;
  assert.deepEqual(paths.react, ["./node_modules/preact/compat"]);
  assert.deepEqual(paths["react-dom"], ["./node_modules/preact/compat"]);
  assert.deepEqual(paths["@/*"], ["./src/client/*"]);
});

test("ui : Button et DialogContent typés sans contournement de tsc", () => {
  assert.match(read("./button.tsx"), /const Comp = \(asChild \? Slot : "button"\) as "button"/);
  const dialog = read("./dialog.tsx");
  assert.match(dialog, /const isOf = \(child: React\.ReactNode, type: unknown\) =>/);
  assert.doesNotMatch(dialog, /@ts-(ignore|expect-error)|@ts-nocheck/);
});
