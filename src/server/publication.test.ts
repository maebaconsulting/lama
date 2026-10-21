import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEPLOY, envEssai, opensslEssai, paireEssai, preparerVersionEssai, SANS_OPENSSL } from "./deploy-essais.ts";

/** Publication d'une version (spec du 21/10/2026, M-3, M-4) : outils/publication/preparer-version.sh. */

const OUTIL = new URL("../../outils/publication/preparer-version.sh", import.meta.url).pathname;

function fonction(nom: string, args: string[], vars: Record<string, string> = {}) {
  const r = spawnSync("bash", ["-c", `source '${OUTIL}'; "$@"`, "essai", nom, ...args], { env: envEssai(vars), encoding: "utf8" });
  return { code: r.status ?? -1, sortie: `${r.stdout}${r.stderr}` };
}

function note(texte: string): string {
  const fichier = join(mkdtempSync(join(tmpdir(), "lama-note-")), "note.md");
  writeFileSync(fichier, texte);
  return fichier;
}

test("étiquette : vX.Y.Z égale à la version de package.json, sinon refusée (M-3, essai v0.0.1-essai)", () => {
  assert.equal(fonction("etiquette_conforme", ["v1.2.0", "1.2.0"]).code, 0);
  for (const [etiquette, version] of [["v0.0.1-essai", "1.0.0"], ["v1.2.0", "1.2.1"], ["1.2.0", "1.2.0"], ["v1.2.0-essai", "1.2.0-essai"], ["v01.2.0", "01.2.0"]]) {
    assert.notEqual(fonction("etiquette_conforme", [etiquette, version]).code, 0, `${etiquette} / ${version}`);
  }
});

test("note : une partie française et une partie anglaise, séparées par une seule ligne ---en--- (M-3)", () => {
  assert.equal(fonction("note_conforme", [note("Agenda plus rapide.\n---en---\nFaster calendar.\n")]).code, 0);
  for (const texte of ["Agenda plus rapide.\n", "---en---\nFaster calendar.\n", "Agenda plus rapide.\n---en---\n\n", "a\n---en---\nb\n---en---\nc\n"]) {
    assert.notEqual(fonction("note_conforme", [note(texte)]).code, 0, JSON.stringify(texte));
  }
});

