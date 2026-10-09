import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = new URL(".", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "test-support.ts" ? [path] : [];
  });
}

test("messages console et erreurs du serveur : espace insécable avant « : ; ! ? »", () => {
  const faults: string[] = [];
  for (const file of sources(ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (!/console\.(log|error|warn)|new [A-Za-z]*Error\(/.test(line)) return;
      // Seul le texte des chaînes compte (pas les opérateurs `? :` ni `!==`) ;
      // les expressions `${...}` des gabarits sont retirées avant l'extraction.
      const texts = [...line.replace(/\$\{[^}]*\}/g, "").matchAll(/(["`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
      // Une lettre ou une parenthèse, une espace ordinaire (U+0020), puis la ponctuation haute.
      if (texts.some((text) => /[\p{L})] [:;!?]/u.test(text))) faults.push(`${file.slice(ROOT.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(faults, []);
});

/** Tous les fichiers .ts de src/server, essais compris. */
function allSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return allSources(path);
    return e.name.endsWith(".ts") ? [path] : [];
  });
}

test("aucune espace insécable brute (U+00A0) dans src/server : toujours écrite \\u00a0 (V1-76)", () => {
  const faults: string[] = [];
  for (const file of allSources(ROOT)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/\u00a0/.test(line)) faults.push(`${file.slice(ROOT.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(faults, []);
});
