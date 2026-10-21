import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { frenchFaults } from "../../client/i18n/typography.ts";

/** Documentation de la mise à jour par le réseau (spec du 21/10/2026, M-18). */

const lire = (chemin: string) => readFileSync(new URL(`../../../${chemin}`, import.meta.url), "utf8");

/** Texte d'une section « ## … » jusqu'à la suivante. */
function section(doc: string, titre: string): string {
  const debut = doc.indexOf(`${titre}\n`);
  assert.ok(debut >= 0, titre);
  const suite = doc.slice(debut + titre.length);
  const fin = suite.search(/\n## /);
  return fin === -1 ? suite : suite.slice(0, fin);
}

/** Lignes de prose d'un document Markdown, hors blocs de code, code en ligne remplacé. */
function prose(doc: string): string[] {
  let code = false;
  return doc.split("\n").filter((l) => {
    if (l.startsWith("```")) { code = !code; return false; }
    return !code;
  }).map((l) => l.replace(/`[^`]*`/g, "code"));
}

test("guide du technicien : par l'application d'abord, à la main ensuite, signature vérifiée (M-18)", () => {
  const fr = section(lire("deploy/LISEZMOI.md"), "## Mettre à jour");
  for (const attendu of ["### Depuis l'application", "### À la main", "«\u00a0Mise à jour\u00a0»", "Automatique la nuit (3\u00a0h\u00a030)", "journalctl -u lama-mise-a-jour", "/etc/lama/mise-a-jour.conf", "SHA256SUMS.sig", "--sans-signature", "tmux"]) {
    assert.ok(fr.includes(attendu), attendu);
  }
  const en = section(lire("deploy/README.md"), "## Update");
  for (const attendu of ["### From the application", "### By hand", "“Updates”", "Automatic at night (3:30 am)", "journalctl -u lama-mise-a-jour", "/etc/lama/mise-a-jour.conf", "SHA256SUMS.sig", "--sans-signature", "tmux"]) {
    assert.ok(en.includes(attendu), attendu);
  }
});

test("aide de l'administrateur : rubrique « Mise à jour » dans les deux langues, typographie française (M-18)", () => {
  const fr = lire("docs/aide/fr/administrateur.md");
  const en = lire("docs/aide/en/administrator.md");
  for (const attendu of ["## Mise à jour", "Vérifier maintenant", "Mettre à jour vers X.Y.Z", "Automatique la nuit (3\u00a0h\u00a030)", "Maintenance en cours", "journal des accès"]) assert.ok(fr.includes(attendu), attendu);
  for (const attendu of ["## Updates", "Check now", "Update to X.Y.Z", "Automatic at night (3:30 am)", "Maintenance in progress", "access log"]) assert.ok(en.includes(attendu), attendu);
  for (const ligne of prose(fr)) assert.deepEqual(frenchFaults(ligne), [], ligne);
  for (const ligne of prose(en)) assert.doesNotMatch(ligne, /\s[:;!?]/, ligne);
});

test("guide de publication : étiquette annotée, note ---en---, clé, changement de clé, sans jargon interne (M-18)", () => {
  const g = lire("docs/publication/publier-une-version.md");
  for (const attendu of ["git tag -a v", "---en---", "LAMA_CLE_SIGNATURE", "LAMA_PUBLICATION", "openssl genpkey -algorithm ed25519", "deploy/cle-publique.pem", "## Changer de clé", "deploy/cle-publique-precedente.pem", "ne rien publier d'autre que cette version N", "--sans-signature", "## Clé perdue", "v0.0.1-essai"]) {
    assert.ok(g.includes(attendu), attendu);
  }
  assert.doesNotMatch(g, new RegExp(["comman", "ditaire"].join(""), "i"));
  for (const doc of [g, lire("docs/aide/fr/administrateur.md"), lire("docs/aide/en/administrator.md")]) assert.doesNotMatch(doc, /\u2014/);
  for (const ligne of prose(g)) assert.deepEqual(frenchFaults(ligne), [], ligne);
});
