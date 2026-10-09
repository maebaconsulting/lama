import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fabriquerCertificats, lancer, OPENSSL, opensslManquant, SCRIPT, signer } from "./essai-certificats.ts";

/**
 * Commande `lama-certificat` (distribution D-05, D-06) : autorité de
 * l'institut et certificat du serveur fabriqués par le vrai script dans un
 * dossier temporaire. Sautés, avec le motif, si `openssl` ne sait pas faire
 * (sur Ubuntu 24.04, OpenSSL 3 du système convient ; sur macOS, OpenSSL de
 * Homebrew ou LibreSSL de /usr/bin, choisi par LAMA_OPENSSL).
 */

const DEPLOY = new URL("../../../deploy/", import.meta.url).pathname;
const skip = opensslManquant() ?? false;
const dossier = () => mkdtempSync(join(tmpdir(), "lama-certificat-"));
const cert = (file: string) => new X509Certificate(readFileSync(file));
const mode = (file: string) => statSync(file).mode & 0o777;
const jours = (c: X509Certificate) => Math.round((Date.parse(c.validTo) - Date.parse(c.validFrom)) / 86_400_000);
const verifie = (tls: string, file: string) => spawnSync(OPENSSL, ["verify", "-CAfile", join(tls, "autorite.crt"), file], { encoding: "utf8" });

test("autorité de 10 ans et certificat du serveur de 397 jours pour lama.local et l'adresse fixe, droits restreints", { skip }, () => {
  const tls = fabriquerCertificats(dossier(), "192.168.1.50");
  const autorite = cert(join(tls, "autorite.crt"));
  const serveur = cert(join(tls, "serveur.crt"));
  assert.equal(autorite.ca, true);
  assert.equal(jours(autorite), 3650);
  assert.match(autorite.subject, /CN=Autorité de lama \d{8}-[0-9a-f]{8}/);
  assert.equal(serveur.ca, false);
  assert.equal(jours(serveur), 397);
  assert.equal(serveur.subjectAltName, "DNS:lama.local, IP Address:192.168.1.50");
  // Courbe nommée P-256, jamais des paramètres explicites (LibreSSL les écrit sans ec_param_enc, et iOS comme OpenSSL 3 les refusent).
  for (const c of [autorite, serveur]) assert.equal(c.publicKey.asymmetricKeyDetails?.namedCurve, "prime256v1");
  assert.ok(serveur.checkIssued(autorite) && serveur.verify(autorite.publicKey), "signé par l'autorité");
  assert.equal(verifie(tls, join(tls, "serveur.crt")).status, 0);
  const texte = execFileSync(OPENSSL, ["x509", "-in", join(tls, "autorite.crt"), "-noout", "-text"], { encoding: "utf8" });
  assert.match(texte, /X509v3 Name Constraints: critical/);
  for (const permis of ["DNS:lama.local", "IP:10.0.0.0/255.0.0.0", "IP:172.16.0.0/255.240.0.0", "IP:192.168.0.0/255.255.0.0"]) assert.ok(texte.includes(permis), permis);
  assert.equal(mode(tls), 0o750);
  assert.equal(mode(join(tls, "autorite.key")), 0o600, "clé de l'autorité : root seulement");
  assert.equal(mode(join(tls, "serveur.key")), 0o640, "clé du serveur : root et le groupe lama");
  assert.equal(mode(join(tls, "autorite.crt")), 0o644);
  assert.equal(readFileSync(join(tls, "adresse"), "utf8"), "192.168.1.50\n");
});

