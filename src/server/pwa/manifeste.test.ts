import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PNG } from "pngjs";
import { bundleOf } from "../test-support.ts";
import { COULEUR_CUIR, ICONES, lireManifeste, manifesteWeb } from "./manifeste.ts";

/** Application installable (PWA, P-01, P-02) : manifeste servi par le serveur, icônes de l'écran d'accueil. */
const racine = (chemin: string) => new URL(`../../../${chemin}`, import.meta.url);

test("manifeste : « lama, {nom de l'institut} », plein écran, couleurs de la charte, langue de l'institut", () => {
  assert.deepEqual(manifesteWeb({ nom: "Institut Belle Peau", langue: "fr" }), {
    id: "/",
    name: "lama, Institut Belle Peau",
    short_name: "lama",
    description: "lama, gestion des instituts de beauté",
    lang: "fr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#161514",
    theme_color: "#161514",
    icons: [
      { src: "/icones/lama-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icones/lama-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icones/lama-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  });
});

test("manifeste : nom vide ou fait d'espaces, « lama » seul ; anglais si l'institut est en anglais, français pour toute autre valeur", () => {
  assert.equal(manifesteWeb({ nom: "", langue: "fr" }).name, "lama");
  assert.equal(manifesteWeb({ nom: "   ", langue: "fr" }).name, "lama");
  assert.equal(manifesteWeb({ nom: "  Chez Awa ", langue: "fr" }).name, "lama, Chez Awa");
  const en = manifesteWeb({ nom: "Awa", langue: "en" });
  assert.deepEqual([en.lang, en.description], ["en", "lama, beauty institute management"]);
  assert.equal(manifesteWeb({ nom: "Awa", langue: "de" }).lang, "fr");
});

test("manifeste : réglages illisibles, manifeste neutre plutôt qu'une erreur", async () => {
  const lu = await lireManifeste(async () => { throw new Error("base fermée"); });
  assert.deepEqual([lu.name, lu.lang], ["lama", "fr"]);
  const reglages: Record<string, unknown> = { "institut.nom": "Awa", "institut.langue": "en" };
  const ok = await lireManifeste(async (cle) => reglages[cle]);
  assert.deepEqual([ok.name, ok.lang], ["lama, Awa", "en"]);
});

test("icônes : PNG aux tailles annoncées, l'icône iPhone de 180 px gardée", () => {
  for (const icone of [...ICONES, { src: "/apple-touch-icon.png", sizes: "180x180" }]) {
    const fichier = icone.src === "/apple-touch-icon.png" ? racine("apple-touch-icon.png") : racine(`public${icone.src}`);
    const png = PNG.sync.read(readFileSync(fichier));
    assert.equal(`${png.width}x${png.height}`, icone.sizes, icone.src);
  }
});

test("icône masquable : fond cuir plein jusqu'aux bords, signe tout entier dans la zone sûre (cercle de 80 %)", () => {
  const png = PNG.sync.read(readFileSync(racine("public/icones/lama-masquable-512.png")));
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(COULEUR_CUIR.slice(i, i + 2), 16));
  const centre = png.width / 2;
  const rayon = 0.4 * png.width;
  let signe = 0;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const fond = Math.abs(png.data[i] - r) <= 2 && Math.abs(png.data[i + 1] - g) <= 2 && Math.abs(png.data[i + 2] - b) <= 2 && png.data[i + 3] === 255;
      const dehors = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) > rayon;
      if (dehors) assert.ok(fond, `pixel (${x}, ${y}) hors de la zone sûre : fond cuir attendu`);
      else if (!fond) signe++;
    }
  }
  assert.ok(signe > 1000, "le signe de lama est dessiné dans la zone sûre");
});

test("index.html : manifeste servi, icône iPhone et couleur de la barre d'état de la charte", () => {
  const html = readFileSync(racine("index.html"), "utf8");
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  assert.match(html, new RegExp(`<meta name="theme-color" content="${COULEUR_CUIR}">`));
});

test("serveur : /manifest.webmanifest public, sans session ni installation, nom relu à chaque demande", async () => {
  const { start } = await import(await bundleOf("./boot.ts"));
  const dir = mkdtempSync(join(tmpdir(), "lama-manifeste-"));
  const { server, port, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb") });
  try {
    const avant = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
    assert.equal(avant.status, 200, "aucun compte, aucune session : servi quand même");
    assert.equal(avant.headers.get("content-type"), "application/manifest+json; charset=utf-8");
    assert.equal(avant.headers.get("cache-control"), "no-cache");
    assert.equal(((await avant.json()) as { name: string }).name, "lama");
    db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', ?, 0, 0)").run(JSON.stringify("Institut Belle Peau"));
    const apres = (await (await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`)).json()) as { name: string; icons: unknown[] };
    assert.equal(apres.name, "lama, Institut Belle Peau");
    assert.equal(apres.icons.length, 3);
  } finally {
    stopWorker();
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
