import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { OPENSSL, opensslManquant } from "./tls/essai-certificats.ts";

/**
 * Installation et mise à jour, partie HTTPS et heure (distribution D-05 à
 * D-07, D-10, D-12) : règle polkit éprouvée par son propre code, adresse du
 * serveur avec une commande ip simulée, certificat fait puis renouvelé par
 * installer_https_heure dans un dossier temporaire (ln, install et
 * timedatectl simulés), ordre des étapes dans les scripts.
 */

const DEPLOY = new URL("../../deploy/", import.meta.url).pathname;
const RACINE = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const read = (name: string) => readFileSync(join(DEPLOY, name), "utf8");

/** Décision de la règle polkit pour une action et un compte (même code que polkitd exécute). */
function decision(actionId: string, user: string): string {
  let regle: ((action: { id: string }, subject: { user: string }) => string) | null = null;
  const polkit = { Result: { YES: "yes", NO: "no", NOT_HANDLED: "not_handled" }, addRule: (f: typeof regle) => { regle = f; } };
  runInNewContext(read("polkit/50-lama-heure.rules"), { polkit });
  return regle!({ id: actionId }, { user });
}

test("règle polkit : le compte lama règle l'heure et la synchronisation, rien d'autre ; aucun autre compte", () => {
  assert.equal(decision("org.freedesktop.timedate1.set-time", "lama"), "yes");
  assert.equal(decision("org.freedesktop.timedate1.set-ntp", "lama"), "yes");
  for (const action of ["org.freedesktop.timedate1.set-timezone", "org.freedesktop.timedate1.set-local-rtc", "org.freedesktop.login1.reboot", "org.freedesktop.systemd1.manage-units"]) {
    assert.equal(decision(action, "lama"), "not_handled", action);
  }
  for (const user of ["technicien", "root", "lama-formation", "www-data"]) assert.equal(decision("org.freedesktop.timedate1.set-time", user), "not_handled", user);
});

test("adresse du serveur : celle de la route par défaut ; vide sans route", () => {
  const essai = (stub: string) => spawnSync("bash", ["-c", `source '${join(DEPLOY, "https-heure.sh")}'; ip() { ${stub}; }; adresse_actuelle`], { encoding: "utf8" }).stdout;
  assert.equal(essai("echo '1.1.1.1 via 192.168.1.1 dev enp1s0 src 192.168.1.50 uid 0'; echo '    cache'"), "192.168.1.50\n");
  assert.equal(essai("return 2"), "");
});

