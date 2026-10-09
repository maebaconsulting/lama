import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { copyResources, readResource, resourcePath, TICKET_RESOURCES } from "./ressources.ts";

/**
 * Ressources du ticket PDF (sous-projet 5 § 5.1) : polices de la charte, sans
 * logo depuis le renommage lama, lues à leur place dans le dépôt et copiées par la construction dans
 * `dist-server/ticket/` (le paquet livré n'a pas de `node_modules`).
 */

test("polices trouvées à leur place dans le dépôt, en WOFF ; plus de cygne ; logos de démonstration au signe de lama", () => {
  for (const name of Object.keys(TICKET_RESOURCES) as (keyof typeof TICKET_RESOURCES)[]) {
    const data = readResource(name);
    assert.ok(data.length > 1000, name);
    if (name.endsWith(".woff")) assert.equal(data.subarray(0, 4).toString("latin1"), "wOFF", `${name} : WOFF attendu`);
  }
  assert.equal(resourcePath("garamond-400.woff"), join(process.cwd(), "node_modules/@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff"));
  assert.deepEqual(Object.keys(TICKET_RESOURCES).filter((name) => !name.endsWith(".woff")), ["logo-demo-clair.png", "logo-demo-sombre.png"], "seuls logos : ceux de la démonstration");
  for (const name of ["logo-demo-clair.png", "logo-demo-sombre.png"] as const) {
    assert.equal(readResource(name).subarray(1, 4).toString("latin1"), "PNG", name);
    assert.match(TICKET_RESOURCES[name], /^src\/server\/demo\//, "jamais docs/brand");
  }
});

test("copie des ressources pour le serveur assemblé : un fichier par ressource, identique à l'original", (t) => {
  const dest = mkdtempSync(join(tmpdir(), "lama-ticket-"));
  t.after(() => rmSync(dest, { recursive: true, force: true }));
  const names = copyResources(join(dest, "ticket"));
  assert.deepEqual(names.sort(), ["garamond-400.woff", "garamond-600.woff", "jost-400.woff", "jost-500.woff", "logo-demo-clair.png", "logo-demo-sombre.png"]);
  for (const name of names) {
    assert.deepEqual(readFileSync(join(dest, "ticket", name)), readResource(name as keyof typeof TICKET_RESOURCES), name);
  }
});

test("la construction copie les ressources et garde `require` pour pdfkit", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> };
  assert.equal(pkg.dependencies.pdfkit, "0.20.2", "version exacte, la même sur le poste et sur le mini-PC");
  assert.ok(pkg.devDependencies["@types/pdfkit"]);
  assert.match(pkg.scripts["build:server"], /src\/server\/caisse\/copier-ressources\.ts dist-server\/ticket/);
  // pdfkit importe lui-même `createRequire` : la bannière le renomme pour ne pas le déclarer deux fois.
  assert.match(pkg.scripts["build:server"], /import \{ createRequire as lamaCreateRequire \} from 'node:module'; const require = lamaCreateRequire\(import\.meta\.url\);/);
});
