import assert from "node:assert/strict";
import { appendFileSync, copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appeler, opensslEssai, paireEssai, preparerVersionEssai, SANS_OPENSSL } from "./deploy-essais.ts";

/** Versions et signature des archives (spec du 21/10/2026, M-1, M-4, M-6) : deploy/verification.sh, fonction par fonction. */

const v = (fonction: string, args: string[], vars: Record<string, string> = {}) => appeler("verification.sh", fonction, args, vars).status;

test("versions : X.Y.Z publiée, AAAAMMJJ-HHMM-empreinte de développement, rien d'autre (M-1)", () => {
  for (const ok of ["0.0.1", "1.0.0", "1.10.0", "9999.9999.9999"]) assert.equal(v("version_publiee", [ok]), 0, ok);
  for (const non of ["", "1.0", "01.0.0", "1.0.0-essai", "v1.0.0", "10000.0.0", "1.0.0\n", "1..0", "20261021-1030-abc123", "../../etc"]) {
    assert.notEqual(v("version_publiee", [non]), 0, JSON.stringify(non));
  }
  assert.equal(v("version_developpement", ["20261021-1030-abc123"]), 0);
  for (const non of ["1.0.0", "20261021-1030-ABC", "2026102-1030-abc"]) assert.notEqual(v("version_developpement", [non]), 0, non);
  for (const ok of ["1.2.3", "20261021-1030-abc123"]) assert.equal(v("version_valide", [ok]), 0, ok);
  assert.notEqual(v("version_valide", ["../x"]), 0);
});

test("ordre : nombres comparés un à un, une version de développement n'est jamais plus récente (M-1)", () => {
  const plus = (a: string, b: string) => v("plus_recente", [a, b]) === 0;
  assert.equal(plus("1.10.0", "1.9.3"), true);
  assert.equal(plus("1.9.3", "1.10.0"), false);
  assert.equal(plus("2.0.0", "1.99.99"), true);
  assert.equal(plus("1.0.1", "1.0.0"), true);
  assert.equal(plus("1.0.0", "1.0.0"), false);
  assert.equal(plus("20261021-1030-abc", "1.0.0"), false);
  assert.equal(plus("1.0.0", "20261021-1030-abc"), false);
  assert.equal(plus("20261022-1030-abc", "20261021-1030-abc"), false);
});

test("signature : SHA256SUMS signé par la clé donnée accepté ; modifié, signé par une autre clé ou sans signature, refusé (M-4, M-6)", (t) => {
  const openssl = opensslEssai();
  if (!openssl) { t.skip(SANS_OPENSSL); return; }
  const cle = paireEssai(openssl);
  const autre = paireEssai(openssl);
  const { dossier } = preparerVersionEssai({ version: "1.2.0", openssl, privee: cle.privee });
  const vars = { LAMA_OPENSSL: openssl };
  assert.equal(v("verifier_signature", [dossier, cle.publique], vars), 0);
  assert.notEqual(v("verifier_signature", [dossier, autre.publique], vars), 0, "signée par une autre clé");
  assert.notEqual(v("verifier_signature", [dossier, join(dossier, "absente.pem")], vars), 0, "clé absente");
  const sommes = readFileSync(join(dossier, "SHA256SUMS"), "utf8");
  writeFileSync(join(dossier, "SHA256SUMS"), sommes.replace(/^./, (c) => (c === "0" ? "1" : "0")));
  assert.notEqual(v("verifier_signature", [dossier, cle.publique], vars), 0, "SHA256SUMS modifié");
  const sansSignature = preparerVersionEssai({ version: "1.2.0" });
  assert.notEqual(v("verifier_signature", [sansSignature.dossier, cle.publique], vars), 0, "sans SHA256SUMS.sig");
});

test("empreintes : archive ou note modifiée refusée, archive absente de SHA256SUMS refusée (M-6)", () => {
  const { dossier } = preparerVersionEssai({ version: "1.2.0" });
  assert.equal(v("verifier_empreintes", [dossier, "lama-1.2.0.tar.gz"]), 0);
  assert.notEqual(v("verifier_empreintes", [dossier, "lama-1.3.0.tar.gz"]), 0, "archive non listée");
  appendFileSync(join(dossier, "NOTES.md"), "ajout\n");
  assert.notEqual(v("verifier_empreintes", [dossier, "lama-1.2.0.tar.gz"]), 0, "note modifiée");
  const autre = preparerVersionEssai({ version: "1.2.0" });
  appendFileSync(join(autre.dossier, "lama-1.2.0.tar.gz"), "x");
  assert.notEqual(v("verifier_empreintes", [autre.dossier, "lama-1.2.0.tar.gz"]), 0, "archive modifiée");
});

test("dossier extrait : identique à l'archive signée, sinon refusé, même pour un fichier ajouté (M-6)", () => {
  const { dossier } = preparerVersionEssai({ version: "1.2.0" });
  const archive = join(dossier, "lama-1.2.0.tar.gz");
  execFileSync("tar", ["-xzf", archive, "-C", dossier]);
  const extrait = join(dossier, "lama-1.2.0");
  assert.equal(v("arbre_conforme", [archive, "lama-1.2.0", extrait]), 0);
  writeFileSync(join(extrait, "deploy", "mettre-a-jour.sh"), "#!/usr/bin/env bash\necho falsifié\n");
  assert.notEqual(v("arbre_conforme", [archive, "lama-1.2.0", extrait]), 0, "fichier modifié");
  const second = preparerVersionEssai({ version: "1.2.0" });
  execFileSync("tar", ["-xzf", join(second.dossier, "lama-1.2.0.tar.gz"), "-C", second.dossier]);
  writeFileSync(join(second.dossier, "lama-1.2.0", "deploy", "ajout.sh"), "echo\n");
  assert.notEqual(v("arbre_conforme", [join(second.dossier, "lama-1.2.0.tar.gz"), "lama-1.2.0", join(second.dossier, "lama-1.2.0")]), 0, "fichier ajouté");
  const troisieme = preparerVersionEssai({ version: "1.2.0" });
  execFileSync("tar", ["-xzf", join(troisieme.dossier, "lama-1.2.0.tar.gz"), "-C", troisieme.dossier]);
  const dehors = join(mkdtempSync(join(tmpdir(), "lama-dehors-")), "main.mjs");
  copyFileSync(join(troisieme.dossier, "lama-1.2.0", "dist-server", "main.mjs"), dehors);
  rmSync(join(troisieme.dossier, "lama-1.2.0", "dist-server", "main.mjs"));
  symlinkSync(dehors, join(troisieme.dossier, "lama-1.2.0", "dist-server", "main.mjs"));
  assert.notEqual(v("arbre_conforme", [join(troisieme.dossier, "lama-1.2.0.tar.gz"), "lama-1.2.0", join(troisieme.dossier, "lama-1.2.0")]), 0, "lien symbolique vers un fichier identique");
  assert.notEqual(v("arbre_conforme", [join(mkdtempSync(join(tmpdir(), "lama-vide-")), "absente.tar.gz"), "lama-1.2.0", extrait]), 0, "archive absente");
});

test("refus de vérification : une phrase dans chaque langue", () => {
  assert.match(appeler("verification.sh", "motif_refus", ["signature"]).stdout, /^Signature refusée\u00a0: /);
  assert.match(appeler("verification.sh", "motif_refus", ["arbre"]).stdout, /^Le dossier extrait ne correspond pas/);
  assert.match(appeler("verification.sh", "motif_refus", ["empreinte"], { LAMA_LANGUE: "en" }).stdout, /^Checksum refused: /);
});