test("installer_https_heure : commande liée, règle polkit posée, heure synchronisée, certificat fait pour l'adresse puis renouvelé au seuil", { skip: opensslManquant() ?? false }, () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-installer-https-"));
  const lancer = () => spawnSync("bash", ["-c", [
    `source '${join(DEPLOY, "https-heure.sh")}'`,
    `ln() { echo "ln $*" >> '${dir}/journal'; }`,
    `install() { echo "install $*" >> '${dir}/journal'; }`,
    `timedatectl() { echo "timedatectl $*" >> '${dir}/journal'; }`,
    `installer_https_heure '${RACINE}' '${dir}/conf'`,
  ].join("\n")], { encoding: "utf8", env: { ...process.env, LAMA_ESSAI_SANS_ROOT: "1", LAMA_LANGUE: "fr", LAMA_ADRESSE: "192.168.1.77", LAMA_OPENSSL: OPENSSL, LAMA_POLKIT_DIR: `${dir}/polkit` } });
  const premier = lancer();
  assert.equal(premier.status, 0, premier.stderr);
  assert.match(premier.stdout, /Réservez l'adresse 192\.168\.1\.77 à ce serveur dans la box/);
  const cert = () => new X509Certificate(readFileSync(join(dir, "conf/tls/serveur.crt")));
  assert.equal(cert().subjectAltName, "DNS:lama.local, IP Address:192.168.1.77");
  const serie = cert().serialNumber;
  assert.deepEqual(readFileSync(join(dir, "journal"), "utf8").trim().split("\n"), [
    "ln -sfn /opt/lama/actuelle/deploy/lama-certificat.sh /usr/local/sbin/lama-certificat",
    `install -d -m 0755 ${dir}/polkit`,
    `install -m 0644 ${RACINE}/deploy/polkit/50-lama-heure.rules ${dir}/polkit/50-lama-heure.rules`,
    "timedatectl set-ntp true",
  ]);
  const second = lancer();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /rien à faire/);
  assert.equal(cert().serialNumber, serie, "réinstallation : certificat gardé tant qu'il reste plus de 90 jours");
  const annonce = spawnSync("bash", ["-c", `source '${join(DEPLOY, "https-heure.sh")}'; annoncer_https '${RACINE}' '${dir}/conf'`], { encoding: "utf8", env: { ...process.env, LAMA_ESSAI_SANS_ROOT: "1", LAMA_LANGUE: "fr", LAMA_OPENSSL: OPENSSL } });
  assert.equal(annonce.status, 0, annonce.stderr);
  assert.match(annonce.stdout, /ouvrez d'abord http:\/\/lama\.local\/certificat \(ou http:\/\/192\.168\.1\.77\/certificat\)/);
  assert.match(annonce.stdout, /Empreinte SHA-256 de l'autorité, à comparer sur chaque appareil\n {2}([0-9A-F]{2}:){31}[0-9A-F]{2}\n/);
  assert.match(annonce.stdout, /dans les 30 jours/);
});

/** Lance une fonction de https-heure.sh avec des commandes simulées, en français. */
function shell(script: string, env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", `source '${join(DEPLOY, "https-heure.sh")}'\n${script}`], { encoding: "utf8", env: { ...process.env, LAMA_LANGUE: "fr", ...env } });
}

test("installer_https_heure : dossier polkit existant laissé tel quel ; lama-certificat appelé sans relance", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-polkit-"));
  mkdirSync(join(dir, "version/deploy/polkit"), { recursive: true });
  mkdirSync(join(dir, "regles"));
  writeFileSync(join(dir, "version/deploy/polkit/50-lama-heure.rules"), "");
  writeFileSync(join(dir, "version/deploy/lama-certificat.sh"), `#!/usr/bin/env bash\necho "lama-certificat $* relance=\${LAMA_SANS_RELANCE:-0}" >> '${dir}/journal'\n`);
  chmodSync(join(dir, "version/deploy/lama-certificat.sh"), 0o755);
  const r = shell([
    `ln() { :; }; timedatectl() { :; }`,
    `install() { echo "install $*" >> '${dir}/journal'; }`,
    `installer_https_heure '${dir}/version' '${dir}/conf'`,
  ].join("\n"), { LAMA_ADRESSE: "192.168.1.77", LAMA_POLKIT_DIR: join(dir, "regles") });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(join(dir, "journal"), "utf8").trim().split("\n"), [
    `install -m 0644 ${dir}/version/deploy/polkit/50-lama-heure.rules ${dir}/regles/50-lama-heure.rules`,
    "lama-certificat --adresse 192.168.1.77 relance=1",
  ]);
});

test("lama-certificat : relance de lama sautée avec LAMA_SANS_RELANCE=1", () => {
  const essai = (sansRelance: string) => spawnSync("bash", ["-c", [
    `source '${join(DEPLOY, "lama-certificat.sh")}'`,
    `id() { echo 0; }; systemctl() { echo "systemctl $*"; }`,
    "relancer_lama",
  ].join("\n")], { encoding: "utf8", env: { ...process.env, LAMA_LANGUE: "fr", LAMA_ESSAI_SANS_ROOT: "0", LAMA_SANS_RELANCE: sansRelance } }).stdout;
  assert.equal(essai("0"), "Service lama relancé avec le nouveau certificat.\n");
  assert.equal(essai("1"), "");
});

