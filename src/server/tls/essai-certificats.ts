/**
 * Aide aux essais du HTTPS (distribution D-05 à D-08) : fabrique une autorité
 * et un certificat du serveur dans un dossier temporaire avec le vrai script
 * `deploy/lama-certificat.sh`, et dit pourquoi c'est impossible quand la
 * commande `openssl` du poste ne sait pas le faire (essai alors sauté, avec
 * ce motif). `LAMA_OPENSSL` choisit la commande (défaut : `openssl` du PATH ;
 * sur macOS, celle de Homebrew ou `/usr/bin/openssl`, LibreSSL, conviennent).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SCRIPT = new URL("../../../deploy/lama-certificat.sh", import.meta.url).pathname;
export const OPENSSL = process.env.LAMA_OPENSSL ?? "openssl";

/** Environnement du script en essai : sans root, langue française, dossier donné. */
export function envEssai(tlsDir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, LAMA_ESSAI_SANS_ROOT: "1", LAMA_LANGUE: "fr", LAMA_TLS_DIR: tlsDir, LAMA_OPENSSL: OPENSSL, ...extra };
}

/** Lance `lama-certificat.sh` avec ces arguments ; rend le code de sortie et les deux sorties. */
export function lancer(tlsDir: string, args: string[], extra: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync("bash", [SCRIPT, ...args], { env: envEssai(tlsDir, extra), encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

let motif: string | null | undefined;

/**
 * `null` si `openssl` sait fabriquer l'autorité (EC P-256, contrainte de noms)
 * et refuser un nom hors contrainte ; sinon le motif, à passer à `t.skip`.
 */
export function opensslManquant(): string | null {
  if (motif !== undefined) return motif;
  const dir = mkdtempSync(join(tmpdir(), "lama-openssl-"));
  try {
    const version = spawnSync(OPENSSL, ["version"], { encoding: "utf8" });
    if (version.status !== 0) return (motif = `commande ${OPENSSL} introuvable (LAMA_OPENSSL pour en choisir une autre)`);
    const tls = join(dir, "tls");
    const fait = lancer(tls, ["--adresse", "192.168.1.50"]);
    if (fait.status !== 0) return (motif = `${version.stdout.trim()} ne sait pas fabriquer l'autorité\u00a0: ${fait.stderr.trim()}`);
    signer(tls, { name: "exemple.com", days: 30, out: join(dir, "hors.crt") });
    const verif = spawnSync(OPENSSL, ["verify", "-CAfile", join(tls, "autorite.crt"), join(dir, "hors.crt")], { encoding: "utf8" });
    if (verif.status === 0) return (motif = `${version.stdout.trim()} ne vérifie pas la contrainte de noms`);
    return (motif = null);
  } catch (error) {
    return (motif = `openssl inutilisable\u00a0: ${(error as Error).message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Fabrique autorité et certificat du serveur pour `ip` dans `<dir>/tls` ; rend ce dossier. */
export function fabriquerCertificats(dir: string, ip = "192.168.1.50"): string {
  const tls = join(dir, "tls");
  const r = lancer(tls, ["--adresse", ip]);
  if (r.status !== 0) throw new Error(`lama-certificat.sh --adresse ${ip}\u00a0: ${r.stderr}`);
  return tls;
}

/**
 * Signe avec l'autorité de `tlsDir` un certificat pour `name` (`DNS:…` ou
 * `IP:…` si c'est une adresse), valable `days` jours, avec la clé du serveur
 * (`serveur.key`) : sert à poser un certificat proche de son échéance ou hors
 * de la contrainte de noms.
 */
export function signer(tlsDir: string, o: { name: string; days: number; out: string }): void {
  const work = mkdtempSync(join(tmpdir(), "lama-signer-"));
  try {
    const san = /^\d+\.\d+\.\d+\.\d+$/.test(o.name) ? `IP:${o.name}` : `DNS:${o.name}`;
    writeFileSync(join(work, "ext"), `basicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = serverAuth\nsubjectAltName = ${san}\n`);
    execFileSync(OPENSSL, ["req", "-new", "-key", join(tlsDir, "serveur.key"), "-subj", "/CN=lama.local", "-out", join(work, "csr")], { stdio: "ignore" });
    execFileSync(OPENSSL, ["x509", "-req", "-in", join(work, "csr"), "-CA", join(tlsDir, "autorite.crt"), "-CAkey", join(tlsDir, "autorite.key"),
      "-set_serial", `0x${Date.now().toString(16)}${Math.floor(Math.random() * 1e6).toString(16)}`, "-days", String(o.days), "-sha256", "-extfile", join(work, "ext"), "-out", o.out], { stdio: "ignore" });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
