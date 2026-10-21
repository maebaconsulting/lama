import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { englishFaults, frenchFaults } from "../client/i18n/typography.ts";
import { opensslEssai, paireEssai, preparerVersionEssai, SANS_OPENSSL } from "./deploy-essais.ts";

// Les attentes historiques de ce fichier sont en français : les scripts
// essayés ici (processus enfants) le parlent quelle que soit la langue du Mac
// de développement. Les essais en anglais posent LAMA_LANGUE=en eux-mêmes.
process.env.LAMA_LANGUE = "fr";

/** Environnement d'un essai : celui du processus, sans LANG ni LAMA_LANGUE, plus `vars`. */
function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.LANG;
  delete env.LC_ALL;
  delete env.LAMA_LANGUE;
  return { ...env, ...vars };
}

/** Langue, mot OUI et mot EFFACER choisis par deploy/langue.sh sous `vars`. */
function langueDesScripts(vars: Record<string, string>): string {
  return execFileSync("bash", ["-c", `source '${join(DEPLOY, "langue.sh")}'; printf '%s %s %s' "$LANGUE" "$MOT_OUI" "$MOT_EFFACER"`], { env: envWith(vars), encoding: "utf8" });
}

const DEPLOY = new URL("../../deploy/", import.meta.url).pathname;
const read = (name: string) => readFileSync(join(DEPLOY, name), "utf8");
const scripts = () => readdirSync(DEPLOY).filter((n) => n.endsWith(".sh"));

// Exécute uniquement la fonction disque_refuse de preparer-disque.sh (jamais le
// reste du script, protégé par un garde-fou BASH_SOURCE), avec une commande
// lsblk simulée par le script d'essai lui-même. Ne touche à aucun disque réel.
function essaiDisqueRefuse(lsblkStub: string, disque: string): { refuse: boolean; motif: string } {
  const dir = mkdtempSync(join(tmpdir(), "lama-disque-refuse-"));
  const script = join(dir, "essai.sh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash\nset -euo pipefail\nlsblk() {\n${lsblkStub}\n}\nsource '${join(DEPLOY, "preparer-disque.sh")}'\nif MOTIF="$(disque_refuse '${disque}')"; then printf 'REFUS\\n%s' "$MOTIF"; else printf 'ACCEPTE'; fi\n`,
  );
  const sortie = execFileSync("bash", [script], { encoding: "utf8" });
  const separateur = sortie.indexOf("\n");
  if (separateur === -1) return { refuse: false, motif: "" };
  return { refuse: sortie.slice(0, separateur) === "REFUS", motif: sortie.slice(separateur + 1) };
}

// Exécute uniquement copie_avant_migration de mettre-a-jour.sh (jamais le reste
// du script, protégé par le même garde-fou BASH_SOURCE que disque_refuse). Ne
// touche à aucun service ni base réelle : dossier et témoin sont fabriqués par
// l'essai lui-même dans le répertoire temporaire du système.
function essaiCopieAvantMigration(dossier: string, temoin: string): string {
  const dir = mkdtempSync(join(tmpdir(), "lama-copie-avant-migration-essai-"));
  const script = join(dir, "essai.sh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash\nset -euo pipefail\nsource '${join(DEPLOY, "mettre-a-jour.sh")}'\ncopie_avant_migration '${dossier}' '${temoin}'\n`,
  );
  return execFileSync("bash", [script], { encoding: "utf8" }).trim();
}

// Exécute uniquement systeme_non_identifie de preparer-disque.sh (jamais le
// reste du script), avec une commande lsblk simulée. Ne touche à aucun disque réel.
function essaiSystemeNonIdentifie(lsblkStub: string): boolean {
  const dir = mkdtempSync(join(tmpdir(), "lama-systeme-"));
  const script = join(dir, "essai.sh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash\nset -euo pipefail\nlsblk() {\n${lsblkStub}\n}\nsource '${join(DEPLOY, "preparer-disque.sh")}'\nif systeme_non_identifie; then exit 0; else exit 1; fi\n`,
  );
  try {
    execFileSync("bash", [script]);
    return true;
  } catch (erreur) {
    if ((erreur as { status?: number }).status === 1) return false;
    throw erreur;
  }
}

test("chaque script est lisible par bash et s'arrête à la première erreur", () => {
  assert.ok(scripts().length >= 1);
  for (const name of scripts()) {
    const text = read(name);
    assert.match(text, /^#!\/usr\/bin\/env bash\n/, name);
    assert.match(text, /^set -euo pipefail$/m, name);
    execFileSync("bash", ["-n", join(DEPLOY, name)]);
  }
});

test("messages des scripts : ni ponctuation haute après une espace ordinaire, ni tiret cadratin", () => {
  for (const name of scripts()) {
    const text = read(name);
    assert.doesNotMatch(text, /\u2014/, `${name} : tiret cadratin`);
    text.split("\n").forEach((line, i) => {
      if (!/\b(echo|printf|echec|etape)\b/.test(line)) return;
      const strings = [...line.matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
      for (const s of strings) assert.doesNotMatch(s, /[\p{L})] [:;!?]/u, `${name}:${i + 1}`);
    });
  }
});

test("l'archive ne part que d'un dépôt propre, sans fichiers cachés du Mac", () => {
  const text = read("fabriquer-paquet.sh");
  assert.match(text, /git status --porcelain/);
  assert.match(text, /COPYFILE_DISABLE=1 tar --no-xattrs /);
  assert.match(text, /cp -R dist dist-server deploy/);
});

test("service : relance automatique, droits réduits, port 80 sans root, arrêt propre", () => {
  const unit = read("systemd/lama.service");
  for (const line of [
    "User=lama", "Group=lama", "Restart=always", "UMask=0077",
    "AmbientCapabilities=CAP_NET_BIND_SERVICE", "CapabilityBoundingSet=CAP_NET_BIND_SERVICE", "NoNewPrivileges=true",
    "ProtectSystem=strict", "ProtectHome=true", "ReadWritePaths=/var/lib/lama -/mnt/lama-sauvegarde",
    "KillSignal=SIGTERM", "WorkingDirectory=/opt/lama/actuelle",
    "Environment=RCLONE_CONFIG=/var/lib/lama/rclone/rclone.conf", "Environment=HOME=/var/lib/lama",
    "ExecStart=/usr/bin/node /opt/lama/actuelle/dist-server/main.mjs", "WantedBy=multi-user.target",
    "StartLimitIntervalSec=0",
  ]) assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"), line);
});

test("sauvegarde de nuit à 2 h, heure de Douala, rattrapée après une coupure", () => {
  const timer = read("systemd/lama-sauvegarde.timer");
  assert.match(timer, /^OnCalendar=\*-\*-\* 02:00:00 Africa\/Douala$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^WantedBy=timers\.target$/m);
  const service = read("systemd/lama-sauvegarde.service");
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^User=lama$/m);
  assert.match(service, /^ExecStart=\/usr\/bin\/node \/opt\/lama\/actuelle\/dist-server\/cli\.mjs sauvegarder$/m);
});

test("installation : disque monté sans bloquer le démarrage, clé privée jamais écrite sur le serveur", () => {
  const s = read("installer.sh");
  assert.match(s, /LABEL=LAMA-SAUVEGARDE \/mnt\/lama-sauvegarde ext4 nofail,[^\n]*x-systemd\.automount/);
  assert.match(s, /^FUSEAU=Africa\/Douala$/m, "Douala par défaut, en mode automatique");
  assert.match(s, /timedatectl set-timezone "\$FUSEAU"/);
  assert.match(s, /^NOM_RESEAU=lama$/m);
  assert.match(s, /install -d -m 0700 -o "\$COMPTE" -g "\$COMPTE" "\$DATA"/);
  assert.match(s, /install -d -m 0750 -o root -g "\$COMPTE" "\$CONF"/);
  assert.doesNotMatch(s, /age-keygen[^\n|]*-o\b/, "age-keygen ne doit pas écrire de fichier");
  assert.doesNotMatch(s, /printf[^|\n]*CLE_PRIVEE[^|\n]*>/, "la clé privée n'est jamais redirigée vers un fichier");
  assert.doesNotMatch(s, /\btee\b/);
  assert.match(s, /Aucun disque étiqueté/, "disque absent : message clair (point de vigilance 5)");
  assert.match(s, /preparer-disque\.sh/);
  // Disque absent : d'abord rebrancher le disque existant et relancer
  // l'installateur (reprise après panne) ; preparer-disque.sh, qui efface,
  // seulement pour un disque neuf, et annoncé comme tel.
  const absent = s.slice(s.indexOf("Aucun disque étiqueté"), s.indexOf('etape "$(msg "Services"'));
  assert.match(absent, /installer\.sh/, "disque existant : relancer l'installateur");
  assert.match(absent, /disque neuf[^\n]*preparer-disque\.sh/i);
  assert.match(absent, /efface/);
  assert.match(s, /tapez OUI/);
});

test("préparation du disque : effacement seulement après confirmation tapée, jamais le disque système", () => {
  const s = read("preparer-disque.sh");
  assert.match(s, /\[ "\$REPONSE" = "\$MOT_EFFACER" \]/);
  assert.match(s, /mkfs\.ext4 -F -L LAMA-SAUVEGARDE/);
  assert.match(s, /\.lama-sauvegarde/);
  assert.match(s, /porte le système/);
});

test("installation : les clés sont affichées et confirmées avant toute écriture, avant les unités et avant systemctl", () => {
  const s = read("installer.sh");
  const confirmation = s.indexOf("tapez OUI");
  const ecritureMaitresse = s.indexOf('"$CLE_MAITRESSE" > "$CONF/master.key"');
  const ecriturePublique = s.indexOf('"$CLE_PUBLIQUE" > "$CONF/sauvegarde.pub"');
  const installUnites = s.indexOf("install -m 0644");
  const premierSystemctl = s.indexOf("systemctl");
  assert.ok(confirmation > 0, "prompt de confirmation absent");
  assert.ok(ecritureMaitresse > confirmation, "master.key écrit avant la confirmation OUI");
  assert.ok(ecriturePublique > confirmation, "sauvegarde.pub écrit avant la confirmation OUI");
  assert.ok(installUnites > confirmation, "unités installées avant la confirmation des clés");
  assert.ok(premierSystemctl > confirmation, "systemctl appelé avant la confirmation des clés");
});

test("installation : disque monté détecté par le vrai système de fichiers, pas par l'automount seul", () => {
  const installateur = read("installer.sh");
  const preparation = read("preparer-disque.sh");
  assert.match(installateur, /findmnt -n -t ext4 "\$USB"/);
  assert.match(preparation, /findmnt -n -t ext4 "\$USB"/);
});

test("installation et préparation du disque : ls \"$USB\" déclenche l'automount juste avant chaque findmnt", () => {
  for (const name of ["installer.sh", "preparer-disque.sh"]) {
    const lignes = read(name).split("\n");
    let trouve = 0;
    lignes.forEach((ligne, i) => {
      if (!/findmnt -n -t ext4 "\$USB"/.test(ligne)) return;
      trouve += 1;
      const precedente = lignes[i - 1] ?? "";
      assert.match(precedente, /ls "\$USB"/, `${name}:${i + 1} : ls "$USB" doit précéder findmnt (déclenche l'automount)`);
    });
    assert.ok(trouve >= 1, `${name} : aucun findmnt -n -t ext4 "$USB" trouvé`);
  }
});