test("contrainte de noms : un certificat pour un autre nom ou une adresse publique, signé par l'autorité, est refusé par openssl verify", { skip }, () => {
  const dir = dossier();
  const tls = fabriquerCertificats(dir);
  for (const name of ["exemple.com", "lama.local.exemple.com", "8.8.8.8"]) {
    signer(tls, { name, days: 30, out: join(dir, "hors.crt") });
    const r = verifie(tls, join(dir, "hors.crt"));
    assert.notEqual(r.status, 0, name);
    assert.match(`${r.stdout}${r.stderr}`, /permitted subtree violation/, name);
  }
  for (const name of ["lama.local", "10.1.2.3", "172.20.0.5"]) {
    signer(tls, { name, days: 30, out: join(dir, "dans.crt") });
    assert.equal(verifie(tls, join(dir, "dans.crt")).status, 0, name);
  }
});

test("--renouveler : refait le certificat sous 90 jours, pas au-delà ; --forcer le refait toujours ; même autorité", { skip }, () => {
  const tls = fabriquerCertificats(dossier());
  const empreinte = cert(join(tls, "autorite.crt")).fingerprint256;
  const serie = () => cert(join(tls, "serveur.crt")).serialNumber;

  signer(tls, { name: "lama.local", days: 91, out: join(tls, "serveur.crt") });
  const avant = serie();
  const rien = lancer(tls, ["--renouveler"]);
  assert.equal(rien.status, 0, rien.stderr);
  assert.match(rien.stdout, /rien à faire/);
  assert.equal(serie(), avant, "91 jours restants : gardé");

  signer(tls, { name: "lama.local", days: 89, out: join(tls, "serveur.crt") });
  const proche = serie();
  const fait = lancer(tls, ["--renouveler"]);
  assert.equal(fait.status, 0, fait.stderr);
  assert.match(fait.stdout, /renouvelé pour lama\.local et 192\.168\.1\.50/);
  assert.notEqual(serie(), proche, "89 jours restants : refait");
  assert.equal(jours(cert(join(tls, "serveur.crt"))), 397);

  const neuf = serie();
  assert.equal(lancer(tls, ["--renouveler", "--forcer"]).status, 0);
  assert.notEqual(serie(), neuf, "--forcer : refait même neuf");
  assert.equal(cert(join(tls, "autorite.crt")).fingerprint256, empreinte, "l'autorité ne change jamais");
});

test("--renouveler : un certificat que l'autorité refuse (abîmé, hors contrainte) est refait sans attendre le seuil", { skip }, () => {
  const tls = fabriquerCertificats(dossier());
  signer(tls, { name: "exemple.com", days: 300, out: join(tls, "serveur.crt") });
  assert.equal(lancer(tls, ["--renouveler"]).status, 0);
  assert.equal(cert(join(tls, "serveur.crt")).subjectAltName, "DNS:lama.local, IP Address:192.168.1.50");
});

