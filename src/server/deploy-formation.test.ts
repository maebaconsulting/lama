import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEMANDE_REMISE_A_ZERO } from "./formation/remise-a-zero.ts";
import { COMPTES_FORMATION } from "./formation/comptes.ts";
import { message } from "./messages.ts";

/**
 * Service et commande de la base de formation (distribution D-14, D-16, D-19) :
 * unité systemd cloisonnée, mots de passe demandés deux fois sans écho et passés
 * par l'entrée standard, remise à zéro dans l'ordre, mise à jour des deux
 * services. Aucune commande système n'est lancée : runuser, systemctl et le
 * programme sont simulés par l'essai.
 */

const DEPLOY = new URL("../../deploy/", import.meta.url).pathname;
const read = (name: string) => readFileSync(join(DEPLOY, name), "utf8");

/** Exécute `appel` après avoir chargé lama-formation.sh, avec des commandes simulées qui notent leurs appels dans `journal`. */
function essai(appel: string, entree = "", langue = "fr", sansCompte: boolean | null = false, deviseLue: string | null = ""): { code: number; sortie: string; erreurs: string; journal: string[]; recu: string } {
  const dir = mkdtempSync(join(tmpdir(), "lama-formation-sh-"));
  const journal = join(dir, "journal");
  const recu = join(dir, "recu");
  writeFileSync(journal, "");
  writeFileSync(recu, "");
  const script = join(dir, "essai.sh");
  writeFileSync(script, [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    `source '${join(DEPLOY, "lama-formation.sh")}'`,
    `comme_formation() { echo "comme_formation $*" >> '${journal}'; cat >> '${recu}'; }`,
    `systemctl() { echo "systemctl $*" >> '${journal}'; }`,
    // Lecture de la vraie base simulée : `deviseLue` sur la sortie, ou un échec (`null`).
    deviseLue === null ? `lire_devise_vraie_base() { echo "lire_devise_vraie_base" >> '${journal}'; return 1; }` : `lire_devise_vraie_base() { echo "lire_devise_vraie_base" >> '${journal}'; printf '%s' '${deviseLue}'; }`,
    `formation_repond() { echo "formation_repond" >> '${journal}'; }`,
    ...(sansCompte === null ? [] : [`remise_sans_compte() { echo "remise_sans_compte" >> '${journal}'; ${sansCompte ? "true" : "false"}; }`]),
    `DATA_FORMATION='${dir}'`,
    appel,
  ].join("\n"));
  const r = spawnSync("bash", [script], { input: entree, encoding: "utf8", env: { ...process.env, LANG: "", LAMA_LANGUE: langue } });
  return { code: r.status ?? -1, sortie: r.stdout, erreurs: r.stderr, journal: readFileSync(journal, "utf8").split("\n").filter(Boolean), recu: readFileSync(recu, "utf8") };
}

const MOTS = ["admin-formation-1", "gerante-formation-1", "reception-form-1", "praticienne-f-1"];