test("installation : refusée hors d'un terminal, sauf essai explicite en machine virtuelle", () => {
  const s = read("installer.sh");
  assert.match(s, /\[ -t 0 \] && \[ -t 1 \]/);
  assert.match(s, /LAMA_ESSAI_SANS_TERMINAL/);
});

test("installation : refuse de s'installer depuis le dossier qu'elle va supprimer, VERSION validée", () => {
  const s = read("installer.sh");
  assert.match(s, /pwd -P/, "la source doit être résolue sans lien symbolique");
  assert.match(s, /"\$SOURCE" != "\$APP\/versions\/\$VERSION"/);
  // Les deux formes (spec du 21/10/2026, M-1) : X.Y.Z publiée, AAAAMMJJ-HHMM-empreinte de développement.
  const validation = s.indexOf('version_valide "$VERSION" || echec');
  assert.ok(validation > 0 && validation < s.search(/^[ \t]*rm -rf /m), "VERSION doit être validée avant tout rm -rf");
  assert.match(s, /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/verification\.sh"/);
});

test("installation : Node 24 vérifié sur le binaire /usr/bin/node utilisé par l'unité systemd", () => {
  const s = read("installer.sh");
  assert.match(s, /\[ -x \/usr\/bin\/node \]/);
  assert.match(s, /\/usr\/bin\/node -p 'process\.versions\.node/);
});

test("disque_refuse : un disque système avec LVM (comme Ubuntu Server 24.04 par défaut) est refusé", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sda") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sda")
      printf '%s\\n' 'NAME="sda" MOUNTPOINTS="" FSTYPE=""' 'NAME="sda1" MOUNTPOINTS="" FSTYPE="vfat"' 'NAME="sda2" MOUNTPOINTS="" FSTYPE="ext4"' 'NAME="sda3" MOUNTPOINTS="" FSTYPE="LVM2_member"' 'NAME="ubuntu--vg-ubuntu--lv" MOUNTPOINTS="/" FSTYPE="ext4"'
      ;;
  esac`;
  const resultat = essaiDisqueRefuse(lsblkStub, "/dev/sda");
  assert.equal(resultat.refuse, true);
  assert.match(resultat.motif, /LVM/);
});

test("disque_refuse : un disque USB vierge, sans lien avec le système, est accepté", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sdb") printf '%s\\n' 'NAME="sdb" MOUNTPOINTS="" FSTYPE=""' ;;
  esac`;
  const resultat = essaiDisqueRefuse(lsblkStub, "/dev/sdb");
  assert.equal(resultat.refuse, false);
});

test("disque_refuse : une partition passée au lieu du disque entier est refusée", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb1") echo part ;;
  esac`;
  const resultat = essaiDisqueRefuse(lsblkStub, "/dev/sdb1");
  assert.equal(resultat.refuse, true);
  assert.match(resultat.motif, /disque entier/);
});

test("systeme_non_identifie : la racine visible dans lsblk (cas normal, ext4) est identifiée", () => {
  const lsblkStub = `
  case "$*" in
    "-rno MOUNTPOINT") printf '%s\\n' '/boot/efi' '/' '[SWAP]' ;;
  esac`;
  assert.equal(essaiSystemeNonIdentifie(lsblkStub), false);
});

test("systeme_non_identifie : une racine sur un système de fichiers sans point de montage visible (par exemple zfs_member) est refusée", () => {
  const lsblkStub = `
  case "$*" in
    "-rno MOUNTPOINT") printf '%s\\n' '' '[SWAP]' '' ;;
  esac`;
  assert.equal(essaiSystemeNonIdentifie(lsblkStub), true);
});

test("mise à jour : sauvegarde d'abord, retour automatique à la version précédente si la nouvelle ne répond pas", () => {
  const s = read("mettre-a-jour.sh");
  const order = ["systemctl start lama-sauvegarde.service", "ln -sfn \"$APP/versions/$VERSION\" \"$APP/actuelle\"", "systemctl restart lama.service"];
  let at = -1;
  for (const step of order) {
    const i = s.indexOf(step);
    assert.ok(i > at, `ordre : ${step}`);
    at = i;
  }
  assert.match(s, /ln -sfn "\$PRECEDENTE" "\$APP\/actuelle"/);
  assert.match(s, /^GARDER=3$/m);
});

test("restauration en ligne de commande : clé demandée sans écho, gardée en mémoire vive, jamais journalisée", () => {
  const s = read("restaurer.sh");
  assert.match(s, /read -rs CLE/);
  assert.match(s, /mktemp -d \/run\/lama-restauration\.XXXXXX/);
  // Le nettoyage EXIT efface toujours $TRAVAIL (I3, relecture : il relance aussi
  // le service si la restauration a été interrompue après l'arrêt, voir plus bas).
  assert.match(s, /trap nettoyage EXIT/);
  assert.match(s, /rm -rf "\$TRAVAIL"/);
  assert.match(s, /systemctl stop lama\.service/);
  assert.match(s, /cli\.mjs" restaurer/);
  assert.match(s, /NOM_VALIDE='\^lama-\[0-9\]\{8\}-\[0-9\]\{4\}\\\.db\\\.gz\\\.age\$'/);
  assert.doesNotMatch(s, /echo[^\n]*\$CLE/);
});

test("Google Drive : autorisation limitée aux fichiers créés par l'app, sous le compte du service", () => {
  const s = read("configurer-drive.sh");
  // rclone 1.60.1 (Ubuntu 24.04) ne pose aucune question à « config create » :
  // le script affiche lui-même la commande d'autorisation, portée drive.file
  // (base64 de {"scope":"drive.file"}), et fait décoder le texte collé par jeton-drive.mjs.
  assert.match(s, /rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"/);
  assert.equal(Buffer.from("eyJzY29wZSI6ImRyaXZlLmZpbGUifQ", "base64").toString(), '{"scope":"drive.file"}');
  assert.match(s, /read -rs JETON \|\| echec/, "jeton masqué à la saisie, fin d'entrée signalée");
  assert.match(s, /jeton-drive\.mjs/);
  assert.doesNotMatch(s, /config_is_local/, "plus de dépendance aux questions de rclone config");
  assert.doesNotMatch(s, /token=/, "le jeton ne passe jamais en argument (visible dans ps)");
  assert.match(s, /umask 077/);
  assert.match(s, /mv -f /, "remplacement par renommage : propriétaire et droits toujours ceux du service, 0600");
  assert.match(s, /runuser -u "\$COMPTE" -- env RCLONE_CONFIG=/);
});

// Même forme que la sortie de `rclone authorize "drive" "<bloc>"` en 1.60.1 et
// après : configmap.Simple{"token": "<jeton JSON>"} en JSON, base64 sans remplissage.
const JETON_ESSAI = { access_token: "ya29.essai", token_type: "Bearer", refresh_token: "1//essai", expiry: "2026-09-28T12:00:00.123+01:00" };
const blocRclone = (contenu: object) => Buffer.from(JSON.stringify(contenu)).toString("base64").replace(/=+$/, "");
const decoder = (texte: string) =>
  execFileSync(process.execPath, [join(DEPLOY, "jeton-drive.mjs")], { input: texte, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

test("jeton Google : le bloc codé de rclone authorize donne la configuration du remote", () => {
  const attendu = `[gdrive]\ntype = drive\nscope = drive.file\ntoken = ${JSON.stringify(JETON_ESSAI)}\n`;
  const bloc = blocRclone({ token: JSON.stringify(JETON_ESSAI) });
  assert.equal(decoder(bloc), attendu);
  // Bloc coupé par le terminal ou collé avec un retour chariot Windows.
  assert.equal(decoder(`${bloc.slice(0, 40)}\n${bloc.slice(40)}\r\n`), attendu);
});

test("jeton Google : texte invalide refusé avec un message, rien sur la sortie", () => {
  for (const texte of ["", "n'importe quoi", JSON.stringify(JETON_ESSAI), blocRclone({ scope: "drive.file" }), blocRclone({ token: "{pas du json" }), blocRclone({ token: "{}" }), blocRclone({ token: JSON.stringify(JETON_ESSAI) }).slice(0, 30)]) {
    try {
      decoder(texte);
      assert.fail(`accepté à tort : ${texte}`);
    } catch (erreur) {
      const e = erreur as { status?: number; stdout?: string; stderr?: string };
      assert.equal(e.status, 1, texte);
      assert.equal(e.stdout, "", texte);
      assert.ok(e.stderr && e.stderr.length > 0, texte);
    }
  }
});

test("mise à jour : refuse de s'installer depuis le dossier qu'elle va supprimer (version en service ou $APP/actuelle), VERSION validée", () => {
  const s = read("mettre-a-jour.sh");
  assert.match(s, /pwd -P/, "la source doit être résolue sans lien symbolique");
  const validation = s.indexOf('version_valide "$VERSION" || echec');
  // Vise la commande en début de ligne, avec ou sans indentation (M4, relecture
  // de la tâche 13 ; le corps du script est indenté depuis la Correction 2,
  // garde-fou BASH_SOURCE), pas une occurrence de « rm -rf » dans un commentaire
  // qui la précéderait sans être dangereuse.
  const premierRm = s.search(/^[ \t]*rm -rf /m);
  assert.ok(premierRm > 0, "aucune commande rm -rf trouvée en début de ligne");
  assert.ok(validation > 0 && validation < premierRm, "VERSION doit être validée avant le premier rm -rf");
  assert.match(s, /"\$SOURCE" != "\$PRECEDENTE"/, "refuse la source si elle est la version en service ($APP/actuelle)");
  assert.match(s, /"\$SOURCE" != "\$APP\/versions\/\$VERSION"/, "refuse la source si elle est déjà la version installée");
});

test("mise à jour : sauvegarde interrompue distinguée du disque USB absent (M1)", () => {
  const s = read("mettre-a-jour.sh");
  assert.match(s, /systemctl start lama-sauvegarde\.service --wait/);
  assert.match(s, /systemctl show -p ExecMainStatus --value lama-sauvegarde\.service/);
  assert.match(s, /"\$CODE_SAUVEGARDE" = "2"/);
  assert.match(s, /La sauvegarde a échoué\. Mise à jour annulée, rien n'a été modifié\./);
});

test("mise à jour : retour arrière après une migration, base d'avant migration remise en place", () => {
  const s = read("mettre-a-jour.sh");
  const temoin = s.indexOf('touch "$TEMOIN"');
  const restartNouvelle = s.indexOf("systemctl restart lama.service");
  assert.ok(temoin > 0 && temoin < restartNouvelle, "le témoin doit être posé avant le redémarrage sur la nouvelle version");
  // La sélection elle-même est isolée dans copie_avant_migration (Correction 2)
  // et testée en bac à sable ci-dessous ; ici on vérifie juste qu'elle est
  // appelée avec le bon dossier et le bon témoin.
  assert.match(s, /^copie_avant_migration\(\) \{$/m);
  assert.match(s, /COPIE="\$\(copie_avant_migration "\$DATA" "\$TEMOIN"\)"/);
  // Remise en place isolée dans remettre_copie (M3, relecture finale), testée
  // en bac à sable plus bas : wal et shm déplacés sous le même suffixe, 0600.
  assert.match(s, /remettre_copie "\$DATA" "\$COPIE" "\$HORODATAGE"/);
  assert.match(s, /lama\.db\.migree-\$HORODATAGE/);
  assert.match(s, /la base de données n'a pas été modifiée/, "message clair quand il n'y a pas de copie avant-migration");
  // Le message final, si la version précédente ne répond pas non plus, dit
  // aussi si la base a été remplacée (Minor promu, Correction 2).
  assert.match(s, /La version précédente ne répond pas non plus, \$MESSAGE_BASE\. /);
});

test("copie_avant_migration : garde la plus ancienne copie postérieure au témoin, pas la plus récente (Restart=always peut en refaire plusieurs)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-avant-migration-"));
  const base = Date.now();

  const temoin = join(dir, "temoin");
  writeFileSync(temoin, "");
  utimesSync(temoin, new Date(base), new Date(base));

  // Antérieure au témoin : ne doit jamais être choisie, même si son nom (donc
  // son epoch) est le plus petit des trois.
  const anterieure = join(dir, "avant-migration-1758900000000.db");
  writeFileSync(anterieure, "");
  utimesSync(anterieure, new Date(base - 10000), new Date(base - 10000));

  // Postérieure au témoin, la plus ancienne des deux : celle attendue.
  const plusAncienne = join(dir, "avant-migration-1758999999111.db");
  writeFileSync(plusAncienne, "");
  utimesSync(plusAncienne, new Date(base + 5000), new Date(base + 5000));

  // Postérieure au témoin, plus récente que la précédente : ne doit pas être
  // choisie (base déjà à moitié migrée par une relance suivante).
  const plusRecente = join(dir, "avant-migration-1759000000222.db");
  writeFileSync(plusRecente, "");
  utimesSync(plusRecente, new Date(base + 8000), new Date(base + 8000));

  assert.equal(essaiCopieAvantMigration(dir, temoin), plusAncienne);
});

test("mise à jour : nettoyage par versions_a_supprimer, version refusée nettoyée au retour arrière", () => {
  const s = read("mettre-a-jour.sh");
  assert.match(s, /done < <\(versions_a_supprimer "\$APP\/versions" "\$GARDER" "\$VERSION" "\$\(basename "\$PRECEDENTE"\)"\)/);
  const retourArriere = s.indexOf("Retour à la version précédente");
  const rmVersionRefusee = s.indexOf('rm -rf "$APP/versions/$VERSION"', retourArriere);
  assert.ok(retourArriere > 0 && rmVersionRefusee > retourArriere, "la version refusée doit être supprimée au retour arrière");
});

test("mise à jour et restauration : curl avec délai maximal, pour ne jamais rester bloqué", () => {
  for (const name of ["mettre-a-jour.sh", "https-heure.sh"]) {
    assert.match(read(name), /curl -fsS --max-time 5/, name);
  }
  assert.match(read("restaurer.sh"), /^repond\(\) \{ lama_repond \/etc\/lama; \}$/m, "restaurer.sh passe par lama_repond (https-heure.sh)");
});

test("restauration en ligne de commande : le service arrêté est relancé même après une interruption", () => {
  const s = read("restaurer.sh");
  const arret = s.indexOf("systemctl stop lama.service");
  const drapeau = s.indexOf("ARRETE=1");
  assert.ok(arret > 0 && drapeau > arret, "ARRETE=1 doit être posé juste après l'arrêt du service");
  assert.match(s, /trap nettoyage EXIT/);
  assert.match(s, /\[ "\$ARRETE" = "1" \] && ! systemctl is-active --quiet lama\.service/);
  assert.match(s, /systemctl start lama\.service \|\| true/);
});

test("restauration en ligne de commande : un second Ctrl-C pendant le nettoyage n'interrompt pas l'effacement de la clé ni la relance", () => {
  const s = read("restaurer.sh");
  const nettoyage = s.indexOf("nettoyage() {");
  const ignoreSignaux = s.indexOf("trap '' INT HUP TERM");
  const rmTravail = s.indexOf('rm -rf "$TRAVAIL"', nettoyage);
  assert.ok(nettoyage > 0 && nettoyage < ignoreSignaux && ignoreSignaux < rmTravail, "trap '' INT HUP TERM doit ouvrir la fonction nettoyage, avant tout effacement");
});

test("restauration en ligne de commande : le nom de sauvegarde est validé avant tout usage, sur les deux sources", () => {
  const s = read("restaurer.sh");
  const validationDrive = s.indexOf('[[ "$NOM" =~ $NOM_VALIDE ]]');
  const copieDrive = s.indexOf("rclone copyto");
  assert.ok(validationDrive > 0 && validationDrive < copieDrive, "--drive : nom validé avant rclone copyto");
  const validationFichier = s.lastIndexOf('[[ "$NOM" =~ $NOM_VALIDE ]]');
  const copieFichier = s.indexOf('cp -- "$1" "$FICHIER"');
  assert.ok(validationFichier > 0 && validationFichier < copieFichier, "fichier local : nom validé avant la copie");
});

test("procédures du technicien : toutes les situations, typographie française", () => {
  const doc = read("LISEZMOI.md");
  for (const heading of ["## Installer", "## Clés de secours", "## Disque de sauvegarde", "## Google Drive", "## Mettre à jour", "## Restaurer une sauvegarde", "## Reprendre après une panne du serveur", "## Surveiller"]) {
    assert.ok(doc.includes(heading), heading);
  }
  assert.doesNotMatch(doc, /\u2014/, "tiret cadratin");
  let inCode = false;
  doc.split("\n").forEach((line, i) => {
    if (line.startsWith("```")) { inCode = !inCode; return; }
    if (inCode) return;
    const prose = line.replace(/`[^`]*`/g, "code");
    assert.doesNotMatch(prose, /[\p{L})»] [:;!?]/u, `ligne ${i + 1} : espace insécable attendue`);
  });
});

// Rejoue le vrai cadre des clés de installer.sh (fonction afficher_cles, chargée
// par « source », jamais le reste du script), avec des clés factices. Défaut
// trouvé à l'essai en machine virtuelle (tâche 15 du plan 2B) : une apostrophe
// dans une valeur par défaut ${…:-…} d'un document ouvert faisait disparaître la clé 2.
function cadreDesCles(maitresse: string, privee: string, langue = "fr"): string {
  const dir = mkdtempSync(join(tmpdir(), "lama-cadre-cles-"));
  const script = join(dir, "essai.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nset -euo pipefail\nsource '${join(DEPLOY, "installer.sh")}'\nafficher_cles '${maitresse}' '${privee}'\n`);
  return execFileSync("bash", [script], { encoding: "utf8", env: envWith({ LAMA_LANGUE: langue }) });
}