test("mise à jour : paquets manquants installés si possible, sinon listés avec leur conséquence, sans arrêt", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-paquets-"));
  const essai = (installes: string, aptReussit: boolean) => {
    writeFileSync(join(dir, "installes"), installes);
    writeFileSync(join(dir, "apt"), "");
    return shell([
      `dpkg() { grep -qx "$2" '${dir}/installes'; }`,
      `apt-get() { echo "$*" >> '${dir}/apt'; ${aptReussit ? `shift 3; printf '%s\\n' "$@" >> '${dir}/installes'` : "return 100"}; }`,
      "assurer_paquets",
      "echo fin",
    ].join("\n"));
  };
  const tout = "openssl\npolkitd\nsystemd-timesyncd\n";
  let r = essai(tout, false);
  assert.equal(r.stdout, "fin\n");
  assert.equal(readFileSync(join(dir, "apt"), "utf8"), "", "rien à installer : apt-get pas appelé");
  r = essai("openssl\n", true);
  assert.equal(readFileSync(join(dir, "apt"), "utf8"), "install -y -q polkitd systemd-timesyncd\n");
  assert.equal(r.stdout, "fin\n", "installés en ligne : aucun message");
  r = essai("systemd-timesyncd\n", false);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Paquets manquants, non installés \(pas d'internet\u00a0\?\)\u00a0: openssl polkitd\. La mise à jour continue\./);
  assert.match(r.stdout, /Sans openssl, pas de certificat\u00a0: lama reste en http\./);
  assert.match(r.stdout, /Sans polkitd, Réglages, Heure est refusé\u00a0: l'heure ne se règle qu'avec sudo timedatectl set-time\./);
  assert.doesNotMatch(r.stdout, /Sans systemd-timesyncd/);
  assert.match(r.stdout, /sudo apt-get install openssl polkitd, puis relancez la mise à jour\.\nfin\n$/);
});

test("lama_repond : en http, seule une réponse 200 compte (pas la 301 du port 80) ; en https avec l'autorité quand la paire existe", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-repond-"));
  const essai = (curl: string, mode = "") => shell(`sleep() { :; }; curl() { ${curl}; }; lama_repond '${dir}' ${mode} && echo oui || echo non`).stdout;
  assert.equal(essai("echo 301"), "non\n");
  assert.equal(essai("echo 200"), "oui\n");
  mkdirSync(join(dir, "tls"));
  writeFileSync(join(dir, "tls/serveur.crt"), "");
  assert.equal(essai(`case "$*" in *https://*) return 7;; *) echo 200;; esac`), "non\n", "paire présente : http ne suffit pas");
  assert.equal(essai(`case "$*" in *https://lama.local*) return 0;; *) return 7;; esac`), "oui\n");
  assert.equal(essai(`case "$*" in *https://*) return 7;; *) echo 301;; esac`, "ou-http"), "non\n", "retour arrière : la 301 d'une version en https ne compte pas");
  assert.equal(essai(`case "$*" in *https://*) return 7;; *) echo 200;; esac`, "ou-http"), "oui\n", "retour arrière vers une version d'avant le HTTPS");
});

