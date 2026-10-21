import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/** Installation en une commande depuis le dépôt public (deploy/installer-en-ligne.sh, 21/10/2026). */

const SCRIPT = new URL("../../deploy/installer-en-ligne.sh", import.meta.url).pathname;
const texte = readFileSync(SCRIPT, "utf8");

/** Lance le script comme « curl … | bash », avec une commande id simulée qui répond `uid`. */
function parTube(uid: number, args: string[] = []) {
  const bin = mkdtempSync(join(tmpdir(), "lama-en-ligne-"));
  writeFileSync(join(bin, "id"), `#!/bin/sh\necho ${uid}\n`);
  chmodSync(join(bin, "id"), 0o755);
  return spawnSync("bash", ["-s", "--", ...args], { input: texte, encoding: "utf8", env: { PATH: `${bin}:${process.env.PATH}`, LAMA_LANGUE: "fr" } });
}

/** Résultat de source_valide, chargée par « source » sans lancer l'installation. */
function sourceValide(depot: string, ref: string): boolean {
  return spawnSync("bash", ["-c", `source '${SCRIPT}'; source_valide "$1" "$2"`, "essai", depot, ref]).status === 0;
}

test("installation en ligne : par un tube, sans sudo, refusée avant toute action", () => {
  const r = parTube(1000, ["--auto"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Lancez ce script avec sudo/);
  assert.equal(r.stdout, "", "rien d'installé ni d'affiché avant le refus");
});

test("installation en ligne : chargée par source, rien ne s'exécute ; tout le travail est dans principal, appelée en dernier", () => {
  const r = spawnSync("bash", ["-c", `source '${SCRIPT}'; echo chargé`], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "chargé");
  assert.match(texte.trimEnd(), /\nprincipal "\$@"$/, "un téléchargement coupé n'exécute rien");
});

test("installation en ligne : source validée (dépôt propriétaire/nom, branche ou étiquette)", () => {
  assert.ok(sourceValide("maebaconsulting/lama", "main"));
  assert.ok(sourceValide("essai/lama-recette", "v1.2.3"));
  for (const [depot, ref] of [["maebaconsulting", "main"], ["a/b/c", "main"], ["a/b;rm", "main"], ["a/b", "--upload-pack=x"], ["a/b", "../x"], ["a/b", "main x"]]) {
    assert.equal(sourceValide(depot, ref), false, `${depot} ${ref}`);
  }
});

test("installation en ligne : paquet fabriqué par pnpm paquet, installer.sh branché sur le terminal avec les options reçues", () => {
  assert.match(texte, /pnpm install --frozen-lockfile && pnpm paquet/);
  assert.match(texte, /\.\/deploy\/installer\.sh "\$@" <\/dev\/tty/);
  assert.match(texte, /: <\/dev\/tty/, "terminal vérifié avant toute installation");
  assert.match(texte, /PNPM_VERSION=\d+\.\d+\.\d+/);
});

test("installation en ligne : dossier de travail où seul root écrit, jamais /tmp ni /var/tmp", () => {
  assert.match(texte, /^TRAVAIL=\/var\/lib\//m);
  assert.doesNotMatch(texte.replace(/^#.*$/gm, ""), /\/(var\/)?tmp\b/);
  assert.match(texte, /stat -c %u "\$TRAVAIL"/);
});