test("installation : le cadre affiche les deux clés, neuves ou déjà créées (défaut trouvé en machine virtuelle)", () => {
  const neuves = cadreDesCles("CLEMAITRESSEFACTICE", "AGE-SECRET-KEY-1FACTICE");
  assert.match(neuves, /1\. Clé maîtresse[^\n]*\n\s+CLEMAITRESSEFACTICE\n/);
  assert.match(neuves, /2\. Clé privée des sauvegardes[^\n]*\n\s+AGE-SECRET-KEY-1FACTICE\n/);
  const privee = cadreDesCles("", "AGE-SECRET-KEY-1FACTICE");
  assert.match(privee, /1\. Clé maîtresse[^\n]*\n\s+déjà créée lors d'une installation précédente\n/);
  assert.match(privee, /2\. Clé privée des sauvegardes[^\n]*\n\s+AGE-SECRET-KEY-1FACTICE\n/);
  const maitresse = cadreDesCles("CLEMAITRESSEFACTICE", "");
  assert.match(maitresse, /2\. Clé privée des sauvegardes[^\n]*\n\s+déjà créée lors d'une installation précédente\n/);
});

test("restauration en ligne de commande : base restaurée en 0600 comme sous le service (défaut trouvé en machine virtuelle)", () => {
  // runuser garde le masque de root (022) : sans umask 077, la base préparée par
  // le CLI puis remise en service était lisible par tous (0644), wal et shm compris.
  const s = read("restaurer.sh");
  const masque = s.search(/^umask 077$/m);
  assert.ok(masque > 0, "restaurer.sh doit poser umask 077");
  assert.ok(masque < s.indexOf('cli.mjs" restaurer'), "umask 077 doit précéder la préparation de la restauration");
});

// ── Correction de la relecture de sécurité de la tâche 16 (I1, M2, M5) ──

// Exécute uniquement poser_temoin du script donné (jamais le reste, protégé par
// le garde-fou BASH_SOURCE), dans un dossier du bac à sable. runuser est simulé
// (la commande est lancée telle quelle, sans changer de compte) et chown est
// simulé (il n'écrit qu'un journal) : rien ne change de propriétaire sur le Mac.
function essaiPoserTemoin(script: string, dossier: string): { code: number; journal: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "lama-temoin-essai-"));
  const essai = join(dir, "essai.sh");
  const journal = join(dir, "journal");
  writeFileSync(journal, "");
  writeFileSync(
    essai,
    `#!/usr/bin/env bash\nset -euo pipefail\nrunuser() { printf 'runuser %s\\n' "$*" >> '${journal}'; [ "$1" = -u ] && shift 2; [ "$1" = -- ] && shift; "$@"; }\nchown() { printf 'chown %s\\n' "$*" >> '${journal}'; }\nsource '${join(DEPLOY, script)}'\nposer_temoin '${dossier}' lama\n`,
  );
  let code = 0;
  try {
    execFileSync("bash", [essai], { stdio: "pipe" });
  } catch (erreur) {
    code = (erreur as { status?: number }).status ?? -1;
  }
  return { code, journal: readFileSync(journal, "utf8").split("\n").filter(Boolean) };
}

for (const script of ["installer.sh", "preparer-disque.sh"]) {
  test(`${script} : poser_temoin refuse un témoin remplacé par un lien symbolique, sans toucher à sa cible (I1)`, () => {
    const dossier = mkdtempSync(join(tmpdir(), "lama-usb-lien-"));
    const cible = join(mkdtempSync(join(tmpdir(), "lama-cible-")), "shadow");
    writeFileSync(cible, "secret");
    const ancienne = new Date(Date.now() - 3_600_000);
    utimesSync(cible, ancienne, ancienne);
    symlinkSync(cible, join(dossier, ".lama-sauvegarde"));
    const { code, journal } = essaiPoserTemoin(script, dossier);
    assert.notEqual(code, 0, "un témoin qui est un lien doit être refusé");
    assert.equal(statSync(cible).mtimeMs, ancienne.getTime(), "la cible du lien ne doit pas être touchée");
    assert.equal(readFileSync(cible, "utf8"), "secret");
    for (const ligne of journal.filter((l) => l.startsWith("chown "))) assert.match(ligne, /^chown -h /, ligne);
    assert.ok(!journal.some((l) => l.startsWith("chown ") && l.includes(".lama-sauvegarde")), "aucun chown sur le lien");
  });

  test(`${script} : poser_temoin crée le témoin sous le compte du service, chown sans suivre les liens (I1)`, () => {
    const dossier = mkdtempSync(join(tmpdir(), "lama-usb-vierge-"));
    const { code, journal } = essaiPoserTemoin(script, dossier);
    assert.equal(code, 0, journal.join("\n"));
    const temoin = join(dossier, ".lama-sauvegarde");
    assert.ok(lstatSync(temoin).isFile(), "témoin créé, fichier ordinaire");
    assert.ok(journal.some((l) => /^runuser -u lama -- touch -- .*\.lama-sauvegarde$/.test(l)), "témoin créé par le compte du service");
    const chowns = journal.filter((l) => l.startsWith("chown "));
    assert.ok(chowns.length >= 1);
    for (const ligne of chowns) assert.match(ligne, /^chown -h /, ligne);
  });
}

