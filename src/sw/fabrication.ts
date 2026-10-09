/**
 * Fabrication du service worker (PWA, P-03), appelée par Vite à la fin de
 * `vite build` (greffon de `vite.config.ts`) : lit le manifeste de fabrication
 * de Vite, calcule la liste de l'enveloppe et l'empreinte de la version,
 * assemble `src/sw/sw.ts` dans `dist/sw.js` avec esbuild, puis retire
 * `dist/.vite` (inutile au service, et à ne pas publier).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { fichiersEnveloppe, nomCache, type EntreeVite } from "./regles.ts";

const SOURCE = fileURLToPath(new URL("./sw.ts", import.meta.url));

/** Écrit `<dist>/sw.js` et rend le nom du cache et la liste de l'enveloppe. */
export async function fabriquerServiceWorker(dist: string, version: string): Promise<{ cache: string; fichiers: string[] }> {
  const manifeste = JSON.parse(readFileSync(join(dist, ".vite", "manifest.json"), "utf8")) as Record<string, EntreeVite>;
  const icones = existsSync(join(dist, "icones")) ? readdirSync(join(dist, "icones")).filter((nom) => nom.endsWith(".png")).map((nom) => `/icones/${nom}`) : [];
  const fichiers = fichiersEnveloppe(manifeste, icones);
  // Empreinte du contenu de chaque fichier : index.html et les icônes changent sans changer de nom.
  const empreinte = createHash("sha256");
  for (const fichier of fichiers) {
    empreinte.update(`${fichier}\n`);
    empreinte.update(readFileSync(join(dist, fichier.slice(1))));
  }
  const cache = nomCache(version, empreinte.digest("hex").slice(0, 12));
  await build({
    entryPoints: [SOURCE],
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: true,
    outfile: join(dist, "sw.js"),
    define: { __LAMA_ENVELOPPE__: JSON.stringify({ cache, fichiers }) },
    logLevel: "silent",
  });
  rmSync(join(dist, ".vite"), { recursive: true, force: true });
  return { cache, fichiers };
}