test("--adresse : nouvelle adresse fixe, même autorité, l'ancien certificat remplacé", { skip }, () => {
  const tls = fabriquerCertificats(dossier(), "192.168.1.50");
  const empreinte = cert(join(tls, "autorite.crt")).fingerprint256;
  const r = lancer(tls, ["--adresse", "10.0.0.20"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(cert(join(tls, "serveur.crt")).subjectAltName, "DNS:lama.local, IP Address:10.0.0.20");
  assert.equal(cert(join(tls, "autorite.crt")).fingerprint256, empreinte);
  assert.equal(readFileSync(join(tls, "adresse"), "utf8"), "10.0.0.20\n");
  assert.ok(r.stdout.includes(empreinte), "empreinte de l'autorité affichée");
});

test("--etat : empreinte de l'autorité, adresse et échéance du certificat", { skip }, () => {
  const tls = fabriquerCertificats(dossier());
  const r = lancer(tls, ["--etat"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(cert(join(tls, "autorite.crt")).fingerprint256));
  assert.match(r.stdout, /Certificat du serveur pour lama\.local et 192\.168\.1\.50, valable jusqu'au /);
  assert.doesNotMatch(r.stdout, /À renouveler/);
});

test("refus lisibles : adresse publique ou mal formée, renouvellement sans autorité, option inconnue ; rien n'est créé", { skip }, () => {
  const dir = dossier();
  const tls = join(dir, "tls");
  for (const ip of ["8.8.8.8", "192.169.1.1", "172.32.0.1", "10.0.0", "300.1.1.1", "192.168.001.050", "10.0.0.01", ""]) {
    const r = lancer(tls, ["--adresse", ip]);
    assert.equal(r.status, 1, ip);
    assert.match(r.stderr, /Adresse refusée/, ip);
  }
  assert.equal(existsSync(tls), false);
  assert.match(lancer(tls, ["--renouveler"]).stderr, /Aucune autorité/);
  assert.match(lancer(tls, ["--etat"]).stderr, /Aucune autorité/);
  assert.match(lancer(tls, ["--supprimer"]).stderr, /Option inconnue --supprimer/);
  assert.match(lancer(tls, []).stderr, /Indiquez --adresse IP, --renouveler ou --etat/);
});

test("--renouveler : clé du serveur absente ou d'une autre paire, le certificat est refait", { skip }, () => {
  const tls = fabriquerCertificats(dossier());
  const serie = () => cert(join(tls, "serveur.crt")).serialNumber;
  const avant = serie();
  rmSync(join(tls, "serveur.key"));
  assert.equal(lancer(tls, ["--renouveler"]).status, 0);
  assert.notEqual(serie(), avant, "clé absente : refait");
  assert.ok(existsSync(join(tls, "serveur.key")));
  assert.equal(mode(join(tls, "serveur.key")), 0o640);
  const bonne = serie();
  const autre = dossier();
  const tls2 = fabriquerCertificats(autre);
  execFileSync("cp", [join(tls2, "serveur.key"), join(tls, "serveur.key")]);
  assert.equal(lancer(tls, ["--renouveler"]).status, 0);
  assert.notEqual(serie(), bonne, "paire mêlée : refait");
  assert.equal(execFileSync(OPENSSL, ["pkey", "-in", join(tls, "serveur.key"), "-pubout"], { encoding: "utf8" }), execFileSync(OPENSSL, ["x509", "-in", join(tls, "serveur.crt"), "-noout", "-pubkey"], { encoding: "utf8" }));
});

test("échec d'openssl : message lisible avec ce qu'openssl a dit, aucun dossier de travail laissé", { skip }, () => {
  const dir = dossier();
  const tls = fabriquerCertificats(dir);
  const faux = join(dir, "openssl-faux");
  writeFileSync(faux, `#!/bin/sh\nif [ "$1" = x509 ] && [ "$2" = -req ]; then echo "panne simulée" >&2; exit 1; fi\nexec "${OPENSSL}" "$@"\n`);
  chmodSync(faux, 0o755);
  const avant = readFileSync(join(tls, "serveur.crt"), "utf8");
  const r = lancer(tls, ["--renouveler", "--forcer"], { LAMA_OPENSSL: faux });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Échec de la signature du certificat du serveur avec openssl/);
  assert.match(r.stderr, /panne simulée/);
  assert.deepEqual(readdirSync(tls).filter((f) => f.startsWith(".") && f !== ".verrou"), [], "dossier de travail effacé");
  assert.equal(readFileSync(join(tls, "serveur.crt"), "utf8"), avant, "certificat en place intact");
  // Même chose à la création de l'autorité.
  const neuf = join(dir, "neuf");
  const faux2 = join(dir, "openssl-faux2");
  writeFileSync(faux2, `#!/bin/sh\nif [ "$1" = req ]; then echo "panne autorité" >&2; exit 1; fi\nexec "${OPENSSL}" "$@"\n`);
  chmodSync(faux2, 0o755);
  const r2 = lancer(neuf, ["--adresse", "192.168.1.50"], { LAMA_OPENSSL: faux2 });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /Échec de la fabrication du certificat de l'autorité/);
  assert.deepEqual(readdirSync(neuf).filter((f) => f !== ".verrou"), [], "rien laissé");
});

test("autorité incomplète (un seul des deux fichiers) : arrêt net, jamais remplacée en silence", { skip }, () => {
  for (const manquant of ["autorite.key", "autorite.crt"]) {
    const tls = fabriquerCertificats(dossier());
    rmSync(join(tls, manquant));
    const reste = manquant === "autorite.key" ? "autorite.crt" : "autorite.key";
    const avant = readFileSync(join(tls, reste), "utf8");
    for (const args of [["--adresse", "10.0.0.20"], ["--renouveler"]]) {
      const r = lancer(tls, args);
      assert.equal(r.status, 1, `${manquant} ${args[0]}`);
      assert.match(r.stderr, /L'autorité de .* est incomplète/);
      assert.equal(existsSync(join(tls, manquant)), false, "rien recréé");
      assert.equal(readFileSync(join(tls, reste), "utf8"), avant);
    }
  }
});

test("sans sudo, la commande refuse (hors essai)", { skip: process.getuid?.() === 0 ? "lancé en root" : false }, () => {
  const r = spawnSync("bash", [SCRIPT, "--etat"], { env: { ...process.env, LAMA_LANGUE: "fr", LAMA_ESSAI_SANS_ROOT: "0" }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Lancez cette commande avec sudo/);
});

test("horloge fausse (avant le plancher) : aucun certificat daté ainsi", () => {
  const plausible = (plancher: string) => spawnSync("bash", ["-c", `source '${SCRIPT}'; PLANCHER=${plancher}; heure_plausible`]).status;
  assert.equal(plausible("2000-01-01"), 0);
  assert.equal(plausible("2999-01-01"), 1);
  assert.match(readFileSync(SCRIPT, "utf8"), /^heure_plausible \|\| echec/m);
});

test("mise en place par renommage, la clé avant le certificat : le serveur ne voit jamais une paire mêlée", () => {
  const s = readFileSync(SCRIPT, "utf8");
  const cle = s.indexOf('mv -f "$TRAVAIL/serveur.key" "$DOSSIER/serveur.key"');
  const crt = s.indexOf('mv -f "$TRAVAIL/serveur.crt" "$DOSSIER/serveur.crt"');
  assert.ok(cle > 0 && crt > cle);
  assert.match(s, /^ICI="\$\(dirname "\$\(readlink -f "\$\{BASH_SOURCE\[0\]\}"\)"\)"$/m, "lancé par son lien de /usr/local/sbin, langue.sh est trouvé à côté du vrai fichier");
});

test("lancé par un lien symbolique (comme /usr/local/sbin/lama-certificat), il trouve langue.sh", { skip }, () => {
  const dir = dossier();
  const lien = join(dir, "lama-certificat");
  execFileSync("ln", ["-s", SCRIPT, lien]);
  const r = spawnSync(lien, ["--adresse", "192.168.1.60"], { env: { ...process.env, LAMA_ESSAI_SANS_ROOT: "1", LAMA_LANGUE: "fr", LAMA_TLS_DIR: join(dir, "tls"), LAMA_OPENSSL: OPENSSL }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("tâche mensuelle : renouvellement au seuil le 1er du mois, rattrapé après une coupure, en root", () => {
  const timer = readFileSync(join(DEPLOY, "systemd/lama-certificat.timer"), "utf8");
  assert.match(timer, /^OnCalendar=\*-\*-01 03:30:00 Africa\/Douala$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
  const service = readFileSync(join(DEPLOY, "systemd/lama-certificat.service"), "utf8");
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^Wants=time-sync\.target$/m);
  assert.match(service, /^After=time-sync\.target$/m);
  assert.match(service, /^ExecStart=\/usr\/local\/sbin\/lama-certificat --renouveler$/m);
  assert.doesNotMatch(service, /^User=/m, "root : la clé de l'autorité n'est lisible que par root");
  assert.ok(statSync(SCRIPT).mode & 0o100, "le script est exécutable (lien de /usr/local/sbin)");
});