test("installation et préparation du disque : aucun touch ni chown suivant les liens sur le disque de sauvegarde ou les données (I1)", () => {
  for (const name of ["installer.sh", "preparer-disque.sh"]) {
    const s = read(name);
    assert.doesNotMatch(s, /^\s*touch "\$USB/m, `${name} : touch en root sur le disque`);
    assert.doesNotMatch(s, /chown (?!-h )[^\n]*"\$(USB|DATA|DOSSIER)/, `${name} : chown sans -h sur un dossier du service`);
    assert.match(s, /^\s*poser_temoin "\$USB" "\$COMPTE"/m, `${name} : témoin posé par poser_temoin`);
  }
  const installateur = read("installer.sh");
  assert.doesNotMatch(installateur, /^install -d[^\n]*"\$DATA\/rclone"/m, "dossier rclone créé en root dans un dossier du service");
  assert.match(installateur, /runuser -u "\$COMPTE" -- install -d -m 0700 "\$DATA\/rclone"/);
});

test("copie_avant_migration : un lien symbolique posé dans le dossier des données est ignoré (I1)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-avant-migration-lien-"));
  const temoin = join(dir, "temoin");
  writeFileSync(temoin, "");
  const passe = new Date(Date.now() - 60_000);
  utimesSync(temoin, passe, passe);
  const cible = join(mkdtempSync(join(tmpdir(), "lama-cible-")), "shadow");
  writeFileSync(cible, "secret");
  // Lien créé après le témoin : find -newer compare l'horodatage du lien lui-même.
  symlinkSync(cible, join(dir, "avant-migration-9999999999999.db"));
  assert.equal(essaiCopieAvantMigration(dir, temoin), "");
});

test("mise à jour : la base d'avant migration est remise en place par le compte du service, jamais en root (I1)", () => {
  const s = read("mettre-a-jour.sh");
  assert.match(s, /find "\$DOSSIER" -maxdepth 1 -type f -name 'avant-migration-\*\.db'/);
  assert.match(s, /comme_service mv -T -- "\$DOSSIER\/lama\.db" "\$DOSSIER\/lama\.db\.migree-\$SUFFIXE"/);
  assert.match(s, /comme_service cp -- "\$COPIE_ARG" "\$DOSSIER\/lama\.db\.retour"/);
  assert.match(s, /comme_service chmod 0600 "\$DOSSIER\/lama\.db\.retour"/);
  assert.doesNotMatch(s, /^\s*(mv|cp|chown|chmod) [^\n]*"\$DATA/m, "opération root sur un chemin du dossier des données");
});

test("restauration en ligne de commande : la sauvegarde indiquée est lue par le compte du service, jamais par root (I1)", () => {
  const s = read("restaurer.sh");
  assert.match(s, /runuser -u "\$COMPTE" -- cp -- "\$1" "\$FICHIER"/);
  assert.doesNotMatch(s, /^\s*cp -- "\$1"/m, "copie en root de la sauvegarde indiquée");
  assert.doesNotMatch(s, /chown (?!-h )/, "chown sans -h");
});

test("restauration en ligne de commande : la clé n'est écrite et donnée au service qu'après son arrêt (M2)", () => {
  const s = read("restaurer.sh");
  const arret = s.indexOf("systemctl stop lama.service");
  const ecriture = s.indexOf('> "$TRAVAIL/cle"');
  const don = s.indexOf('"$TRAVAIL/cle"', ecriture + 1);
  assert.ok(arret > 0 && ecriture > arret, "clé écrite avant l'arrêt du service");
  assert.ok(don > ecriture, "clé donnée au service avant son écriture");
  assert.match(s.slice(ecriture), /^chown -h "\$COMPTE:\$COMPTE" "\$TRAVAIL\/cle"$/m);
});

test("disque_refuse : un disque dont une partition est montée ailleurs (données de l'application) est refusé (M5)", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sdb") printf '%s\\n' 'NAME="sdb" MOUNTPOINTS="" FSTYPE=""' 'NAME="sdb1" MOUNTPOINTS="/var/lib/lama" FSTYPE="ext4"' ;;
  esac`;
  const resultat = essaiDisqueRefuse(lsblkStub, "/dev/sdb");
  assert.equal(resultat.refuse, true);
  assert.match(resultat.motif, /sdb1 monté sur \/var\/lib\/lama/);
});

test("disque_refuse : une partition montée à deux endroits, dont le disque de sauvegarde, est refusée (M5)", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sdb") printf '%s\\n' 'NAME="sdb" MOUNTPOINTS="" FSTYPE=""' 'NAME="sdb1" MOUNTPOINTS="/mnt/lama-sauvegarde\\x0a/srv" FSTYPE="ext4"' ;;
  esac`;
  const resultat = essaiDisqueRefuse(lsblkStub, "/dev/sdb");
  assert.equal(resultat.refuse, true);
  assert.match(resultat.motif, /sdb1 monté sur \/srv/);
});

test("disque_refuse : l'ancien disque de sauvegarde monté sur /mnt/lama-sauvegarde reste accepté (M5)", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sdb") printf '%s\\n' 'NAME="sdb" MOUNTPOINTS="" FSTYPE=""' 'NAME="sdb1" MOUNTPOINTS="/mnt/lama-sauvegarde" FSTYPE="ext4"' ;;
  esac`;
  assert.equal(essaiDisqueRefuse(lsblkStub, "/dev/sdb").refuse, false);
});

// ── Vague de corrections finale (relecture de la branche) ──

// Exécute uniquement creer_compte_service de installer.sh (jamais le reste),
// avec id, getent, groupadd et useradd simulés : `comptes` et `groupes` sont
// les lignes « nom:numéro » connues du système simulé. Ne crée aucun compte réel.
function essaiCompteService(comptes: string[], groupes: string[]): { code: number; journal: string[]; erreur: string } {
  const dir = mkdtempSync(join(tmpdir(), "lama-compte-essai-"));
  const essai = join(dir, "essai.sh");
  const journal = join(dir, "journal");
  writeFileSync(journal, "");
  const liste = (lignes: string[]) => lignes.map((l) => `'${l}'`).join(" ");
  writeFileSync(
    essai,
    `#!/usr/bin/env bash
set -euo pipefail
COMPTES=(${liste(comptes)})
GROUPES=(${liste(groupes)})
cherche() { local CLE="$1"; shift; local L; for L in "$@"; do case "$L" in "$CLE":*|*:"$CLE") printf '%s:x:%s\\n' "\${L%%:*}" "\${L##*:}"; return 0 ;; esac; done; return 2; }
getent() { if [ "$1" = passwd ]; then cherche "$2" "\${COMPTES[@]}"; else cherche "$2" "\${GROUPES[@]}"; fi; }
id() { local N="\${@: -1}"; local L; L="$(cherche "$N" "\${COMPTES[@]}")" || return 1; [ "$1" = -u ] && printf '%s\\n' "$(printf '%s' "$L" | cut -d: -f3)"; return 0; }
groupadd() { printf 'groupadd %s\\n' "$*" >> '${journal}'; }
useradd() { printf 'useradd %s\\n' "$*" >> '${journal}'; }
source '${join(DEPLOY, "installer.sh")}'
creer_compte_service lama 871 /var/lib/lama
`,
  );
  let code = 0;
  let erreur = "";
  try {
    execFileSync("bash", [essai], { stdio: "pipe" });
  } catch (e) {
    code = (e as { status?: number }).status ?? -1;
    erreur = String((e as { stderr?: Buffer }).stderr ?? "");
  }
  return { code, journal: readFileSync(journal, "utf8").split("\n").filter(Boolean), erreur };
}

test("compte de service : UID et GID fixes (871), le même sur une machine de remplacement (I1, relecture finale)", () => {
  const s = read("installer.sh");
  assert.match(s, /^UID_SERVICE=871$/m);
  assert.match(s, /^creer_compte_service "\$COMPTE" "\$UID_SERVICE" "\$DATA" \|\| echec /m);
  assert.doesNotMatch(s, /^id "\$COMPTE"[^\n]*useradd/m, "plus de useradd sans numéro fixe");
  const { code, journal } = essaiCompteService(["root:0", "syslog:104"], ["root:0", "syslog:110"]);
  assert.equal(code, 0);
  assert.deepEqual(journal, [
    "groupadd --system --gid 871 lama",
    "useradd --system --uid 871 --gid 871 --home-dir /var/lib/lama --no-create-home --shell /usr/sbin/nologin lama",
  ]);
});

test("compte de service : échec lisible si 871 est déjà pris par un autre compte ou groupe, rien n'est créé (I1)", () => {
  const compte = essaiCompteService(["root:0", "autre:871"], ["root:0"]);
  assert.notEqual(compte.code, 0);
  assert.match(compte.erreur, /871[^\n]*autre/);
  assert.deepEqual(compte.journal, []);
  const groupe = essaiCompteService(["root:0"], ["root:0", "autregroupe:871"]);
  assert.notEqual(groupe.code, 0);
  assert.match(groupe.erreur, /871[^\n]*autregroupe/);
  assert.deepEqual(groupe.journal, []);
});

test("compte de service : un compte déjà présent est gardé, sans rien recréer (réinstallation)", () => {
  const { code, journal } = essaiCompteService(["root:0", "lama:871"], ["root:0", "lama:871"]);
  assert.equal(code, 0);
  assert.deepEqual(journal, []);
});

for (const script of ["installer.sh", "preparer-disque.sh"]) {
  test(`${script} : poser_temoin rend toute l'arborescence du disque au service, sans suivre les liens (I1, relecture finale)`, () => {
    const dossier = mkdtempSync(join(tmpdir(), "lama-usb-ancien-"));
    mkdirSync(join(dossier, "quotidiennes"));
    writeFileSync(join(dossier, "quotidiennes", "lama-20260928-0200.db.gz.age"), "chiffré");
    writeFileSync(join(dossier, ".lama-sauvegarde"), "");
    const cible = join(mkdtempSync(join(tmpdir(), "lama-cible-")), "shadow");
    writeFileSync(cible, "secret");
    const ancienne = new Date(Date.now() - 3_600_000);
    utimesSync(cible, ancienne, ancienne);
    symlinkSync(cible, join(dossier, "quotidiennes", "lien"));
    const { code, journal } = essaiPoserTemoin(script, dossier);
    assert.equal(code, 0, journal.join("\n"));
    const chowns = journal.filter((l) => l.startsWith("chown "));
    assert.ok(chowns.some((l) => l === `chown -h -R -P lama:lama ${dossier}`), chowns.join("\n"));
    for (const ligne of chowns) assert.match(ligne, /^chown -h /, ligne);
    assert.equal(statSync(cible).mtimeMs, ancienne.getTime(), "la cible du lien ne doit pas être touchée");
    assert.equal(readFileSync(cible, "utf8"), "secret");
  });
}

