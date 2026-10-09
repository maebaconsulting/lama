import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { englishFaults, frenchFaults } from "../../client/i18n/typography.ts";

/** Guide du technicien (distribution D-14 à D-19) : installer, utiliser et remettre à zéro la base de formation. */
const lire = (chemin: string) => readFileSync(new URL(`../../../${chemin}`, import.meta.url), "utf8");

/** Texte d'une section `## titre`, jusqu'à la suivante. */
function section(doc: string, titre: string): string {
  const debut = doc.indexOf(`\n## ${titre}\n`);
  assert.ok(debut >= 0, titre);
  const fin = doc.indexOf("\n## ", debut + 1);
  return doc.slice(debut, fin < 0 ? undefined : fin);
}

/** Lignes de prose (hors blocs de code, code en ligne et adresses remplacés). */
function prose(texte: string): string[] {
  let code = false;
  return texte.split("\n").filter((l) => {
    if (l.startsWith("```")) { code = !code; return false; }
    return !code;
  }).map((l) => l.replace(/`[^`]*`/g, "code").replace(/https?:\/\/\S+/g, "adresse"));
}

const COMMANDES = [
  "sudo /opt/lama/actuelle/deploy/lama-formation.sh --installer",
  "sudo lama-formation --etat",
  "sudo lama-formation --comptes",
  "sudo lama-formation --remettre-a-zero",
  "sudo systemctl disable --now lama-formation",
];

test("LISEZMOI : section « Base de formation » avant « Mettre à jour », commandes, comptes, coupures, remise à zéro ; typographie française", () => {
  const doc = lire("deploy/LISEZMOI.md");
  assert.ok(doc.indexOf("## Téléphone passerelle SMS") < doc.indexOf("## Base de formation"));
  assert.ok(doc.indexOf("## Base de formation") < doc.indexOf("## Mettre à jour"));
  const texte = section(doc, "Base de formation");
  for (const attendu of [...COMMANDES, "https://lama.local:8443", "formation.admin", "formation.gerante", "formation.reception", "formation.praticienne", "port 8443", "Base de formation", "FORMATION", "Réglages, Formation", "Remettre la formation à zéro", "lama formation", "Institut Démo", "différents de ceux de la vraie base"]) {
    assert.ok(texte.includes(attendu), attendu);
  }
  for (const ligne of prose(texte)) assert.deepEqual(frenchFaults(ligne), [], ligne);
});

test("guide anglais : section « Training database » avant « Update », mêmes commandes ; typographie anglaise", () => {
  const doc = lire("deploy/README.md");
  assert.ok(doc.indexOf("## SMS gateway phone") < doc.indexOf("## Training database"));
  assert.ok(doc.indexOf("## Training database") < doc.indexOf("## Update"));
  const texte = section(doc, "Training database");
  for (const attendu of [...COMMANDES, "https://lama.local:8443", "formation.admin", "formation.praticienne", "port 8443", "Training database", "TRAINING", "Settings, Training", "Reset the training database", "different from those of the real database"]) {
    assert.ok(texte.includes(attendu), attendu);
  }
  for (const ligne of prose(texte)) assert.deepEqual(englishFaults(ligne), [], ligne);
});
