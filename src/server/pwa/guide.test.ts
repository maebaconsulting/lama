import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults } from "../../client/i18n/typography.ts";

/** Guide du technicien (PWA, P-08) : installer lama sur l'écran d'accueil après l'approbation du certificat. */
const lire = (chemin: string) => readFileSync(new URL(`../../../${chemin}`, import.meta.url), "utf8");

/** Texte d'une section `## titre`, jusqu'à la suivante. */
function section(doc: string, titre: string): string {
  const debut = doc.indexOf(`\n## ${titre}\n`);
  assert.ok(debut >= 0, titre);
  const fin = doc.indexOf("\n## ", debut + 1);
  return doc.slice(debut, fin < 0 ? undefined : fin);
}

test("LISEZMOI : section après « Certificat HTTPS », iPhone, iPad, Android et ordinateur, entrée du menu, nouvelle version ; typographie française", () => {
  const doc = lire("deploy/LISEZMOI.md");
  assert.ok(doc.indexOf("## Certificat HTTPS") < doc.indexOf("## Installer lama sur l'écran d'accueil"));
  assert.ok(doc.indexOf("## Installer lama sur l'écran d'accueil") < doc.indexOf("## Heure du serveur"));
  const texte = section(doc, "Installer lama sur l'écran d'accueil");
  for (const attendu of ["Une fois le certificat approuvé", "iPhone et iPad", "Sur l'écran d'accueil", "Android", "Chrome ou Edge", "Installer lama sur cet appareil", "Serveur injoignable", "Nouvelle version disponible"]) {
    assert.ok(texte.includes(attendu), attendu);
  }
  for (const ligne of texte.split("\n")) assert.deepEqual(frenchFaults(ligne.replace(/https?:\/\/\S+/g, "adresse")), [], ligne);
  assert.match(section(doc, "Certificat HTTPS"), /installer lama sur l'écran d'accueil de l'appareil/);
  assert.match(lire("LISEZMOI.md"), /lama s'installe sur son écran d'accueil \(iPhone, iPad, Android\) et s'ouvre en plein écran, comme une application/);
});

test("guide anglais et README : même section, typographie anglaise", () => {
  const doc = lire("deploy/README.md");
  assert.ok(doc.indexOf("## HTTPS certificate") < doc.indexOf("## Install lama on the home screen"));
  assert.ok(doc.indexOf("## Install lama on the home screen") < doc.indexOf("## Server time"));
  const texte = section(doc, "Install lama on the home screen");
  for (const attendu of ["Once the certificate is approved", "iPhone and iPad", "Add to Home Screen", "Android", "Chrome or Edge", "Install lama on this device", "Server unreachable", "New version available"]) {
    assert.ok(texte.includes(attendu), attendu);
  }
  for (const ligne of texte.split("\n")) assert.deepEqual(englishFaults(ligne.replace(/https?:\/\/\S+/g, "address")), [], ligne);
  assert.match(lire("README.md"), /lama installs on its home screen \(iPhone, iPad, Android\)/);
});
