import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";
import { contexteCharge } from "./essais/charge.ts";
import { MAINTENANT } from "./essais/donnees.ts";
import { relaisEssai } from "./essais/relais.ts";
import { Depot } from "./stockage/depot.ts";

/**
 * Forfait gratuit de Cloudflare (relais/LISEZMOI.md, «\u00a0Budget du forfait gratuit\u00a0»)\u00a0: 10 ms de calcul par requête,
 * Worker de 3 Mo compressé au plus. Ces essais gardent une marge large ; ils ne mesurent pas Cloudflare lui-même.
 */
test("Worker : construit pour Cloudflare sans aucun module Node ni code de lama, moins de 1 Mo", async () => {
  const r = await build({
    entryPoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "esm", conditions: ["worker", "browser"], minify: true, metafile: true, logLevel: "silent",
  });
  const entrees = Object.keys(r.metafile.inputs);
  assert.ok(entrees.some((e) => e.endsWith("relais/worker.ts")), "le Worker est bien construit");
  assert.deepEqual(entrees.filter((e) => e.startsWith("node:") || /(^|\/)src\//.test(e)), []);
  assert.ok(r.outputFiles[0].contents.length < 1_000_000, `${r.outputFiles[0].contents.length} octets`);
});

test("GET /jours d'un salon chargé (8 praticiennes, 30 jours)\u00a0: médiane sous 5 ms, base comprise", async () => {
  const c = contexteCharge();
  const r = await relaisEssai({ etat: "actif" });
  const depot = new Depot(r.base, "eclat");
  await depot.ecrireDocument("offre", 1, c.offre, MAINTENANT);
  await depot.ecrireDocument("disponibilites", 1, c.dispo, MAINTENANT);
  const durees: number[] = [];
  for (let i = 0; i < 60; i++) {
    const debut = performance.now();
    const res = await r.app.request("/api/eclat/jours?prestation=s60");
    const corps = (await res.json()) as { jours: string[] };
    if (i >= 10) durees.push(performance.now() - debut);
    assert.equal(corps.jours.length, 30);
  }
  durees.sort((a, b) => a - b);
  const mediane = durees[Math.floor(durees.length / 2)];
  assert.ok(mediane < 5, `médiane ${mediane.toFixed(2)} ms`);
});