test("reprise après panne : relancer l'installateur une fois le disque branché (I1, relecture finale)", () => {
  const doc = read("LISEZMOI.md");
  const reprise = doc.slice(doc.indexOf("## Reprendre après une panne du serveur"), doc.indexOf("## Surveiller"));
  assert.match(reprise, /relancer `sudo \.\/deploy\/installer\.sh`/);
  assert.match(reprise, /871/);
});

test("installation : l'écran et son défilement sont effacés après OUI, rappel de l'historique SSH (M1, relecture finale)", () => {
  const s = read("installer.sh");
  const confirmation = s.indexOf('until [ "$REPONSE" = "$MOT_OUI" ]');
  const effacement = s.indexOf("printf '\\033[3J\\033[H\\033[2J'");
  const rappel = s.indexOf("historique de votre session SSH");
  const ecriture = s.indexOf('"$CLE_MAITRESSE" > "$CONF/master.key"');
  assert.ok(confirmation > 0 && effacement > confirmation, "effacement après la boucle de confirmation");
  assert.ok(rappel > effacement && rappel < ecriture, "rappel juste après l'effacement");
  const doc = read("LISEZMOI.md");
  const cles = doc.slice(doc.indexOf("## Clés de secours"), doc.indexOf("## Disque de sauvegarde"));
  assert.match(cles, /efface l'écran/);
  assert.match(cles, /historique/);
});

test("disque_refuse : lsblk en échec (ou qui ne connaît pas MOUNTPOINTS) fait refuser le disque (M2, relecture finale)", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sdb") echo "lsblk: unknown column: MOUNTPOINTS" >&2; return 1 ;;
  esac`;
  const resultat = essaiDisqueRefuse(lsblkStub, "/dev/sdb");
  assert.equal(resultat.refuse, true);
  assert.match(resultat.motif, /lsblk/);
});

test("disque_refuse : lsblk qui ne décrit rien fait refuser le disque (M2)", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb") echo disk ;;
    "-Pno NAME,MOUNTPOINTS,FSTYPE /dev/sdb") ;;
  esac`;
  assert.equal(essaiDisqueRefuse(lsblkStub, "/dev/sdb").refuse, true);
});

// Exécute uniquement remettre_copie de mettre-a-jour.sh dans un dossier du bac
// à sable, avec comme_service simulé (commande journalisée puis lancée telle
// quelle, sauf -T retiré de mv, inconnu du mv du Mac et sans effet ici : aucune
// cible n'est un dossier) : aucun service ni compte réel.
function essaiRemettreCopie(dossier: string, copie: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "lama-remettre-essai-"));
  const essai = join(dir, "essai.sh");
  const journal = join(dir, "journal");
  writeFileSync(journal, "");
  writeFileSync(
    essai,
    `#!/usr/bin/env bash\nset -euo pipefail\nsource '${join(DEPLOY, "mettre-a-jour.sh")}'\ncomme_service() { printf '%s\\n' "$*" >> '${journal}'; if [ "$1 $2" = "mv -T" ]; then shift 2; mv "$@"; else "$@"; fi; }\nremettre_copie '${dossier}' '${copie}' 20260928-120000\n`,
  );
  execFileSync("bash", [essai], { stdio: "pipe" });
  return readFileSync(journal, "utf8").split("\n").filter(Boolean);
}

test("mise à jour, retour arrière : copie posée à côté d'abord, base migrée mise de côté ensuite, puis renommage (M3, relecture finale)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-retour-"));
  const copie = join(dossier, "avant-migration-1759000000000.db");
  writeFileSync(copie, "avant");
  writeFileSync(join(dossier, "lama.db"), "migree");
  writeFileSync(join(dossier, "lama.db-wal"), "wal");
  writeFileSync(join(dossier, "lama.db-shm"), "shm");
  const journal = essaiRemettreCopie(dossier, copie);
  const rang = (motif: RegExp) => journal.findIndex((l) => motif.test(l));
  const copieRetour = rang(/^cp -- .*avant-migration.* .*\/lama\.db\.retour$/);
  const miseDeCote = rang(/^mv -T -- .*\/lama\.db .*\/lama\.db\.migree-20260928-120000$/);
  const renommage = rang(/^mv -T -- .*\/lama\.db\.retour .*\/lama\.db$/);
  assert.ok(copieRetour >= 0 && copieRetour < miseDeCote && miseDeCote < renommage, journal.join("\n"));
  assert.equal(readFileSync(join(dossier, "lama.db"), "utf8"), "avant");
  assert.equal(readFileSync(join(dossier, "lama.db.migree-20260928-120000"), "utf8"), "migree");
  assert.equal(readFileSync(join(dossier, "lama.db-wal.migree-20260928-120000"), "utf8"), "wal");
  assert.equal(readFileSync(join(dossier, "lama.db-shm.migree-20260928-120000"), "utf8"), "shm");
  assert.ok(!readdirSync(dossier).includes("lama.db.retour"));
  assert.ok(!readdirSync(dossier).includes("lama.db-wal"));
  assert.equal(statSync(join(dossier, "lama.db")).mode & 0o777, 0o600);
  assert.equal(readFileSync(copie, "utf8"), "avant", "la copie d'avant migration reste en place");
});

test("mise à jour et restauration : LISEZMOI conseille tmux (ou screen) contre une coupure SSH (M3)", () => {
  const doc = read("LISEZMOI.md");
  for (const section of ["## Mettre à jour", "## Restaurer une sauvegarde"]) {
    const debut = doc.indexOf(section);
    const suite = doc.slice(debut + section.length);
    const fin = suite.indexOf("\n## ");
    assert.match(suite.slice(0, fin === -1 ? undefined : fin), /tmux/, section);
  }
});

test("installation relancée avec une autre version : refusée d'emblée, renvoi vers mettre-a-jour.sh (M7, relecture finale)", () => {
  const s = read("installer.sh");
  const garde = s.indexOf('[ "$(readlink -f "$APP/actuelle")" != "$APP/versions/$VERSION" ]');
  assert.ok(garde > 0, "garde de version absente");
  assert.ok(garde < s.indexOf('etape "$(msg "Paquets du système"'), "la garde doit précéder toute action");
  assert.match(s, /Une autre version de lama est en service[^\n]*mettre-a-jour\.sh/);
  const doc = read("LISEZMOI.md");
  assert.doesNotMatch(doc, /Le script peut être relancé sans risque, depuis/);
  assert.match(doc, /relancé sans risque avec la même version/);
});