test("contrôles seuls (--verifier) : étiquette différente de package.json refusée, rien n'est fabriqué (essai v0.0.1-essai)", () => {
  const r = spawnSync("bash", [OUTIL, "--verifier", "v0.0.1-essai", note("a\n---en---\nb\n")], { env: envEssai(), encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /L'étiquette v0\.0\.1-essai ne correspond pas à package\.json \(\d+\.\d+\.\d+\)\u00a0: rien n'est publié\./);
});

test("signature : SHA256SUMS de l'archive et de la note, signé puis vérifié avec la clé publique ; une autre clé est refusée (M-4)", (t) => {
  const openssl = opensslEssai();
  if (!openssl) { t.skip(SANS_OPENSSL); return; }
  const cle = paireEssai(openssl);
  const autre = paireEssai(openssl);
  const { dossier } = preparerVersionEssai({ version: "1.2.0" });
  const r = fonction("signer_version", [dossier, "lama-1.2.0.tar.gz", cle.privee], { LAMA_OPENSSL: openssl });
  assert.equal(r.code, 0, r.sortie);
  assert.deepEqual(readFileSync(join(dossier, "SHA256SUMS"), "utf8").trim().split("\n").map((l) => l.split("  ")[1]), ["lama-1.2.0.tar.gz", "NOTES.md"]);
  const verifier = (publique: string) => spawnSync("bash", ["-c", `source '${join(DEPLOY, "verification.sh")}'; verifier_signature "$1" "$2"`, "essai", dossier, publique], { env: envEssai({ LAMA_OPENSSL: openssl }) }).status;
  assert.equal(verifier(cle.publique), 0);
  assert.notEqual(verifier(autre.publique), 0);
});

test("outil : copie conforme des règles de la spec, sans clé ni chemin local dans le dépôt", () => {
  const s = readFileSync(OUTIL, "utf8");
  assert.match(s, /^#!\/usr\/bin\/env bash\n/);
  assert.match(s, /^set -euo pipefail$/m);
  assert.match(s, /bash "\$RACINE\/deploy\/fabriquer-paquet\.sh" --publiee/);
  assert.match(s, /verifier_signature "\$SORTIE" "\$PUBLIQUE" \|\| echec/);
  assert.doesNotMatch(s, /\/(Users|home)\//);
});

test("travail «\u00a0Publier une version\u00a0» : étiquette vérifiée d'abord, essais, tsc au seuil, signature, release ; seulement là où LAMA_PUBLICATION vaut oui (M-3)", () => {
  const w = readFileSync(new URL("../../.github/workflows/publier-version.yml", import.meta.url), "utf8");
  assert.match(w, /^on:\n  push:\n    tags:\n      - "v\*"$/m);
  assert.match(w, /^    if: vars\.LAMA_PUBLICATION == 'oui'$/m);
  assert.doesNotMatch(w, /^permissions:/m, "droits donnés au seul travail publier");
  assert.match(w, /^  publier:\n(?:    #.*\n)*    if: .*\n    runs-on: .*\n(?:    #.*\n)*    permissions:\n      contents: write$/m);
  assert.match(w, /- uses: actions\/checkout@[0-9a-f]{40} # v4\n        with:\n(?:          #.*\n)*          persist-credentials: false\n/, "jeton jamais laissé dans .git/config");
  const ordre = ["git cat-file -t", "preparer-version.sh --verifier", "pnpm install --frozen-lockfile", "pnpm test", "error TS", "LAMA_CLE_SIGNATURE", "gh release create"];
  let avant = -1;
  for (const pas of ordre) {
    const i = w.indexOf(pas);
    assert.ok(i > avant, `ordre : ${pas}`);
    avant = i;
  }
  assert.match(w, /\[ "\$ERREURS" -le 13 \]/, "même seuil tsc que l'export public");
  assert.match(w, /\|\| CODE=\$\?\n\s*if \[ "\$CODE" -ne 0 \] && \[ "\$CODE" -ne 2 \]; then/, "tsc qui n'a pas tourné (code autre que 0 ou 2) : échec");
  assert.match(w, /rm -f "\$RUNNER_TEMP\/cle\.pem"/, "la clé privée ne reste pas sur la machine");
  assert.doesNotMatch(w, /\/(home|tmp|Users)\//, "aucun chemin local (contrôle de l'export public)");
});

test("changement de clé : la version N porte la nouvelle clé et reste signée par l'ancienne ; sans cle-publique-precedente.pem elle est refusée (M-5)", (t) => {
  const openssl = opensslEssai();
  if (!openssl) { t.skip(SANS_OPENSSL); return; }
  const ancienne = paireEssai(openssl);
  const nouvelle = paireEssai(openssl);
  const { dossier } = preparerVersionEssai({ version: "1.3.0" });
  assert.equal(fonction("signer_version", [dossier, "lama-1.3.0.tar.gz", ancienne.privee], { LAMA_OPENSSL: openssl }).code, 0);
  const arbre = (avecPrecedente: boolean) => {
    const racine = mkdtempSync(join(tmpdir(), "lama-arbre-"));
    mkdirSync(join(racine, "deploy"));
    copyFileSync(nouvelle.publique, join(racine, "deploy", "cle-publique.pem"));
    if (avecPrecedente) copyFileSync(ancienne.publique, join(racine, "deploy", "cle-publique-precedente.pem"));
    return racine;
  };
  const verifier = (racine: string) => spawnSync("bash", ["-c", `source '${OUTIL}'; source '${join(DEPLOY, "verification.sh")}'; verifier_signature "$1" "$(cle_de_verification "$2")"`, "essai", dossier, racine], { env: envEssai({ LAMA_OPENSSL: openssl }) }).status;
  assert.equal(verifier(arbre(true)), 0);
  assert.notEqual(verifier(arbre(false)), 0);
});

test("clé publique des versions : une seule clé publique Ed25519, au format PEM (M-5)", () => {
  const pem = readFileSync(new URL("../../deploy/cle-publique.pem", import.meta.url), "utf8");
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA[A-Za-z0-9+/]{43}=\n-----END PUBLIC KEY-----\n$/);
});

test("travail de publication : chaque action épinglée par un SHA de 40 caractères (tâche 20)", () => {
  const travail = readFileSync(new URL("../../.github/workflows/publier-version.yml", import.meta.url), "utf8");
  const actions = [...travail.matchAll(/^\s*- uses: (\S+)/gm)].map((m) => m[1]);
  assert.ok(actions.length >= 3);
  for (const a of actions) assert.match(a, /@[0-9a-f]{40}$/, a);
});
