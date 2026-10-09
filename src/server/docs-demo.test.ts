import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults } from "../client/i18n/typography.ts";

/** Licence, présentation et notice Dokploy de la démonstration publique (démo publique DP-10, DP-13). */

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** Lignes de prose (hors blocs de code ; code en ligne et adresses remplacés). */
function prose(doc: string): string[] {
  let code = false;
  return doc.split("\n").filter((l) => {
    if (l.startsWith("```")) { code = !code; return false; }
    return !code;
  }).map((l) => l.replace(/`[^`]*`/g, "code").replace(/https?:\/\/\S+/g, "adresse"));
}

const titres = (doc: string) => doc.split("\n").filter((l) => l.startsWith("## "));

test("LICENSE : MIT, ligne de Clawnify gardée, ligne de lama ajoutée", () => {
  const licence = read("LICENSE");
  assert.match(licence, /^MIT License\n\nCopyright \(c\) 2026 Clawnify\nCopyright \(c\) 2026 lama\n\nPermission is hereby granted/);
});

test("README et LISEZMOI : MIT au lieu d'AGPL, section Démo vers https://lama-demo.mowoapp.com ; typographie", () => {
  const readme = read("README.md");
  const lisezmoi = read("LISEZMOI.md");
  for (const doc of [readme, lisezmoi]) {
    assert.doesNotMatch(doc, /AGPL/);
    assert.ok(doc.includes("](https://lama-demo.mowoapp.com)"));
    assert.ok(doc.includes("[LICENSE](LICENSE)"));
    assert.doesNotMatch(doc, /\u2014/);
  }
  assert.match(readme, /\n## Demo\n/);
  assert.match(lisezmoi, /\n## Démo\n/);
  assert.deepEqual(prose(lisezmoi).flatMap((l) => frenchFaults(l)), []);
  assert.deepEqual(prose(readme).flatMap((l) => englishFaults(l)), []);
});

test("notice Dokploy : mêmes sections en français et en anglais, application Dockerfile en stop-first, compose, variable secrète, domaine, DNS, sécurité, vérification, journal", () => {
  const fr = read("deploy/docker/LISEZMOI.md");
  const en = read("deploy/docker/README.md");
  assert.deepEqual(titres(fr), [
    "## Ce que l'on obtient", "## Créer l'application dans Dokploy", "## Variables", "## Volume", "## Mise à jour\u00a0: arrêter avant de démarrer",
    "## Domaine et HTTPS", "## DNS", "## Sécurité", "## Autre manière\u00a0: application Compose",
    "## Vérifier", "## Remise à zéro de chaque nuit", "## Redéployer", "## Journal",
  ]);
  assert.equal(titres(en).length, titres(fr).length);
  for (const doc of [fr, en]) {
    for (const attendu of ["deploy/docker/compose.demo.yml", "maebaconsulting/lama", "LAMA_DEMO_MDP_ADMIN", "LAMA_PROXY_HTTPS=1", "lama-demo.mowoapp.com", "`8080`", "`lama`", "dokploy-network", "Dockerfile", "stop-first", "on-failure", "/data", "LAMA_DEMO_PUBLIQUE=1", "__Host-", "SameSite=Strict", "Strict", "Flexible", "lama-demo-donnees"]) {
      assert.ok(doc.includes(attendu), attendu);
    }
    assert.doesNotMatch(doc, /\u2014/);
    assert.doesNotMatch(doc, new RegExp(["panel\\.mowo", "app\\.com|commandi", "taire|sponsor"].join("")));
  }
  assert.doesNotMatch(fr, /ne démarre pas/);
  assert.doesNotMatch(en, /does not start/);
  assert.ok(fr.includes("trop courte") && en.includes("too short"));
  assert.ok(fr.includes("DNS seulement"));
  assert.ok(en.includes("DNS only"));
  assert.ok(fr.includes("(README.md)") && en.includes("(LISEZMOI.md)"));
  assert.deepEqual(prose(fr).flatMap((l) => frenchFaults(l).map((f) => `${l} : ${f}`)), []);
  assert.deepEqual(prose(en).flatMap((l) => englishFaults(l).map((f) => `${l} : ${f}`)), []);
});
