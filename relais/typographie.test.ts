import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** Garde-fous typographiques du relais (mêmes règles que src/server/typographie.test.ts). */
const RACINE = new URL(".", import.meta.url).pathname;

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "dist" || e.name === "node_modules") return [];
    const chemin = join(dossier, e.name);
    return e.isDirectory() ? fichiers(chemin) : [chemin];
  });
}

const code = () => fichiers(RACINE).filter((f) => /\.(ts|tsx|js)$/.test(f));

test("relais : aucune espace insécable brute dans le code, toujours écrite en échappement", () => {
  const fautes = code().flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((l, i) => (/\u00a0/.test(l) ? [`${f.slice(RACINE.length)}:${i + 1}`] : [])));
  assert.deepEqual(fautes, []);
});

test("relais : aucun tiret cadratin", () => {
  const textes = fichiers(RACINE).filter((f) => /\.(ts|tsx|js|css|html|md|sql|json|txt)$/.test(f));
  const fautes = textes.flatMap((f) => readFileSync(f, "utf8").split("\n").flatMap((l, i) => (/\u2014/.test(l) ? [`${f.slice(RACINE.length)}:${i + 1}`] : [])));
  assert.deepEqual(fautes, []);
});

test("relais : dans les chaînes, espace insécable avant « : ; ! ? » »", () => {
  const fautes: string[] = [];
  for (const f of code().filter((f) => !f.endsWith(".test.ts"))) {
    readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
      // Seul le texte des chaînes compte ; les expressions `${...}` des gabarits sont retirées avant.
      const textes = [...ligne.replace(/\$\{[^}]*\}/g, "").matchAll(/(["`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
      // Une chaîne SQL n'est pas du texte français : elle n'est pas examinée.
      if (textes.filter((t) => !/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/.test(t)).some((t) => /[\p{L})] [:;!?»]/u.test(t))) fautes.push(`${f.slice(RACINE.length)}:${i + 1}`);
    });
  }
  assert.deepEqual(fautes, []);
});