test("LISEZMOI aligné sur les scripts : base migrée, nom sur le réseau, destination Drive (M7, relecture finale)", () => {
  const doc = read("LISEZMOI.md");
  assert.doesNotMatch(doc, /lama\.db\.migree-[^\s`]*\.db/, "le script n'ajoute pas .db au nom de la base migrée");
  assert.match(doc, /`lama\.db\.migree-AAAAMMJJ-HHMMSS`/);
  const surveiller = doc.slice(doc.indexOf("## Surveiller"));
  assert.match(surveiller, /lama-2\.local/);
  assert.match(surveiller, /hostname -I/);
  assert.match(surveiller, /journalctl -u avahi-daemon/);
  assert.match(doc, /sudo LAMA_DRIVE=[^\n]*restaurer\.sh/);
});

test("CLI de restauration : pas de consigne de relance, restaurer.sh relance lui-même le service (M7)", () => {
  const cli = readFileSync(new URL("./cli.ts", import.meta.url), "utf8");
  assert.doesNotMatch(cli, /Lancez\s*:\s*sudo systemctl restart/);
});

test("LISEZMOI : « 2 h » avec une espace insécable", () => {
  assert.doesNotMatch(read("LISEZMOI.md"), /\d h(?![-\w])/);
});

test("langue des scripts : LANG en* donne l'anglais, tout le reste le français ; LAMA_LANGUE ne force que fr ou en (Review Focus 5)", () => {
  assert.equal(langueDesScripts({}), "fr OUI EFFACER", "LANG absent (sudo sans LANG)");
  assert.equal(langueDesScripts({ LANG: "C.UTF-8" }), "fr OUI EFFACER");
  assert.equal(langueDesScripts({ LANG: "fr_FR.UTF-8" }), "fr OUI EFFACER");
  assert.equal(langueDesScripts({ LANG: "en_GB.UTF-8" }), "en YES ERASE");
  assert.equal(langueDesScripts({ LANG: "en_US.UTF-8", LAMA_LANGUE: "fr" }), "fr OUI EFFACER");
  assert.equal(langueDesScripts({ LANG: "fr_FR.UTF-8", LAMA_LANGUE: "en" }), "en YES ERASE");
  assert.equal(langueDesScripts({ LANG: "en_US.UTF-8", LAMA_LANGUE: "de" }), "en YES ERASE", "LAMA_LANGUE inconnue : ignorée");
  assert.equal(langueDesScripts({ LAMA_LANGUE: "de" }), "fr OUI EFFACER");
});

/** Appels `msg "texte" "text"` d'un script. */
function messages(text: string): { fr: string; en: string; ligne: number }[] {
  const found: { fr: string; en: string; ligne: number }[] = [];
  text.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/\bmsg\s+(["'])((?:\\.|(?!\1).)*)\1\s+(["'])((?:\\.|(?!\3).)*)\3/g)) found.push({ fr: m[2], en: m[4], ligne: i + 1 });
  });
  return found;
}

/** Scripts déjà passés aux messages bilingues ; la tâche 18 y ajoute les autres. */
const SCRIPTS_TRADUITS = scripts().filter((n) => n !== "langue.sh");

test("messages des scripts : chacun dans les deux langues, mêmes variables, typographie de chaque langue (spec § 11)", () => {
  const variables = (s: string) => [...s.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)|%s/g)].map((m) => m[1] ?? "%s").sort().join(" ");
  const fautes: string[] = [];
  for (const name of SCRIPTS_TRADUITS) {
    const liste = messages(read(name));
    if (liste.length === 0) fautes.push(`${name} : aucun message bilingue`);
    for (const { fr, en, ligne } of liste) {
      if (!fr.trim() || !en.trim()) fautes.push(`${name}:${ligne} : message vide`);
      if (variables(fr) !== variables(en)) fautes.push(`${name}:${ligne} : variables différentes`);
      fautes.push(...frenchFaults(fr).map((f) => `${name}:${ligne} fr : ${f}`), ...englishFaults(en).map((f) => `${name}:${ligne} en : ${f}`));
    }
  }
  assert.deepEqual(fautes, []);
});

/** Lignes qui affichent un texte écrit dans une seule langue (hors `msg`). */
function unilingues(name: string): string[] {
  return read(name).split("\n")
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => /\b(echo|echec|etape) "(?!\$\(msg )[^"$]*\p{L}{3}/u.test(line))
    .map(({ i }) => `${name}:${i + 1}`);
}

test("installation et préparation du disque : plus aucun message écrit dans une seule langue", () => {
  assert.deepEqual(["installer.sh", "preparer-disque.sh"].flatMap(unilingues), []);
});

test("installation : le cadre des clés en anglais, mot de confirmation YES", () => {
  const cadre = cadreDesCles("CLEMAITRESSEFACTICE", "", "en");
  assert.match(cadre, /lama, recovery keys/);
  assert.match(cadre, /1\. Master key[^\n]*\n\s+CLEMAITRESSEFACTICE\n/);
  assert.match(cadre, /2\. Backup private key[^\n]*\n\s+already created during a previous installation\n/);
  assert.match(cadre, /before typing YES/);
});

test("disque_refuse : motif dans la langue des scripts", () => {
  const lsblkStub = `
  case "$*" in
    "-dno TYPE /dev/sdb1") echo part ;;
  esac`;
  const dir = mkdtempSync(join(tmpdir(), "lama-disque-refuse-en-"));
  const script = join(dir, "essai.sh");
  writeFileSync(script, `#!/usr/bin/env bash\nset -euo pipefail\nlsblk() {\n${lsblkStub}\n}\nsource '${join(DEPLOY, "preparer-disque.sh")}'\ndisque_refuse /dev/sdb1 || true\n`);
  assert.match(execFileSync("bash", [script], { encoding: "utf8", env: envWith({ LAMA_LANGUE: "en" }) }), /is not a whole disk/);
});

// ── Tâche 18 : scripts d'exploitation (mise à jour, restauration, Google Drive, archive) ──

test("scripts d'exploitation : tous passent par msg, aucun message écrit dans une seule langue", () => {
  const noms = ["mettre-a-jour.sh", "restaurer.sh", "configurer-drive.sh", "fabriquer-paquet.sh"];
  for (const name of noms) assert.match(read(name), /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/langue\.sh"/, name);
  assert.deepEqual(noms.flatMap(unilingues), []);
});

test("Google Drive : instructions dans les deux langues, même commande d'autorisation", () => {
  const s = read("configurer-drive.sh");
  const commandes = s.match(/rclone authorize "drive" "eyJzY29wZSI6ImRyaXZlLmZpbGUifQ"/g) ?? [];
  assert.equal(commandes.length, 2, "la commande figure dans l'instruction française et dans l'anglaise");
  assert.match(s, /if \[ "\$LANGUE" = "en" \]; then/);
});

test("jeton Google : message d'erreur dans la langue de LANG ou de LAMA_LANGUE", () => {
  const erreur = (vars: Record<string, string>) => {
    try {
      execFileSync(process.execPath, [join(DEPLOY, "jeton-drive.mjs")], { input: "n'importe quoi", encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: envWith(vars) });
      return "";
    } catch (e) {
      return String((e as { stderr?: string }).stderr);
    }
  };
  assert.equal(erreur({ LAMA_LANGUE: "en" }), "This text is not the block returned by rclone authorize.\n");
  assert.equal(erreur({ LANG: "fr_FR.UTF-8" }), "Ce texte n'est pas le bloc renvoyé par rclone authorize.\n");
  assert.equal(erreur({ LANG: "en_US.UTF-8" }), "This text is not the block returned by rclone authorize.\n");
  const js = readFileSync(join(DEPLOY, "jeton-drive.mjs"), "utf8");
  const fautes: string[] = [];
  for (const m of js.matchAll(/\bmsg\(\s*"((?:\\.|[^"\\])*)",\s*"((?:\\.|[^"\\])*)"\s*\)/g)) {
    fautes.push(...frenchFaults(m[1]).map((f) => `fr : ${f}`), ...englishFaults(m[2]).map((f) => `en : ${f}`));
  }
  assert.ok((js.match(/\bmsg\(/g) ?? []).length >= 6, "chaque message du décodeur passe par msg");
  assert.deepEqual(fautes, []);
});

// Écart (décision du contrôleur) : la fiche faisait passer ce test en sourçant le
// script puis en appelant msg avec deux textes écrits dans le test lui-même, ce qui
// ne prouve que le chargement de langue.sh, jamais les messages réels de
// mettre-a-jour.sh. Ici le script est exécuté pour de vrai (jamais sourcé), sans
// root : la toute première ligne du bloc principal (protégé par le garde-fou
// BASH_SOURCE, avant SOURCE=, avant tout accès disque) est le contrôle
// `[ "$(id -u)" -eq 0 ] || echec …`, un chemin qui s'arrête avant toute action,
// comme à l'étape 6 de la tâche 17. Le message de refus attendu est copié tel
// quel du script, dans chaque langue.
function refusMettreAJourSansRoot(vars: Record<string, string>): string {
  try {
    execFileSync("bash", [join(DEPLOY, "mettre-a-jour.sh")], { encoding: "utf8", env: envWith(vars), stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    return String((e as { stderr?: string }).stderr);
  }
  throw new Error("mettre-a-jour.sh aurait dû refuser de s'exécuter sans root");
}

test("mise à jour : messages dans la langue en cours (en puis fr), refus réel sans root", () => {
  assert.equal(refusMettreAJourSansRoot({ LAMA_LANGUE: "en" }), "Run this script with sudo.\n");
  assert.equal(refusMettreAJourSansRoot({ LAMA_LANGUE: "fr" }), "Lancez ce script avec sudo.\n");
});

test("guide du technicien en anglais : même plan et mêmes commandes que LISEZMOI, typographie anglaise (spec § 8.1)", () => {
  const fr = read("LISEZMOI.md");
  const en = read("README.md");
  for (const heading of ["## Install", "## Recovery keys", "## Backup drive", "## Google Drive", "## Update", "## Restore a backup", "## Recover from a server failure", "## Monitoring", "## Script language"]) {
    assert.ok(en.includes(heading), heading);
  }
  assert.ok(fr.includes("## Langue des scripts"), "section de la langue dans LISEZMOI");
  const titres = (doc: string) => doc.split("\n").filter((l) => l.startsWith("## ")).length;
  assert.equal(titres(en), titres(fr), "autant de sections");
  const commandes = (doc: string) => [...doc.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((m) => m[1].split("\n").map((l) => l.replace(/\s+#.*$/, "").trim()).filter(Boolean).join("\n"));
  assert.deepEqual(commandes(en), commandes(fr), "mêmes commandes, commentaires traduits");
  for (const doc of [fr, en]) {
    assert.match(doc, /LAMA_LANGUE=en/);
    assert.doesNotMatch(doc, /\u2014/);
  }
  assert.match(fr, /\(README\.md\)/);
  assert.match(en, /\(LISEZMOI\.md\)/);
  let inCode = false;
  en.split("\n").forEach((line, i) => {
    if (line.startsWith("```")) { inCode = !inCode; return; }
    if (inCode) return;
    assert.doesNotMatch(line.replace(/`[^`]*`/g, "code"), /\s[:;!?]/, `README.md ligne ${i + 1}`);
  });
});

// ── Sous-projet 7, vague 2 : passerelle WAHA (Docker) ──

/**
 * Exécute une fonction de deploy/waha.sh avec une commande docker simulée,
 * qui note chacun de ses appels dans `journal` (une ligne par appel) et réussit
 * sauf pour les sous-commandes listées dans `echecs`. Ne lance aucun conteneur.
 */
function essaiWaha(appel: string, opts: { echecs?: string[]; enPlace?: { image: string; running?: boolean; env?: string } } = {}): { journal: string[]; code: number; sortie: string } {
  const dir = mkdtempSync(join(tmpdir(), "lama-waha-"));
  const journal = join(dir, "docker.log");
  writeFileSync(journal, "");
  const echecs = (opts.echecs ?? []).map((e) => `"${e}"`).join("|") || "__aucun__";
  const p = opts.enPlace;
  const inspect = p
    ? `case "$*" in *Config.Image*) printf '%s\\n' '${p.image} ${p.running === false ? "false" : "true"}' ;; *Config.Env*) printf '%s\\n' '${p.env ?? "PATH=/usr/bin"}' ;; esac`
    : "return 1";
  const script = join(dir, "essai.sh");
  writeFileSync(
    script,
    `#!/usr/bin/env bash\nset -euo pipefail\ndocker() {\n  printf '%s\\n' "$*" >> '${journal}'\n  case "$1" in ${echecs}) return 1 ;; esac\n  if [ "$1" = inspect ]; then ${inspect}; fi\n}\nsource '${join(DEPLOY, "waha.sh")}'\n${appel}\n`,
  );
  try {
    const sortie = execFileSync("bash", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: envWith({ LAMA_LANGUE: "fr" }) });
    return { journal: readFileSync(journal, "utf8").split("\n").filter(Boolean), code: 0, sortie };
  } catch (erreur) {
    const e = erreur as { status: number; stderr: string };
    return { journal: readFileSync(journal, "utf8").split("\n").filter(Boolean), code: e.status, sortie: e.stderr };
  }
}

test("WAHA : version figée dans l'archive, celle vérifiée au sous-projet 7", () => {
  assert.equal(read("waha.version").trim(), "2026.9.1");
});

test("image_waha : image GOWS selon le processeur, autre processeur refusé", () => {
  assert.equal(essaiWaha("image_waha amd64 2026.9.1").sortie, "devlikeapro/waha:gows-2026.9.1");
  assert.equal(essaiWaha("image_waha arm64 2026.9.1").sortie, "devlikeapro/waha:gows-arm-2026.9.1");
  assert.notEqual(essaiWaha("image_waha armhf 2026.9.1").code, 0);
});

test("preparer_cle_waha : clé de 64 caractères hexadécimaux en 0600, gardée d'une installation à l'autre", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-waha-cle-"));
  const fichier = join(dir, "waha.env");
  assert.equal(essaiWaha(`preparer_cle_waha '${fichier}'`).code, 0);
  const premier = readFileSync(fichier, "utf8");
  assert.match(premier, /^WAHA_API_KEY=[0-9a-f]{64}\n$/);
  assert.equal(statSync(fichier).mode & 0o777, 0o600);
  assert.equal(essaiWaha(`preparer_cle_waha '${fichier}'`).code, 0);
  assert.equal(readFileSync(fichier, "utf8"), premier);
});

test("preparer_cle_waha : fichier abîmé refusé plutôt qu'une clé illisible", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-waha-cle-"));
  const fichier = join(dir, "waha.env");
  writeFileSync(fichier, "WAHA_API_KEY=\n");
  assert.notEqual(essaiWaha(`preparer_cle_waha '${fichier}'`).code, 0);
});

test("lancer_waha : image tirée d'abord, ancien mis de côté puis retiré, neuf sur 127.0.0.1 seulement, relancé seul, session dans un volume", () => {
  const { code, journal } = essaiWaha("lancer_waha devlikeapro/waha:gows-2026.9.1 /etc/lama/waha.env", { enPlace: { image: "devlikeapro/waha:gows-2026.8.1" } });
  assert.equal(code, 0);
  const tirage = journal.findIndex((l) => l.startsWith("pull "));
  const miseDeCote = journal.indexOf("rename lama-waha lama-waha-ancien");
  const lancement = journal.findIndex((l) => l.startsWith("run "));
  assert.ok(tirage >= 0 && tirage < miseDeCote && miseDeCote < lancement, journal.join("\n"));
  assert.equal(journal.at(-1), "rm -f lama-waha-ancien");
  const run = journal[lancement];
  assert.match(run, /--name lama-waha /);
  assert.match(run, /--restart unless-stopped /);
  assert.match(run, /-p 127\.0\.0\.1:3000:3000 /);
  assert.match(run, /-v lama-waha-sessions:\/app\/\.sessions /);
  assert.match(run, /--env-file \/etc\/lama\/waha\.env /);
  assert.match(run, /-e WHATSAPP_DEFAULT_ENGINE=GOWS /);
  assert.match(run, /-e WAHA_DASHBOARD_ENABLED=False /);
  assert.match(run, /-e WHATSAPP_SWAGGER_ENABLED=False /);
  assert.match(run, / devlikeapro\/waha:gows-2026\.9\.1$/);
  assert.doesNotMatch(run, /WAHA_API_KEY/, "la clé ne passe jamais dans la ligne de commande");
});

test("lancer_waha : image introuvable, l'ancien conteneur reste en service", () => {
  const { code, journal } = essaiWaha("lancer_waha devlikeapro/waha:gows-2026.9.1 /etc/lama/waha.env", { echecs: ["pull"], enPlace: { image: "devlikeapro/waha:gows-2026.8.1" } });
  assert.notEqual(code, 0);
  assert.ok(!journal.some((l) => /^(rm|run|stop|rename) /.test(l)), journal.join("\n"));
});

test("lancer_waha : déjà en service sur la même image et la même clé, rien n'est touché (session gardée)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-waha-cle-"));
  const cle = `WAHA_API_KEY=${"c".repeat(64)}`;
  writeFileSync(join(dir, "waha.env"), `${cle}\n`);
  const image = "devlikeapro/waha:gows-2026.9.1";
  const meme = essaiWaha(`lancer_waha ${image} '${join(dir, "waha.env")}'`, { enPlace: { image, env: cle } });
  assert.equal(meme.code, 0);
  assert.ok(!meme.journal.some((l) => /^(pull|rm|run|stop|rename) /.test(l)), meme.journal.join("\n"));
  const autreCle = essaiWaha(`lancer_waha ${image} '${join(dir, "waha.env")}'`, { enPlace: { image, env: `WAHA_API_KEY=${"d".repeat(64)}` } });
  assert.ok(autreCle.journal.some((l) => l.startsWith("run ")), "clé changée : conteneur refait");
  const arrete = essaiWaha(`lancer_waha ${image} '${join(dir, "waha.env")}'`, { enPlace: { image, env: cle, running: false } });
  assert.ok(arrete.journal.some((l) => l.startsWith("run ")), "conteneur arrêté : refait");
});

test("lancer_waha : le neuf ne démarre pas (port pris), l'ancien est remis en service", () => {
  const { code, journal } = essaiWaha("lancer_waha devlikeapro/waha:gows-2026.9.1 /etc/lama/waha.env", { echecs: ["run"], enPlace: { image: "devlikeapro/waha:gows-2026.8.1" } });
  assert.notEqual(code, 0);
  assert.ok(journal.includes("rename lama-waha-ancien lama-waha"), journal.join("\n"));
  assert.equal(journal.at(-1), "start lama-waha");
});

test("installation : Docker d'Ubuntu installé par l'étape WAHA seulement, étape WAHA après la vérification de lama, clé inscrite par le compte du service via l'entrée standard", () => {
  const s = read("installer.sh");
  assert.doesNotMatch(s, /apt-get install -y -q [^\n]*\bdocker\.io\b/, "Docker hors des paquets obligatoires : son échec ne doit pas arrêter lama");
  assert.match(read("waha.sh"), /apt-get install -y -q docker\.io \|\|/);
  assert.match(s, /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/waha\.sh"/);
  assert.ok(s.indexOf('lama_repond "$CONF"') > 0 && s.lastIndexOf("installer_waha") > s.indexOf('lama_repond "$CONF"'), "WAHA s'installe une fois lama en service (base migrée)");
  const waha = read("waha.sh");
  assert.match(waha, /runuser -u "\$COMPTE_SERVICE" -- \/usr\/bin\/node "\$APP_DIR\/dist-server\/cli\.mjs" waha-cle/);
  assert.doesNotMatch(waha, /cli\.mjs" waha-cle "/, "la clé ne passe jamais en argument");
  assert.doesNotMatch(waha, /\becho[^\n]*\$CLE_WAHA/, "la clé n'est jamais affichée");
});

test("installation et mise à jour : WAHA en échec ne fait pas échouer lama, consigne de relance", () => {
  for (const name of ["installer.sh", "mettre-a-jour.sh"]) {
    const s = read(name);
    assert.match(s, /installer_waha [^\n]* \|\| echo "\$\(msg "[^"\n]*WhatsApp/, name);
  }
  assert.ok(read("mettre-a-jour.sh").lastIndexOf("installer_waha") > read("mettre-a-jour.sh").indexOf("rm -f \"$TEMOIN\""), "WAHA mis à jour seulement si la nouvelle version répond");
});

test("restauration : la clé de WAHA de cette machine est réinscrite dans la base restaurée", () => {
  const s = read("restaurer.sh");
  assert.ok(s.lastIndexOf("inscrire_cle_waha") > s.lastIndexOf("repond ||"), "après le redémarrage du service");
});

/**
 * Exécute installer_waha de deploy/waha.sh avec docker, systemctl, dpkg, curl
 * et runuser simulés (aucune action réelle) ; `runuser` recopie son entrée
 * standard dans `recu`, pour vérifier que la clé y passe.
 */
function essaiInstallerWaha(echecs: string[]): { code: number; sortie: string; recu: string; cle: string; appels: string } {
  const dir = mkdtempSync(join(tmpdir(), "lama-installer-waha-"));
  const conf = join(dir, "conf");
  mkdirSync(conf);
  const recu = join(dir, "recu");
  const appels = join(dir, "appels");
  writeFileSync(recu, "");
  writeFileSync(appels, "");
  const echoue = (nom: string) => (echecs.includes(nom) ? "return 1" : "true");
  const script = join(dir, "essai.sh");
  writeFileSync(script, `#!/usr/bin/env bash
set -euo pipefail
docker() { printf 'docker %s\\n' "$*" >> '${appels}'; case "$1" in pull) ${echoue("pull")} ;; run) ${echoue("run")} ;; inspect) return 1 ;; esac; }
systemctl() { printf 'systemctl %s\\n' "$*" >> '${appels}'; ${echoue("systemctl")}; }
dpkg() { printf 'arm64'; }
curl() { cat > /dev/null; ${echoue("curl")}; }
sleep() { :; }
runuser() { printf 'runuser %s\\n' "$*" >> '${appels}'; cat > '${recu}'; ${echoue("runuser")}; }
source '${join(DEPLOY, "waha.sh")}'
installer_waha '${join(DEPLOY, "..")}' '${conf}' lama
`);
  let code = 0;
  let sortie = "";
  try {
    sortie = execFileSync("bash", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: envWith({ LAMA_LANGUE: "fr" }) });
  } catch (erreur) {
    const e = erreur as { status: number; stderr: string };
    code = e.status;
    sortie = e.stderr;
  }
  const fichier = join(conf, "waha.env");
  const cle = (() => { try { return readFileSync(fichier, "utf8").replace(/^WAHA_API_KEY=/, "").trim(); } catch { return ""; } })();
  return { code, sortie, recu: readFileSync(recu, "utf8"), cle, appels: readFileSync(appels, "utf8") };
}

test("installer_waha : image ARM de la version figée, clé passée au compte du service par l'entrée standard, consigne pour l'administrateur", () => {
  const r = essaiInstallerWaha([]);
  assert.equal(r.code, 0, r.sortie);
  assert.match(r.appels, /docker pull -q devlikeapro\/waha:gows-arm-2026\.9\.1/);
  assert.match(r.appels, /runuser -u lama -- \/usr\/bin\/node [^\n]*\/dist-server\/cli\.mjs waha-cle\n/);
  assert.match(r.cle, /^[0-9a-f]{64}$/);
  assert.equal(r.recu.trim(), r.cle, "la clé arrive par l'entrée standard");
  assert.ok(!r.appels.includes(r.cle), "la clé n'est jamais en argument");
  assert.match(r.sortie, /choisissez WAHA dans Réglages, WhatsApp/);
});

test("installer_waha : chaque échec renvoie 1 avec son motif, sans inscrire la clé", () => {
  for (const [echec, motif] of [["systemctl", /Docker ne démarre pas/], ["pull", /n'a pas pu être téléchargée ou lancée/], ["curl", /WAHA ne répond pas/], ["runuser", /n'a pas pu être inscrite/]] as const) {
    const r = essaiInstallerWaha([echec]);
    assert.equal(r.code, 1, echec);
    assert.match(r.sortie, motif, echec);
    if (echec !== "runuser") assert.equal(r.recu, "", `${echec} : clé non inscrite`);
  }
});

// ── Installation automatique ou assistée (choisir_mode, demander, demander_texte) ──

/** Lance `appel` après avoir chargé installer.sh (fonctions seules), avec `entree` sur l'entrée standard. */
function fonctionInstalleur(appel: string, entree = "", vars: Record<string, string> = {}): { code: number; sortie: string; erreur: string } {
  const r = spawnSync("bash", ["-c", `set -euo pipefail; source '${join(DEPLOY, "installer.sh")}'; ${appel}`], {
    input: entree, encoding: "utf8", env: envWith({ LAMA_LANGUE: "fr", ...vars }),
  });
  return { code: r.status ?? -1, sortie: r.stdout, erreur: r.stderr };
}

test("choisir_mode : options --auto et --assiste (--assisted), menu sinon, Entrée ou entrée fermée = automatique", () => {
  assert.equal(fonctionInstalleur("choisir_mode --auto").sortie, "auto");
  assert.equal(fonctionInstalleur("choisir_mode --assiste").sortie, "assiste");
  assert.equal(fonctionInstalleur("choisir_mode --assisted").sortie, "assiste");
  const inconnue = fonctionInstalleur("choisir_mode --vite");
  assert.equal(inconnue.code, 1);
  assert.match(inconnue.erreur, /Option inconnue\u00a0: --vite/);
  const menu = fonctionInstalleur("choisir_mode", "3\n2\n");
  assert.equal(menu.sortie, "assiste", "une réponse hors menu est redemandée");
  assert.match(menu.erreur, /1\. Automatique\u00a0: réglages par défaut, aucune question\n  2\. Assistée/);
  assert.equal(fonctionInstalleur("choisir_mode", "\n").sortie, "auto");
  assert.equal(fonctionInstalleur("choisir_mode", "").sortie, "auto", "entrée fermée : pas de boucle sans fin");
  assert.match(fonctionInstalleur("choisir_mode", "1\n", { LAMA_LANGUE: "en" }).erreur, /1\. Automatic: default settings, no questions/);
});

test("demander : mode automatique, réponse par défaut sans rien lire ; mode assisté, réponse lue, défaut sur Entrée", () => {
  const oui = (appel: string, entree = "", mode = "auto") => fonctionInstalleur(`MODE=${mode}; if ${appel}; then echo OUI; else echo NON; fi`, entree);
  assert.equal(oui('demander "WhatsApp ?" o', "n\n").sortie, "OUI\n", "automatique : la réponse tapée est ignorée");
  assert.equal(oui('demander "Formation ?" n', "o\n").sortie, "NON\n");
  assert.equal(oui('demander "Formation ?" n', "", "auto").erreur, "", "automatique : aucune question affichée");
  assert.equal(oui('demander "WhatsApp ?" o', "\n", "assiste").sortie, "OUI\n");
  assert.equal(oui('demander "Formation ?" n', "\n", "assiste").sortie, "NON\n");
  assert.equal(oui('demander "Formation ?" n', "peut-être\noui\n", "assiste").sortie, "OUI\n", "réponse inconnue redemandée");
  assert.equal(oui('demander "WhatsApp ?" o', "non\n", "assiste").sortie, "NON\n");
  assert.equal(oui('demander "Formation ?" n', "", "assiste").sortie, "NON\n", "entrée fermée : défaut");
  assert.match(oui('demander "WhatsApp ?" o', "\n", "assiste").erreur, /WhatsApp \? \[O\/n\]/);
  assert.equal(fonctionInstalleur('demander_texte "Fuseau" Africa/Douala', "\n").sortie, "Africa/Douala");
  assert.equal(fonctionInstalleur('demander_texte "Fuseau" Africa/Douala', "Europe/Paris\n").sortie, "Europe/Paris");
});

test("installation : WhatsApp, veille, disque neuf, formation et Google Drive passent par demander ; disque effacé seulement par preparer-disque.sh", () => {
  const s = read("installer.sh");
  assert.match(s, /MODE="\$\(choisir_mode "\$\{1:-\}"\)" \|\| exit 1/);
  assert.match(s, /if demander "[^\n]*WhatsApp[^\n]*" o; then\n  installer_waha/);
  assert.match(s, /&& demander "[^\n]*mise en veille[^\n]*" o; then/);
  assert.match(s, /if demander "[^\n]*base de formation[^\n]*" n; then/);
  assert.match(s, /if demander "[^\n]*Google Drive[^\n]*" n; then/);
  assert.match(s, /if \[ "\$MODE" = "assiste" \] && ! blkid -L LAMA-SAUVEGARDE/);
  assert.match(s, /grep -xF -- "\$\{NOM_DISQUE#\/dev\/\}" >\/dev\/null; then\n\s+"\$APP\/actuelle\/deploy\/preparer-disque\.sh"/, "seul un disque USB de la liste est proposé à l'effacement");
  assert.doesNotMatch(s, /\b(mkfs|wipefs|sgdisk)\b|\bparted\s+(-\w+\s+)*["$/]/, "installer.sh n'efface jamais un disque lui-même");
});

// ── Mise à jour par le réseau (spec du 21/10/2026), vague 1 ──

/** Version que fabriquer-paquet.sh écrirait pour la racine donnée (fonction version_a_fabriquer seule). */
function versionAFabriquer(racine: string, publiee: "0" | "1"): { code: number; version: string } {
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, "fabriquer-paquet.sh")}'; version_a_fabriquer "$1" "$2"`, "essai", racine, publiee], { encoding: "utf8", env: envWith({ LAMA_LANGUE: "fr" }) });
  return { code: r.status ?? -1, version: r.stdout };
}

test("paquet : version publiée prise dans package.json (--publiee), sinon AAAAMMJJ-HHMM-empreinte (M-1)", () => {
  const racine = mkdtempSync(join(tmpdir(), "lama-paquet-"));
  writeFileSync(join(racine, "package.json"), JSON.stringify({ name: "lama", version: "1.4.2" }));
  execFileSync("git", ["-C", racine, "init", "--quiet"]);
  execFileSync("git", ["-C", racine, "-c", "user.name=Essai", "-c", "user.email=essai@exemple.cm", "-c", "commit.gpgsign=false", "add", "package.json"]);
  execFileSync("git", ["-C", racine, "-c", "user.name=Essai", "-c", "user.email=essai@exemple.cm", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "essai"]);
  assert.deepEqual(versionAFabriquer(racine, "1"), { code: 0, version: "1.4.2" });
  assert.match(versionAFabriquer(racine, "0").version, /^\d{8}-\d{4}-[0-9a-f]+$/);
  writeFileSync(join(racine, "package.json"), JSON.stringify({ name: "lama", version: "1.4.2-beta" }));
  assert.notEqual(versionAFabriquer(racine, "1").code, 0, "version de package.json hors de X.Y.Z");
  const s = read("fabriquer-paquet.sh");
  assert.match(s, /--publiee\) PUBLIEE=1 ;;/);
  assert.match(s, /VERSION="\$\(version_a_fabriquer "\$RACINE" "\$PUBLIEE"\)"/);
});

/** Lance une fonction de mettre-a-jour.sh chargé par « source » ; sortie d'erreur rendue. */
function majFonction(appel: string, args: string[], vars: Record<string, string> = {}): { code: number; sortie: string; erreur: string } {
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, "mettre-a-jour.sh")}'; ${appel} "$@"`, "essai", ...args], { encoding: "utf8", env: envWith({ LAMA_LANGUE: "fr", ...vars }) });
  return { code: r.status ?? -1, sortie: r.stdout, erreur: r.stderr };
}

test("nettoyage : trié par date d'installation, jamais par nom ; version installée et précédente gardées (Review Focus 3)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-versions-"));
  const maintenant = Date.now();
  // Du plus ancien au plus récent installé ; un tri par nom placerait 20261021-… en tête et supprimerait 1.10.0.
  ["1.0.0", "1.9.3", "20261021-1030-abc", "1.10.0", "1.11.0"].forEach((nom, i) => {
    mkdirSync(join(dossier, nom));
    const quand = new Date(maintenant - (5 - i) * 60_000);
    utimesSync(join(dossier, nom), quand, quand);
  });
  const r = majFonction("versions_a_supprimer", [dossier, "3", "1.11.0", "1.0.0"]);
  assert.equal(r.code, 0, r.erreur);
  assert.deepEqual(r.sortie.split("\n").filter(Boolean), ["1.9.3"]);
});

