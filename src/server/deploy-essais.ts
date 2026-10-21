/**
 * Aides des essais des scripts de deploy/ (versions signées, mise à jour par le réseau) :
 * environnement sans langue imposée, openssl 3 du poste, paire de clés Ed25519 jetable,
 * version d'essai telle que la publie le travail GitHub. Tout est écrit dans le dossier
 * temporaire du système ; aucune clé n'est gardée ailleurs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEPLOY = new URL("../../deploy/", import.meta.url).pathname;

/** Raison d'un essai sauté faute d'openssl 3 (l'openssl du système du Mac est LibreSSL, sans -rawin). */
export const SANS_OPENSSL = "openssl 3 introuvable (LibreSSL du Mac sans -rawin)\u00a0: brew install openssl@3, ou LAMA_OPENSSL=/chemin/vers/openssl";

/** Environnement d'un script essayé : celui du processus, scripts en français, plus `vars`. */
export function envEssai(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LANG;
  delete env.LC_ALL;
  return { ...env, LAMA_LANGUE: "fr", ...vars };
}

/** openssl capable de signer en Ed25519 avec -rawin : LAMA_OPENSSL, celui du PATH, ceux de Homebrew ; null sinon. */
export function opensslEssai(): string | null {
  const candidats = [process.env.LAMA_OPENSSL, "openssl", "/opt/homebrew/opt/openssl@3/bin/openssl", "/usr/local/opt/openssl@3/bin/openssl"];
  for (const candidat of candidats) {
    if (!candidat) continue;
    const dossier = mkdtempSync(join(tmpdir(), "lama-openssl-essai-"));
    try {
      execFileSync(candidat, ["genpkey", "-algorithm", "ed25519", "-out", join(dossier, "k.pem")], { stdio: "pipe" });
      writeFileSync(join(dossier, "m"), "lama");
      execFileSync(candidat, ["pkeyutl", "-sign", "-rawin", "-inkey", join(dossier, "k.pem"), "-in", join(dossier, "m"), "-out", join(dossier, "s")], { stdio: "pipe" });
      return candidat;
    } catch {
      // candidat suivant
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  }
  return null;
}

/** Paire de clés Ed25519 jetable (PEM), dans un dossier temporaire. */
export function paireEssai(openssl: string): { privee: string; publique: string } {
  const dossier = mkdtempSync(join(tmpdir(), "lama-cle-essai-"));
  const privee = join(dossier, "privee.pem");
  const publique = join(dossier, "publique.pem");
  execFileSync(openssl, ["genpkey", "-algorithm", "ed25519", "-out", privee], { stdio: "pipe" });
  execFileSync(openssl, ["pkey", "-in", privee, "-pubout", "-out", publique], { stdio: "pipe" });
  return { privee, publique };
}

/**
 * Version d'essai comme la publie le travail GitHub : un dossier avec lama-VERSION.tar.gz
 * (dossier lama-VERSION : VERSION, dist-server/main.mjs, deploy/mettre-a-jour.sh donné ou
 * factice, deploy/cle-publique.pem si `clePublique`), NOTES.md, SHA256SUMS et, avec `openssl`
 * et `privee`, SHA256SUMS.sig. `versionDansArchive` : VERSION écrite dans l'archive.
 */
export function preparerVersionEssai(o: { version: string; openssl?: string; privee?: string; mettreAJour?: string; versionDansArchive?: string; clePublique?: string }): { dossier: string } {
  const dossier = mkdtempSync(join(tmpdir(), "lama-version-essai-"));
  const atelier = mkdtempSync(join(tmpdir(), "lama-atelier-essai-"));
  const nom = `lama-${o.version}`;
  const racine = join(atelier, nom);
  mkdirSync(join(racine, "deploy"), { recursive: true });
  mkdirSync(join(racine, "dist-server"), { recursive: true });
  writeFileSync(join(racine, "VERSION"), `${o.versionDansArchive ?? o.version}\n`);
  writeFileSync(join(racine, "dist-server", "main.mjs"), "// essai\n");
  writeFileSync(join(racine, "deploy", "mettre-a-jour.sh"), o.mettreAJour ?? "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(racine, "deploy", "mettre-a-jour.sh"), 0o755);
  if (o.clePublique) copyFileSync(o.clePublique, join(racine, "deploy", "cle-publique.pem"));
  execFileSync("tar", ["-czf", join(dossier, `${nom}.tar.gz`), "-C", atelier, nom], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  rmSync(atelier, { recursive: true, force: true });
  writeFileSync(join(dossier, "NOTES.md"), "Agenda plus rapide.\n---en---\nFaster calendar.\n");
  execFileSync("bash", ["-c", 'cd "$1" && sha256sum "$2" NOTES.md > SHA256SUMS', "essai", dossier, `${nom}.tar.gz`]);
  if (o.openssl && o.privee) {
    execFileSync(o.openssl, ["pkeyutl", "-sign", "-rawin", "-inkey", o.privee, "-in", join(dossier, "SHA256SUMS"), "-out", join(dossier, "SHA256SUMS.sig")], { stdio: "pipe" });
  }
  return { dossier };
}

/** Appelle une fonction d'un script de deploy/ chargé par « source » (jamais le reste du script). */
export function appeler(script: string, fonction: string, args: string[], vars: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, script)}'; "$@"`, "essai", fonction, ...args], { env: envEssai(vars), encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}