test("installation : paquets, étape HTTPS et heure après la confirmation des clés et le programme, avant le disque et les services ; tâche mensuelle ; vérification en https", () => {
  const s = read("installer.sh");
  assert.match(s, /^apt-get install -y -q [^\n]*\bopenssl polkitd systemd-timesyncd$/m);
  assert.match(s, /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/https-heure\.sh"/);
  const etape = s.indexOf('installer_https_heure "$APP/actuelle" "$CONF" || echec');
  assert.ok(etape > s.indexOf("tapez OUI"), "après la confirmation des clés");
  assert.ok(etape > s.indexOf('ln -sfn "$APP/versions/$VERSION" "$APP/actuelle"'), "après la mise en place du programme");
  assert.ok(etape < s.indexOf('etape "$(msg "Disque de sauvegarde USB"') && etape < s.indexOf('etape "$(msg "Services"'), "avant le démarrage du service");
  assert.match(s, /"\$APP\/actuelle\/deploy\/systemd\/lama-certificat\.service" "\$APP\/actuelle\/deploy\/systemd\/lama-certificat\.timer" \/etc\/systemd\/system\//);
  assert.match(s, /^systemctl enable lama\.service lama-sauvegarde\.timer lama-certificat\.timer$/m);
  assert.match(s, /^lama_repond "\$CONF" \|\| echec/m);
  assert.match(s, /^curl -fsS --max-time 5 http:\/\/127\.0\.0\.1\/certificat /m, "page du certificat joignable en http");
  assert.match(s, /http:\/\/\$NOM_RESEAU\.local\/certificat/);
  const h = read("https-heure.sh");
  assert.match(h, /ln -sfn \/opt\/lama\/actuelle\/deploy\/lama-certificat\.sh \/usr\/local\/sbin\/lama-certificat/);
  assert.match(h, /curl -fsS --max-time 5 --cacert "\$CONF_ARG\/tls\/autorite\.crt" --resolve lama\.local:443:127\.0\.0\.1 https:\/\/lama\.local\/api\/auth\/state/);
});

test("mise à jour : certificat fait ou renouvelé et tâche activée avant le redémarrage ; retour arrière accepté en http (version d'avant le HTTPS)", () => {
  const s = read("mettre-a-jour.sh");
  const etape = s.indexOf('installer_https_heure "$APP/versions/$VERSION" "$CONF" ||');
  assert.ok(etape > 0 && etape < s.indexOf('ln -sfn "$APP/versions/$VERSION" "$APP/actuelle"') && etape < s.indexOf("systemctl restart lama.service"));
  assert.match(s, /systemctl enable lama-certificat\.timer/);
  assert.match(s, /^repond\(\) \{ lama_repond "\$CONF" "\$\{1:-\}"; \}$/m);
  assert.match(s, /repond ou-http \|\| echec/);
  assert.match(read("https-heure.sh"), /\[ "\$MODE" = "ou-http" \]/);
  const paquets = s.indexOf("\n  assurer_paquets\n");
  const avant = s.indexOf('[ -f "$CONF/tls/serveur.crt" ] && AVAIT_HTTPS=1');
  assert.ok(paquets > 0 && paquets < etape, "paquets assurés avant le certificat");
  assert.ok(avant > 0 && avant < etape, "paire notée avant le certificat");
  const annonce = s.indexOf('if [ "$AVAIT_HTTPS" = 0 ] && [ -f "$CONF/tls/serveur.crt" ]; then\n    annoncer_https "$APP/actuelle" "$CONF"');
  assert.ok(annonce > s.indexOf("lama est à jour, version"), "passage au https annoncé en fin de mise à jour");
});

test("installation et restauration : état du certificat par son chemin, sans faire échouer ; restauration vérifiée par lama_repond", () => {
  assert.match(read("installer.sh"), /^"\$APP\/actuelle\/deploy\/lama-certificat\.sh" --etat \|\| true$/m);
  assert.doesNotMatch(read("installer.sh"), /^lama-certificat --etat/m);
  const r = read("restaurer.sh");
  assert.match(r, /^source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/https-heure\.sh"$/m);
  assert.match(r, /^repond\(\) \{ lama_repond \/etc\/lama; \}$/m);
  assert.doesNotMatch(r, /http:\/\/127\.0\.0\.1/);
});

test("service : https sur 443 par défaut (aucun LAMA_PORT), certificat lu dans /etc/lama/tls, port 80 sans root", () => {
  const unit = read("systemd/lama.service");
  assert.doesNotMatch(unit, /LAMA_PORT|LAMA_HTTP_PORT/);
  assert.match(unit, /^AmbientCapabilities=CAP_NET_BIND_SERVICE$/m);
  assert.match(unit, /^ReadOnlyPaths=\/etc\/lama$/m);
});

test("procédures du technicien : certificat HTTPS et heure du serveur, dans les deux langues", () => {
  const fr = read("LISEZMOI.md");
  const en = read("README.md");
  for (const titre of ["## Certificat HTTPS", "## Heure du serveur"]) assert.ok(fr.includes(titre), titre);
  for (const titre of ["## HTTPS certificate", "## Server time", "### First update to HTTPS"]) assert.ok(en.includes(titre), titre);
  assert.ok(fr.includes("### Première mise à jour vers HTTPS"));
  assert.match(fr, /empreinte de l'autorité affichée sur l'appareil à celle qu'a imprimée l'installateur/);
  assert.match(en, /authority fingerprint shown on the device with the one printed by the installer/);
  for (const doc of [fr, en]) {
    assert.match(doc, /http:\/\/lama\.local\/certificat/);
    assert.match(doc, /sudo lama-certificat --adresse 192\.168\.1\.60/);
    assert.match(doc, /50-lama-heure\.rules/);
    assert.doesNotMatch(doc, /\u2014/);
    assert.match(doc, /30(\u00a0| )(jours|days)/, "session et déclaration gardées 30 jours après le premier démarrage en https");
  }
});

test("autorité approuvée par le serveur lui-même : magasin du système et règle de Firefox complétée, jamais écrasée (21/10/2026)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-autorite-locale-"));
  mkdirSync(join(dir, "conf", "tls"), { recursive: true });
  writeFileSync(join(dir, "conf", "tls", "autorite.crt"), "-----BEGIN CERTIFICATE-----\nessai\n-----END CERTIFICATE-----\n");
  const firefox = join(dir, "etc", "firefox", "policies");
  mkdirSync(firefox, { recursive: true });
  writeFileSync(join(firefox, "policies.json"), JSON.stringify({ policies: { DisableTelemetry: true, Certificates: { Install: ["autre.crt"] } } }));
  // Magasin du système simulé : update-ca-certificates existe sur Linux (machine de GitHub) et exige root.
  const env = { LAMA_CA_SYSTEME_DIR: join(dir, "systeme"), LAMA_FIREFOX_POLICIES_DIR: firefox, LAMA_MAJ_MAGASIN: "true" };
  for (let i = 0; i < 2; i++) assert.equal(shell(`umask 077; approuver_autorite_localement '${dir}/conf'`, env).status, 0, `passage ${i + 1}`);
  assert.equal(statSync(join(firefox, "policies.json")).mode & 0o777, 0o644, "lisible par Firefox malgré un umask strict");
  const neuf = join(dir, "neuf", "firefox", "policies");
  assert.equal(shell(`umask 077; approuver_autorite_localement '${dir}/conf'`, { ...env, LAMA_FIREFOX_POLICIES_DIR: neuf }).status, 0);
  for (const d of [join(dir, "neuf", "firefox"), neuf]) assert.equal(statSync(d).mode & 0o777, 0o755, `${d} créé lisible`);
  assert.match(readFileSync(join(dir, "systeme", "lama-autorite.crt"), "utf8"), /BEGIN CERTIFICATE/);
  assert.match(readFileSync(join(firefox, "lama-autorite.crt"), "utf8"), /BEGIN CERTIFICATE/);
  const regles = JSON.parse(readFileSync(join(firefox, "policies.json"), "utf8"));
  assert.deepEqual(regles, { policies: { DisableTelemetry: true, Certificates: { Install: ["autre.crt", join(firefox, "lama-autorite.crt")] } } }, "règles gardées, certificat ajouté une seule fois");

  writeFileSync(join(firefox, "policies.json"), "{ illisible");
  assert.equal(shell(`approuver_autorite_localement '${dir}/conf'`, env).status, 1, "règle illisible : échec signalé");
  assert.equal(readFileSync(join(firefox, "policies.json"), "utf8"), "{ illisible", "jamais écrasée");
  assert.equal(shell(`approuver_autorite_localement '${dir}/sans-certificat'`, env).status, 0, "sans autorité : rien à faire");
});

test("installation et mise à jour : l'autorité est approuvée par le serveur juste après le certificat, sans arrêter en cas d'échec", () => {
  for (const nom of ["installer.sh", "mettre-a-jour.sh"]) {
    const s = readFileSync(join(DEPLOY, nom), "utf8");
    const certificat = s.indexOf("installer_https_heure \"$APP/");
    const autorite = s.indexOf('approuver_autorite_localement "$CONF" || echo');
    assert.ok(certificat > 0 && autorite > certificat, nom);
  }
});