test("mise à jour : étapes annoncées au service root seulement s'il les demande (M-10)", () => {
  assert.equal(majFonction("marque", ["sauvegarde"]).sortie, "");
  assert.equal(majFonction("marque", ["sauvegarde"], { LAMA_MARQUES_ETAPES: "1" }).sortie, "@etape sauvegarde\n");
  const s = read("mettre-a-jour.sh");
  const ordre = ["marque sauvegarde", "systemctl start lama-sauvegarde.service", "marque installation", 'cp -R "$SOURCE"', "marque controle", "systemctl restart lama.service"];
  let avant = -1;
  for (const pas of ordre) {
    const i = s.indexOf(pas);
    assert.ok(i > avant, `ordre : ${pas}`);
    avant = i;
  }
});

test("mise à jour : codes de sortie par motif, lus par le service root (M-10)", () => {
  const s = read("mettre-a-jour.sh");
  assert.match(s, /^SORTIE_SAUVEGARDE=3$/m);
  assert.match(s, /^SORTIE_DEMARRAGE=4$/m);
  assert.match(s, /^SORTIE_VERIFICATION=5$/m);
  assert.match(s, /echec_code "\$SORTIE_SAUVEGARDE" "\$\(msg "La sauvegarde a échoué\./);
  assert.match(s, /echec_code "\$SORTIE_DEMARRAGE" "\$\(msg "Mise à jour annulée, la version précédente est de nouveau en service/);
  assert.match(s, /controle_signature "\$SOURCE" "\$VERSION" "\$APP\/actuelle\/deploy\/cle-publique\.pem" "\$SANS_SIGNATURE" \|\| exit "\$SORTIE_VERIFICATION"/);
  assert.ok(s.indexOf("controle_signature \"$SOURCE\"") < s.indexOf("marque sauvegarde"), "vérification avant tout geste");
});

