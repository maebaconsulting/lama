import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults } from "../client/i18n/typography.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** Lignes de prose d'un document Markdown (hors blocs de code et code en ligne). */
function prose(doc: string): string[] {
  let inCode = false;
  return doc.split("\n").filter((line) => {
    if (line.startsWith("```")) { inCode = !inCode; return false; }
    return !inCode;
  }).map((line) => line.replace(/`[^`]*`/g, "code"));
}

test("README (anglais) et LISEZMOI (français) au nom de lama, sans institut client nommé, liés l'un à l'autre (spec § 8.2, distribution D-03)", () => {
  const readme = read("README.md");
  const lisezmoi = read("LISEZMOI.md");
  assert.match(readme, /^# lama$/m);
  assert.match(lisezmoi, /^# lama$/m);
  assert.doesNotMatch(readme, /first client/);
  assert.doesNotMatch(lisezmoi, /premier client/);
  assert.match(readme, /\(LISEZMOI\.md\)/);
  assert.match(lisezmoi, /\(README\.md\)/);
  for (const doc of [readme, lisezmoi]) {
    for (const path of ["/agenda", "/calendar", "/rendez-vous", "/appointments", "/reglages", "/settings"]) assert.ok(doc.includes(`\`${path}\``), path);
    assert.doesNotMatch(doc, /\u2014/);
    assert.doesNotMatch(doc, /localhost:5174|salonist|fresha/i, "plus de texte d'OpenSalon");
  }
  assert.deepEqual(prose(lisezmoi).flatMap((l) => frenchFaults(l)), []);
  assert.deepEqual(prose(readme).flatMap((l) => englishFaults(l)), []);
});

test("agent.md : lama, adresses dans les deux langues, champs _en, Accept-Language, FCFA", () => {
  const agent = read("agent.md");
  assert.match(agent, /^# lama operating guide$/m);
  for (const needle of ["/agenda", "/calendar", "name_en", "description_en", "category_en", "title_en", "Accept-Language", "allow_conflict: true", "FCFA", "PUT /api/auth/me/language", "PUT /api/auth/me/theme"]) {
    assert.ok(agent.includes(needle), needle);
  }
  assert.doesNotMatch(agent, /OpenSalon/);
});

test("manifeste servi par le serveur (PWA, P-01) à la place de manifest.json ; clawnify.json neutre (distribution D-03)", () => {
  assert.ok(!existsSync(new URL("manifest.json", ROOT)), "manifest.json retiré : /manifest.webmanifest le remplace");
  assert.match(read("index.html"), /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(read("index.html"), /<meta name="theme-color" content="#161514">/, "même couleur que le manifeste (COULEUR_CUIR)");
  const clawnify = JSON.parse(read("clawnify.json")) as { name: string; deploy: { title: string } };
  assert.deepEqual([clawnify.name, clawnify.deploy.title], ["lama", "Deploy lama"]);
  assert.doesNotMatch(read("clawnify.json"), /\u2014/);
});

test("PRODUCT.md et DESIGN.md pour un institut quelconque : ni premier client, ni charte d'un institut, ni docs/brand (distribution D-03, D-04)", () => {
  for (const doc of [read("PRODUCT.md"), read("DESIGN.md")]) {
    assert.doesNotMatch(doc, /premier client|first client|docs\/brand|cygne et le logotype/);
    assert.doesNotMatch(doc, /\u2014/);
  }
  assert.match(read("PRODUCT.md"), /chaque institut l'installe sur son propre serveur et y dépose son logo\./);
});

test("description OpenAPI en anglais au nom de lama ; onglet, écran d'accueil et favicon lama ; page d'accueil sans nom d'OpenSalon", () => {
  const server = read("src/server/index.ts");
  assert.match(server, /title: "lama"/);
  assert.match(server, /description: "lama: /);
  assert.match(read("src/server/boot.ts"), /console\.log\(`lama à l'écoute sur le port \$\{port\}`\)/);
  const html = read("index.html");
  assert.match(html, /<title>lama<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="lama">/);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/icon\.svg">/);
  assert.doesNotMatch(html, /Open-source salon/);
});

test("icône et favicon : le signe lama en blanc (papier) sur le cuir, même tracé que le signe", () => {
  const icon = read("icon.svg");
  const signe = read("src/client/assets/brand/signe-lama.svg");
  assert.match(icon, /<rect [^>]*fill="#161514"/);
  assert.match(icon, /fill="#FBF9F4"/);
  assert.doesNotMatch(icon, /currentColor|#7c3aed|Scissors/);
  const paths = (svg: string) => [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths(signe).length > 0);
  assert.deepEqual(paths(icon), paths(signe));
});

test("DESIGN.md : écrans de travail sur fond blanc pur, l'ivoire pour les surfaces secondaires et la couverture (décision 17)", () => {
  const design = read("DESIGN.md");
  const overview = design.split("\n").find((line) => line.startsWith("L'agenda de lama est"));
  assert.ok(overview, "paragraphe d'ouverture présent");
  assert.match(overview, /fond blanc pur/);
  assert.doesNotMatch(overview, /fond ivoire|carnet ivoire/);
  assert.match(design, /^- \*\*Ivoire\*\* \(`ivoire`\)\s: [^\n]*blanc pur/m);
  assert.doesNotMatch(design, /\*\*Ivoire\*\* \(`ivoire`\)\s: fond des pages/);
  assert.doesNotMatch(design, /\u2014/);
});