test("unité lama-formation : compte propre, LAMA_FORMATION=1, port sans privilège, vraie base et clés hors d'atteinte, certificat en lecture", () => {
  const unit = read("systemd/lama-formation.service");
  for (const line of [
    "User=lama-formation", "Group=lama-formation", "SupplementaryGroups=lama", "Environment=LAMA_FORMATION=1",
    "Environment=HOME=/var/lib/lama-formation", "ExecStart=/usr/bin/node /opt/lama/actuelle/dist-server/main.mjs",
    "WorkingDirectory=/opt/lama/actuelle", "Restart=always", "UMask=0077", "CapabilityBoundingSet=", "NoNewPrivileges=true",
    "ProtectSystem=strict", "ProtectHome=true", "ReadWritePaths=/var/lib/lama-formation", "ReadOnlyPaths=/etc/lama-formation",
    "TemporaryFileSystem=/etc/lama:ro", "BindReadOnlyPaths=/etc/lama/tls", "InaccessiblePaths=/var/lib/lama -/mnt/lama-sauvegarde",
    "WantedBy=multi-user.target",
  ]) assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`, "m"), line);
  assert.doesNotMatch(unit, /AmbientCapabilities|CAP_NET_BIND_SERVICE|RCLONE_CONFIG/, "port 8443 sans privilège, aucun Google Drive");
  assert.deepEqual(readdirSync(join(DEPLOY, "systemd")).filter((n) => n.includes("formation")), ["lama-formation.service"], "aucune minuterie : ni sauvegarde ni certificat propres à la formation");
});

test("comptes : chaque mot de passe demandé deux fois, trop court ou différent redemandé, les quatre passés au programme par l'entrée standard", () => {
  const entree = ["court", MOTS[0], MOTS[0], MOTS[1], "autre-chose-123", MOTS[1], MOTS[1], MOTS[2], MOTS[2], MOTS[3], MOTS[3]].join("\n") + "\n";
  const r = essai("ecrire_comptes", entree);
  assert.equal(r.code, 0, r.erreurs);
  assert.deepEqual(r.journal, ["lire_devise_vraie_base", "comme_formation /usr/bin/node /opt/lama/actuelle/dist-server/cli.mjs formation-comptes"], "sans réglage lu, aucune option : XAF");
  assert.equal(r.recu, `${MOTS.join("\n")}\n`, "un mot de passe par ligne, dans l'ordre de COMPTES_FORMATION");
  assert.match(r.erreurs, /Mot de passe du compte administration/);
  assert.match(r.erreurs, /Mot de passe du compte praticienne/);
  assert.match(r.erreurs, /Trop court, recommencez\./);
  assert.match(r.erreurs, /Les deux saisies diffèrent, recommencez\./);
  for (const mot of MOTS) assert.ok(!(r.sortie + r.erreurs).includes(mot), "jamais affiché");
});

test("comptes : saisie interrompue (fin de l'entrée), rien n'est passé au programme", () => {
  const r = essai("ecrire_comptes", `${MOTS[0]}\n${MOTS[0]}\n`);
  assert.notEqual(r.code, 0);
  assert.deepEqual(r.journal, ["lire_devise_vraie_base"]);
});

test("comptes : devise de la vraie base lue d'abord, passée en options à formation-comptes ; lecture en échec, rien n'est passé", () => {
  const entree = MOTS.flatMap((m) => [m, m]).join("\n") + "\n";
  const r = essai("ecrire_comptes", entree, "fr", false, "--devise\nEUR\n--position\navant\n--symbole-ecran\nnon\n");
  assert.equal(r.code, 0, r.erreurs);
  assert.deepEqual(r.journal, ["lire_devise_vraie_base", "comme_formation /usr/bin/node /opt/lama/actuelle/dist-server/cli.mjs formation-comptes --devise EUR --position avant --symbole-ecran non"]);
  assert.equal(r.recu, `${MOTS.join("\n")}\n`);
  const echec = essai("ecrire_comptes", entree, "fr", false, null);
  assert.notEqual(echec.code, 0);
  assert.deepEqual(echec.journal, ["lire_devise_vraie_base"]);
  assert.match(echec.erreurs, /La devise de la vraie base n'a pas pu être lue\./);
  assert.equal(echec.recu, "", "aucun mot de passe demandé ni passé");
});

test("lecture de la devise : sous le compte de lama, sur la vraie base, hors mode formation", () => {
  const s = read("lama-formation.sh");
  assert.match(s, /^COMPTE_LAMA=lama$/m);
  assert.match(s, /^lire_devise_vraie_base\(\) \{ \( cd \/ && runuser -u "\$COMPTE_LAMA" -- env -u LAMA_FORMATION -u LAMA_DEMO_PUBLIQUE LAMA_DATA_DIR=\/var\/lib\/lama LAMA_CONFIG_DIR=\/etc\/lama HOME=\/var\/lib\/lama \/usr\/bin\/node "\$APP\/actuelle\/dist-server\/cli\.mjs" lire-devise \); \}$/m);
});

test("remise à zéro : service arrêté, demande déposée par le compte de la formation, service relancé, réponse attendue", () => {
  const r = essai("remettre_a_zero");
  assert.equal(r.code, 0, r.erreurs);
  assert.deepEqual(r.journal.map((l) => l.replace(/ \S+\/(remise-a-zero\.demandee)$/, " DATA/$1")), [
    "systemctl stop lama-formation.service",
    `comme_formation touch DATA/${DEMANDE_REMISE_A_ZERO}`,
    "systemctl start lama-formation.service",
    "formation_repond",
    "remise_sans_compte",
  ]);
  assert.doesNotMatch(r.sortie, /--comptes/, "comptes gardés : aucune invitation");
  assert.doesNotMatch(r.journal.join("\n"), /enable|is-enabled/, "démarrage seulement, jamais enable");
  assert.match(r.sortie, /Base de formation remise à zéro, démonstration recréée, comptes gardés\./);
  assert.match(read("lama-formation.sh"), new RegExp(`^DEMANDE=${DEMANDE_REMISE_A_ZERO.replace(/\./g, "\\.")}$`, "m"), "même nom que le serveur");
});

test("remise à zéro : base non installée (dossier de données absent), rien n'est arrêté ni lancé", () => {
  const r = essai('DATA_FORMATION=/inexistant/formation; remettre_a_zero');
  assert.notEqual(r.code, 0);
  assert.match(r.erreurs, /La base de formation n'est pas installée/);
  assert.deepEqual(r.journal, []);
});

test("remise à zéro : aucun compte gardé, la commande l'indique et invite à lancer --comptes (fr et en)", () => {
  const fr = essai("remettre_a_zero", "", "fr", true);
  assert.equal(fr.code, 0, fr.erreurs);
  assert.match(fr.sortie, /aucun compte gardé, lancez sudo lama-formation --comptes\./);
  assert.doesNotMatch(fr.sortie, /comptes gardés/, "pas d'affirmation contraire");
  const en = essai("remettre_a_zero", "", "en", true).sortie;
  assert.match(en, /no account kept, run sudo lama-formation --comptes\./);
  assert.doesNotMatch(en, /accounts kept/);
  const normal = essai("remettre_a_zero").sortie;
  assert.match(normal, /comptes gardés\./);
  assert.doesNotMatch(normal, /aucun compte/i);
});

test("détection « aucun compte gardé » : les textes réels du serveur (fr et en) sont reconnus, un journal ordinaire est ignoré", () => {
  const detecte = (journal: string) => essai(`journal_formation() { cat <<'JOURNAL'\n${journal}\nJOURNAL\n}\nremise_sans_compte "2026-01-01 00:00:00"`, "", "fr", null).code === 0;
  for (const lang of ["fr", "en"] as const) {
    for (const cle of ["formation.remise_sans_compte", "formation.remise_illisible"] as const) {
      assert.ok(detecte(`lama démarre\n${message(lang, cle)}\nlama écoute`), `${lang} ${cle}`);
    }
    assert.ok(!detecte(`lama démarre\n${message(lang, "formation.remise_comptes", { comptes: "formation.admin" })}\nlama écoute`), `${lang} comptes gardés`);
  }
  assert.ok(!detecte("lama démarre\nlama écoute sur 8443"));
});

test("comme_formation : masque 077, base et demande jamais lisibles de tous", () => {
  assert.match(read("lama-formation.sh"), /^comme_formation\(\) \{ \( umask 077; cd \/ && runuser /m);
});

test("comme_formation : sous le compte de la formation, sur ses dossiers, jamais ceux de l'environnement", () => {
  const s = read("lama-formation.sh");
  assert.match(s, /runuser -u "\$COMPTE_FORMATION" -- env LAMA_FORMATION=1 LAMA_DATA_DIR="\$DATA_FORMATION" LAMA_CONFIG_DIR="\$CONF_FORMATION" HOME=/);
  assert.match(s, /^DATA_FORMATION=\/var\/lib\/lama-formation$/m);
  assert.match(s, /^CONF_FORMATION=\/etc\/lama-formation$/m);
});

test("comptes : la longueur du mot de passe compte des caractères, non des octets", () => {
  const r = essai("ecrire_comptes", ["éééééé", "éééééé", ...MOTS.flatMap((m) => [m, m])].join("\n") + "\n");
  assert.equal(r.code, 0, r.erreurs);
  assert.match(r.erreurs, /Trop court, recommencez\./, "six caractères (douze octets) refusés");
});

test("commande : LOGINS du script égal aux identifiants de COMPTES_FORMATION", () => {
  const m = read("lama-formation.sh").match(/^LOGINS="(.*)"$/m);
  assert.ok(m);
  assert.equal(m[1], COMPTES_FORMATION.map((c) => c.login).join(", "));
});

test("certificat : le renouvellement relance aussi la base de formation", () => {
  assert.match(read("lama-certificat.sh"), /systemctl try-restart lama-formation\.service/);
});

test("commande : refusée sans root, dans la langue des scripts", { skip: process.getuid?.() === 0 }, () => {
  const refus = (langue: string) => {
    try {
      execFileSync("bash", [join(DEPLOY, "lama-formation.sh"), "--etat"], { encoding: "utf8", env: { ...process.env, LANG: "", LAMA_LANGUE: langue }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return String((e as { stderr?: string }).stderr);
    }
    throw new Error("lama-formation.sh aurait dû refuser de s'exécuter sans root");
  };
  assert.equal(refus("fr"), "Lancez cette commande avec sudo.\n");
  assert.equal(refus("en"), "Run this command with sudo.\n");
});

test("installation dans l'ordre (compte, clé propre, service, comptes, démarrage)", () => {
  const s = read("lama-formation.sh");
  const corps = s.slice(s.indexOf("installer_formation() {"), s.indexOf("# Service, adresse et comptes de la formation."));
  const ordre = [
    'creer_compte_service "$COMPTE_FORMATION" "$UID_FORMATION" "$DATA_FORMATION"',
    'head -c 32 /dev/urandom | base64 > "$CONF_FORMATION/master.key"',
    'install -m 0644 "$APP/actuelle/deploy/systemd/$SERVICE_FORMATION" /etc/systemd/system/',
    'ln -sfn "$APP/actuelle/deploy/lama-formation.sh" /usr/local/sbin/lama-formation',
    "ecrire_comptes",
    'systemctl enable "$SERVICE_FORMATION"',
    'systemctl restart "$SERVICE_FORMATION"',
    "formation_repond",
  ];
  let at = -1;
  for (const etape of ordre) {
    const i = corps.indexOf(etape, at + 1);
    assert.ok(i > at, `ordre : ${etape}`);
    at = i;
  }
  assert.match(s, /^UID_FORMATION=872$/m);
  assert.match(s, /comme_formation\(\) \{ \( umask 077; cd \/ && runuser -u "\$COMPTE_FORMATION" -- env LAMA_FORMATION=1 /m);
});

test("mise à jour : la base de formation relancée sur la nouvelle version une fois lama vérifiée ; l'installation la propose", () => {
  const s = read("mettre-a-jour.sh");
  const verifiee = s.indexOf('rm -f "$TEMOIN"');
  assert.ok(verifiee > 0 && s.indexOf("systemctl try-restart lama-formation.service || true") > verifiee);
  assert.match(read("installer.sh"), /sudo \$APP\/actuelle\/deploy\/lama-formation\.sh --installer/);
});

test("messages de lama-formation.sh : tous par msg, dans les deux langues", () => {
  const unilingues = read("lama-formation.sh").split("\n").filter((l) => /\b(echo|echec|printf) "(?!\$\(msg )[^"$]*\p{L}{3}/u.test(l));
  assert.deepEqual(unilingues, []);
  const anglais = essai("remettre_a_zero", "", "en");
  assert.match(anglais.sortie, /Training database reset, demonstration recreated, accounts kept\./);
});