test("mise à jour : une seule à la fois ; le service root qui tient déjà le verrou n'attend pas (M-9)", () => {
  const s = read("mettre-a-jour.sh");
  assert.match(s, /^VERROU=\/run\/lama-mise-a-jour\.verrou$/m);
  assert.match(s, /if \[ "\$\{LAMA_VERROU_TENU:-0\}" != 1 \]; then\n(?:    #.*\n)*    \( umask 077 && : >> "\$VERROU" \)\n    chmod 0600 "\$VERROU"\n    exec 9>"\$VERROU"\n    flock -n 9 \|\| echec/);
  assert.ok(s.indexOf("flock -n 9") < s.indexOf("marque sauvegarde"));
});

test("vérification à la main : X.Y.Z sans signature refusée, développement averti, --sans-signature averti (M-6)", () => {
  const sans = preparerVersionEssai({ version: "1.2.0" });
  execFileSync("tar", ["-xzf", join(sans.dossier, "lama-1.2.0.tar.gz"), "-C", sans.dossier]);
  rmSync(join(sans.dossier, "SHA256SUMS"));
  const source = join(sans.dossier, "lama-1.2.0");
  const refus = majFonction("controle_signature", [source, "1.2.0", join(sans.dossier, "absente.pem"), "0"]);
  assert.equal(refus.code, 1);
  assert.match(refus.erreur, /Version 1\.2\.0 sans signature, refusée\u00a0: /);
  const dev = majFonction("controle_signature", [source, "20261021-1030-abc", join(sans.dossier, "absente.pem"), "0"]);
  assert.equal(dev.code, 0);
  assert.match(dev.erreur, /Paquet de développement sans signature/);
  const essai = majFonction("controle_signature", [source, "1.2.0", join(sans.dossier, "absente.pem"), "1"]);
  assert.equal(essai.code, 0);
  assert.match(essai.erreur, /--sans-signature\u00a0: archive installée sans vérification, réservé aux essais\./);
});

test("vérification à la main : clé en service, autre clé, dossier modifié, version en service sans clé (M-5, M-6)", (t) => {
  const openssl = opensslEssai();
  if (!openssl) { t.skip(SANS_OPENSSL); return; }
  const cle = paireEssai(openssl);
  const autre = paireEssai(openssl);
  const vars = { LAMA_OPENSSL: openssl };
  const extraire = (o: Parameters<typeof preparerVersionEssai>[0]) => {
    const { dossier } = preparerVersionEssai(o);
    execFileSync("tar", ["-xzf", join(dossier, `lama-${o.version}.tar.gz`), "-C", dossier]);
    return join(dossier, `lama-${o.version}`);
  };
  const bonne = extraire({ version: "1.2.0", openssl, privee: cle.privee });
  assert.equal(majFonction("controle_signature", [bonne, "1.2.0", cle.publique, "0"], vars).code, 0);
  const refus = majFonction("controle_signature", [bonne, "1.2.0", autre.publique, "0"], vars);
  assert.equal(refus.code, 1);
  assert.match(refus.erreur, /^Signature refusée\u00a0: /m);
  writeFileSync(join(bonne, "deploy", "mettre-a-jour.sh"), "#!/usr/bin/env bash\necho falsifié\n");
  assert.match(majFonction("controle_signature", [bonne, "1.2.0", cle.publique, "0"], vars).erreur, /Le dossier extrait ne correspond pas à l'archive signée/);
  // Serveur installé avant les versions signées : la clé de l'archive, avec un avertissement.
  const ancienne = extraire({ version: "1.3.0", openssl, privee: cle.privee, clePublique: cle.publique });
  const sansCle = majFonction("controle_signature", [ancienne, "1.3.0", join(ancienne, "absente.pem"), "0"], vars);
  assert.equal(sansCle.code, 0, sansCle.erreur);
  assert.match(sansCle.erreur, /La version en service n'a pas de clé publique/);
});
