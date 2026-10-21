import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEPLOY, envEssai, opensslEssai, paireEssai, preparerVersionEssai, SANS_OPENSSL } from "./deploy-essais.ts";

/**
 * Service root de mise à jour par le réseau (spec du 21/10/2026, M-7 à M-11) :
 * deploy/mise-a-jour-reseau.sh, fonction par fonction, puis tout son déroulé
 * dans une racine d'essai, avec curl, runuser et flock simulés.
 */

/** Dossier de programmes simulés : runuser lance la commande telle quelle, sans changer de compte. */
const PROGRAMMES = mkdtempSync(join(tmpdir(), "lama-reseau-programmes-"));
writeFileSync(join(PROGRAMMES, "runuser"), "#!/usr/bin/env bash\n[ \"$1\" = -u ] && shift 2\n[ \"$1\" = -- ] && shift\nexec \"$@\"\n");
chmodSync(join(PROGRAMMES, "runuser"), 0o755);
// timeout absent (Mac sans coreutils) : remplacé par un perl qui lance la commande dans son propre
// groupe et, le délai passé, tue tout le groupe (comme timeout de GNU), puis rend 124.
if (spawnSync("bash", ["-c", "command -v timeout"]).status !== 0) {
  const perl = "$d=shift; setpgrp(0,0); $p=fork; if(!$p){exec @ARGV or die} $SIG{ALRM}=sub{$SIG{TERM}='IGNORE'; kill 'TERM',-$$; $t=1}; alarm $d; waitpid $p,0; exit($t?124:$?>>8)";
  writeFileSync(join(PROGRAMMES, "timeout"), `#!/usr/bin/env bash\nd="$1"; shift\nexec perl -e '${perl}' "$d" "$@"\n`);
  chmodSync(join(PROGRAMMES, "timeout"), 0o755);
}

/** Appelle une fonction de mise-a-jour-reseau.sh chargé par « source » (jamais le déroulé). */
function reseau(fonction: string, args: string[], vars: Record<string, string> = {}): { code: number; sortie: string; erreur: string } {
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, "mise-a-jour-reseau.sh")}'; "$@"`, "essai", fonction, ...args], {
    env: envEssai({ PATH: `${PROGRAMMES}:${process.env.PATH}`, ...vars }), encoding: "utf8",
  });
  return { code: r.status ?? -1, sortie: r.stdout, erreur: r.stderr };
}

function fichier(contenu: string, nom = "demande.json"): string {
  const dossier = mkdtempSync(join(tmpdir(), "lama-echange-"));
  writeFileSync(join(dossier, nom), contenu);
  return join(dossier, nom);
}

test("demande : exactement { \"version\": \"X.Y.Z\" }, rien d'autre n'est lu (M-8)", () => {
  assert.deepEqual(reseau("lire_demande", [fichier("{\"version\":\"1.2.0\"}\n")]), { code: 0, sortie: "1.2.0", erreur: "" });
  assert.equal(reseau("lire_demande", [fichier("{ \"version\" : \"1.10.3\" }")]).sortie, "1.10.3", "espaces permis");
  for (const contenu of [
    "{\"version\":\"1.2.0\",\"url\":\"https://ailleurs.exemple/lama.tar.gz\"}", // champ en trop
    "{\"version\":\"1.2.0-essai\"}", "{\"version\":\"01.2.0\"}", "{\"version\":\"../../etc\"}", "{\"version\":1.2}",
    "{\"depot\":\"autre/lama\",\"version\":\"1.2.0\"}", "", "version=1.2.0",
  ]) {
    assert.notEqual(reseau("lire_demande", [fichier(contenu)]).code, 0, contenu);
  }
});

test("demande : lien symbolique et fichier géant refusés, sans rien lire au-delà de la limite (M-8)", () => {
  const cible = fichier("{\"version\":\"1.2.0\"}", "ailleurs.json");
  const dossier = mkdtempSync(join(tmpdir(), "lama-echange-lien-"));
  symlinkSync(cible, join(dossier, "demande.json"));
  assert.notEqual(reseau("lire_demande", [join(dossier, "demande.json")]).code, 0, "lien");
  assert.notEqual(reseau("lire_demande", [fichier(`${" ".repeat(2000)}{"version":"1.2.0"}`)]).code, 0, "plus de 1 024 octets");
  assert.notEqual(reseau("lire_demande", [join(dossier, "absente.json")]).code, 0, "absente");
  const sousDossier = join(dossier, "dossier.json");
  mkdirSync(sousDossier);
  assert.notEqual(reseau("lire_demande", [sousDossier]).code, 0, "dossier");
});

test("mode : « automatique » seulement si le fichier le dit exactement ; absent, illisible ou lien : manuel (M-8)", () => {
  assert.equal(reseau("lire_mode", [fichier("automatique\n", "mode")]).sortie, "automatique");
  assert.equal(reseau("lire_mode", [fichier("manuel\n", "mode")]).sortie, "manuel");
  for (const contenu of ["Automatique", "automatique\nmanuel", "auto", ""]) assert.equal(reseau("lire_mode", [fichier(contenu, "mode")]).sortie, "manuel", contenu);
  const dossier = mkdtempSync(join(tmpdir(), "lama-mode-"));
  assert.equal(reseau("lire_mode", [join(dossier, "mode")]).sortie, "manuel", "absent");
  symlinkSync(fichier("automatique\n", "ailleurs"), join(dossier, "mode"));
  assert.equal(reseau("lire_mode", [join(dossier, "mode")]).sortie, "manuel", "lien");
});

test("adresse : dépôt fixe, seul /etc/lama/mise-a-jour.conf (ligne DEPOT=…) le change ; jamais lue dans la demande (M-10)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-conf-"));
  assert.equal(reseau("depot_des_versions", [join(dossier, "absent.conf")]).sortie, "maebaconsulting/lama");
  writeFileSync(join(dossier, "mise-a-jour.conf"), "# recette\nDEPOT=essai-lama/lama-recette\n");
  assert.equal(reseau("depot_des_versions", [join(dossier, "mise-a-jour.conf")]).sortie, "essai-lama/lama-recette");
  for (const ligne of ["DEPOT=https://ailleurs.exemple/x", "DEPOT=a/b/c", "DEPOT=a b/c", " DEPOT=a/b"]) {
    writeFileSync(join(dossier, "mauvais.conf"), `${ligne}\n`);
    assert.equal(reseau("depot_des_versions", [join(dossier, "mauvais.conf")]).sortie, "maebaconsulting/lama", ligne);
  }
  assert.equal(reseau("url_versions", ["maebaconsulting/lama", "1.2.0"]).sortie, "https://github.com/maebaconsulting/lama/releases/download/v1.2.0/");
  const s = readFileSync(join(DEPLOY, "mise-a-jour-reseau.sh"), "utf8");
  assert.match(s, /^CONF_RESEAU="\$RACINE\/etc\/lama\/mise-a-jour\.conf"$/m);
  assert.doesNotMatch(s, /depot_des_versions "\$ECHANGE/, "jamais un fichier du dossier d'échange");
});

test("journal du service : une phrase par motif, dans chaque langue (M-10, M-17)", () => {
  for (const motif of ["demande_invalide", "version_non_recente", "telechargement", "signature", "empreinte", "version_incoherente", "sauvegarde", "installation", "demarrage"]) {
    const fr = reseau("dire_motif", [motif]);
    const en = reseau("dire_motif", [motif], { LAMA_LANGUE: "en" });
    assert.ok(fr.sortie.length > 10 && en.sortie.length > 10 && fr.sortie !== en.sortie, motif);
  }
});

test("etat.json : écrit sous le compte du service, d'un seul geste, au format attendu par lama (M-8)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-etat-"));
  const r = reseau("ecrire_etat", [dossier, "1761000000-42", "1.2.0", "telechargement", "", "", "1761000000000", "", "1.1.0"]);
  assert.equal(r.code, 0, r.erreur);
  assert.deepEqual(JSON.parse(readFileSync(join(dossier, "etat.json"), "utf8")), {
    operation: "1761000000-42", version_cible: "1.2.0", etape: "telechargement", resultat: null, motif: null, debut: 1761000000000, fin: null, version_precedente: "1.1.0",
  });
  reseau("ecrire_etat", [dossier, "1761000000-42", "", "termine", "echec", "demande_invalide", "1761000000000", "1761000005000", "1.1.0"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dossier, "etat.json"), "utf8")), {
    operation: "1761000000-42", version_cible: null, etape: "termine", resultat: "echec", motif: "demande_invalide", debut: 1761000000000, fin: 1761000005000, version_precedente: "1.1.0",
  });
  assert.deepEqual(readdirSync(dossier), ["etat.json"], "aucun fichier temporaire laissé");
});

test("etat.json : une valeur hors format n'est jamais écrite (M-8)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-etat-refus-"));
  for (const args of [
    ["1761-42", "1.2.0\",\"x\":\"y", "telechargement", "", "", "1", "", "1.1.0"],
    ["1761-42", "1.2.0", "pirate", "", "", "1", "", "1.1.0"],
    ["1761-42", "1.2.0", "termine", "bof", "", "1", "2", "1.1.0"],
    ["1761-42", "1.2.0", "termine", "echec", "inconnu", "1", "2", "1.1.0"],
    ["x", "1.2.0", "telechargement", "", "", "1", "", "1.1.0"],
    ["1761-42", "1.2.0", "telechargement", "", "", "1e3", "", "1.1.0"],
  ]) {
    assert.notEqual(reseau("ecrire_etat", [dossier, ...args]).code, 0, args.join(" "));
  }
  assert.deepEqual(readdirSync(dossier), []);
});

test("étapes : lignes @etape lues, le reste passe au journal ; motif d'après le code de sortie (M-10)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-etapes-"));
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, "mise-a-jour-reseau.sh")}'; noter() { printf '%s\\n' "$1" >> '${join(dossier, "vues")}'; }; printf '%s\\n' '== Sauvegarde' '@etape sauvegarde' '@etape installation' 'ligne' '@etape pirate' '@etape controle' | suivre_etapes noter`], { env: envEssai(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "== Sauvegarde\nligne\n@etape pirate\n");
  assert.deepEqual(readFileSync(join(dossier, "vues"), "utf8").split("\n").filter(Boolean), ["sauvegarde", "installation", "controle"]);
  assert.deepEqual(["3", "4", "5", "1", "2", "127"].map((c) => reseau("motif_de_sortie", [c]).sortie), ["sauvegarde", "demarrage", "signature", "installation", "installation", "installation"]);
});

/**
 * curl simulé : journalise l'adresse demandée ; sert …/releases/download/vX.Y.Z/NOM depuis
 * $LAMA_ESSAI_SERVEUR/<dépôt>/vX.Y.Z/NOM et …/releases/latest par sa redirection
 * ($LAMA_ESSAI_SERVEUR/<dépôt>/latest contient la version) ; 22 (comme --fail) pour le reste.
 */
const CURL_SIMULE = String.raw`#!/usr/bin/env bash
SORTIE=""; ADRESSE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) SORTIE="$2"; shift 2 ;;
    --write-out|--max-filesize|--connect-timeout|--max-time|--continue-at|--proto|--proto-redir) shift 2 ;;
    -*) shift ;;
    *) ADRESSE="$1"; shift ;;
  esac
done
printf '%s\n' "$ADRESSE" >> "$LAMA_ESSAI_JOURNAL_CURL"
CHEMIN="$(printf '%s' "$ADRESSE" | sed 's#^https://github.com/##')"
DEPOT="$(printf '%s' "$CHEMIN" | cut -d/ -f1-2)"
case "$ADRESSE" in
  https://github.com/*/releases/latest)
    [ -f "$LAMA_ESSAI_SERVEUR/$DEPOT/latest" ] || exit 22
    printf 'https://github.com/%s/releases/tag/v%s' "$DEPOT" "$(cat "$LAMA_ESSAI_SERVEUR/$DEPOT/latest")" ;;
  https://github.com/*/releases/download/*)
    FICHIER="$(printf '%s' "$CHEMIN" | sed 's#^[^/]*/[^/]*/releases/download/##')"
    [ -f "$LAMA_ESSAI_SERVEUR/$DEPOT/$FICHIER" ] || exit 22
    cp "$LAMA_ESSAI_SERVEUR/$DEPOT/$FICHIER" "$SORTIE" ;;
  *) exit 22 ;;
esac
`;
writeFileSync(join(PROGRAMMES, "curl"), CURL_SIMULE);
chmodSync(join(PROGRAMMES, "curl"), 0o755);

/** Serveur des versions d'essai : un dossier par dépôt et par version, et le journal des adresses demandées. */
function serveurEssai(): { serveur: string; journal: string; vars: Record<string, string>; publier: (depot: string, version: string, dossier: string) => void } {
  const serveur = mkdtempSync(join(tmpdir(), "lama-serveur-versions-"));
  const journal = join(serveur, "journal-curl");
  writeFileSync(journal, "");
  const publier = (depot: string, version: string, dossier: string) => {
    const cible = join(serveur, depot, `v${version}`);
    mkdirSync(cible, { recursive: true });
    for (const nom of readdirSync(dossier)) copyFileSync(join(dossier, nom), join(cible, nom));
  };
  return { serveur, journal, vars: { LAMA_ESSAI_SERVEUR: serveur, LAMA_ESSAI_JOURNAL_CURL: journal, LAMA_ESSAI_PAUSE: "0" }, publier };
}

test("dernière version : lue dans la redirection de /releases/latest, refusée hors de X.Y.Z (M-10)", () => {
  const s = serveurEssai();
  mkdirSync(join(s.serveur, "maebaconsulting/lama"), { recursive: true });
  writeFileSync(join(s.serveur, "maebaconsulting/lama/latest"), "1.3.0");
  assert.deepEqual(reseau("derniere_version", ["maebaconsulting/lama"], s.vars), { code: 0, sortie: "1.3.0", erreur: "" });
  writeFileSync(join(s.serveur, "maebaconsulting/lama/latest"), "1.3.0-essai");
  assert.notEqual(reseau("derniere_version", ["maebaconsulting/lama"], s.vars).code, 0);
  assert.notEqual(reseau("derniere_version", ["inconnu/depot"], s.vars).code, 0, "dépôt sans version");
});

test("téléchargement : https seulement, reprise, trois essais, taille plafonnée (M-10)", () => {
  const s = serveurEssai();
  const { dossier } = preparerVersionEssai({ version: "1.2.0" });
  s.publier("maebaconsulting/lama", "1.2.0", dossier);
  const cache = mkdtempSync(join(tmpdir(), "lama-cache-"));
  const adresse = "https://github.com/maebaconsulting/lama/releases/download/v1.2.0/";
  assert.equal(reseau("telecharger", [adresse, "NOTES.md", cache, "1048576"], s.vars).code, 0);
  assert.equal(readFileSync(join(cache, "NOTES.md"), "utf8"), readFileSync(join(dossier, "NOTES.md"), "utf8"));
  assert.notEqual(reseau("telecharger", [adresse, "NOTES.md", cache, "10"], s.vars).code, 0, "au-delà du plafond");
  assert.equal(readdirSync(cache).includes("NOTES.md"), false, "fichier trop gros retiré");
  writeFileSync(s.journal, "");
  assert.notEqual(reseau("telecharger", [adresse, "absent.tar.gz", cache, "1048576"], s.vars).code, 0);
  assert.equal(readFileSync(s.journal, "utf8").split("\n").filter(Boolean).length, 3, "trois essais");
  const t = readFileSync(join(DEPLOY, "mise-a-jour-reseau.sh"), "utf8");
  assert.match(t, /curl --fail --silent --show-error --location --proto =https --proto-redir =https --tlsv1\.2 /);
  assert.match(t, /--continue-at - /);
});

test("contrôle : clé en service, puis empreinte, puis VERSION ; archive jetée sur refus (M-10)", (t) => {
  const openssl = opensslEssai();
  if (!openssl) { t.skip(SANS_OPENSSL); return; }
  const cle = paireEssai(openssl);
  const autre = paireEssai(openssl);
  const vars = { LAMA_OPENSSL: openssl };
  const bonne = preparerVersionEssai({ version: "1.2.0", openssl, privee: cle.privee });
  assert.deepEqual(reseau("controler_archive", [bonne.dossier, "1.2.0", cle.publique], vars), { code: 0, sortie: "", erreur: "" });
  assert.equal(readFileSync(join(bonne.dossier, "lama-1.2.0", "VERSION"), "utf8"), "1.2.0\n", "archive extraite");
  const falsifiee = preparerVersionEssai({ version: "1.2.0", openssl, privee: autre.privee });
  assert.deepEqual([reseau("controler_archive", [falsifiee.dossier, "1.2.0", cle.publique], vars).sortie], ["signature"]);
  const modifiee = preparerVersionEssai({ version: "1.2.0", openssl, privee: cle.privee });
  writeFileSync(join(modifiee.dossier, "NOTES.md"), "autre note\n");
  assert.equal(reseau("controler_archive", [modifiee.dossier, "1.2.0", cle.publique], vars).sortie, "empreinte");
  const incoherente = preparerVersionEssai({ version: "1.2.0", openssl, privee: cle.privee, versionDansArchive: "1.1.0" });
  assert.equal(reseau("controler_archive", [incoherente.dossier, "1.2.0", cle.publique], vars).sortie, "version_incoherente");
  assert.equal(reseau("controler_archive", [bonne.dossier, "1.2.0", join(bonne.dossier, "absente.pem")], vars).sortie, "signature", "sans clé en service, toujours refusé");
});

/** mettre-a-jour.sh simulé (dans l'archive publiée) : note son environnement et l'état vu, annonce ses étapes, sort avec LAMA_ESSAI_SORTIE. */
const METTRE_A_JOUR_SIMULE = String.raw`#!/usr/bin/env bash
printf '%s %s\n' "$LAMA_MARQUES_ETAPES" "$LAMA_VERROU_TENU" > "$LAMA_ESSAI_TRACE"
cp "$LAMA_ESSAI_RACINE/var/lib/lama/mise-a-jour/etat.json" "$LAMA_ESSAI_TRACE.etat"
echo "@etape sauvegarde"
echo "== Sauvegarde avant la mise à jour"
echo "@etape installation"
[ -z "$LAMA_ESSAI_DORMIR" ] || sleep "$LAMA_ESSAI_DORMIR"
echo "@etape controle"
[ -n "$LAMA_ESSAI_SORTIE" ] || LAMA_ESSAI_SORTIE=0
exit "$LAMA_ESSAI_SORTIE"
`;

/** flock simulé : verrou libre, sauf LAMA_ESSAI_VERROU_PRIS=1. */
const FLOCK_SIMULE = "#!/usr/bin/env bash\n[ \"${LAMA_ESSAI_VERROU_PRIS:-0}\" = 1 ] && exit 1\nexit 0\n";

/**
 * Serveur d'institut d'essai : racine avec /opt/lama/actuelle (version en service et sa clé),
 * dossier d'échange, cache, /etc/lama et /run ; serveur des versions ; programmes simulés.
 */
function institut(openssl: string, cle: { privee: string; publique: string }, o: { enService?: string; flockReel?: boolean } = {}) {
  const racine = mkdtempSync(join(tmpdir(), "lama-institut-"));
  const enService = o.enService ?? "1.1.0";
  const version = join(racine, "opt/lama/versions", enService);
  mkdirSync(join(version, "deploy"), { recursive: true });
  writeFileSync(join(version, "VERSION"), `${enService}\n`);
  copyFileSync(cle.publique, join(version, "deploy", "cle-publique.pem"));
  symlinkSync(version, join(racine, "opt/lama/actuelle"));
  for (const d of ["var/lib/lama/mise-a-jour", "var/cache", "etc/lama", "run"]) mkdirSync(join(racine, d), { recursive: true });
  const programmes = mkdtempSync(join(tmpdir(), "lama-institut-programmes-"));
  for (const [nom, contenu] of [["runuser", readFileSync(join(PROGRAMMES, "runuser"), "utf8")], ["curl", CURL_SIMULE], ...(existsSync(join(PROGRAMMES, "timeout")) ? [["timeout", readFileSync(join(PROGRAMMES, "timeout"), "utf8")]] : []), ...(o.flockReel ? [] : [["flock", FLOCK_SIMULE]])]) {
    writeFileSync(join(programmes, nom), contenu);
    chmodSync(join(programmes, nom), 0o755);
  }
  const s = serveurEssai();
  const trace = join(racine, "trace");
  const echange = join(racine, "var/lib/lama/mise-a-jour");
  return {
    racine, echange, trace, serveur: s,
    publier(v: string, p: { privee?: string; versionDansArchive?: string } = {}) {
      const { dossier } = preparerVersionEssai({ version: v, openssl, privee: p.privee ?? cle.privee, mettreAJour: METTRE_A_JOUR_SIMULE, versionDansArchive: p.versionDansArchive });
      s.publier("maebaconsulting/lama", v, dossier);
    },
    demander(contenu: string) { writeFileSync(join(echange, "demande.json"), contenu); },
    lancer(vars: Record<string, string> = {}): { code: number; sortie: string } {
      const r = spawnSync("bash", [join(DEPLOY, "mise-a-jour-reseau.sh")], { env: this.env(vars), encoding: "utf8" });
      return { code: r.status ?? -1, sortie: `${r.stdout}${r.stderr}` };
    },
    env(vars: Record<string, string> = {}) {
      return envEssai({ PATH: `${programmes}:${process.env.PATH}`, LAMA_ESSAI_RACINE: racine, LAMA_ESSAI_TRACE: trace, LAMA_OPENSSL: openssl, ...s.vars, ...vars });
    },
    etat(): Record<string, unknown> | null {
      return existsSync(join(echange, "etat.json")) ? JSON.parse(readFileSync(join(echange, "etat.json"), "utf8")) : null;
    },
    curl(): string[] { return readFileSync(s.journal, "utf8").split("\n").filter(Boolean); },
  };
}

/** Prépare un institut d'essai, ou saute l'essai faute d'openssl 3. */
function avecInstitut(t: { skip: (m: string) => void }, o: Parameters<typeof institut>[2] = {}) {
  const openssl = opensslEssai();
  if (!openssl) { t.skip(SANS_OPENSSL); return null; }
  return institut(openssl, paireEssai(openssl), o);
}

test("déroulé : demande lue, téléchargée, vérifiée, installée par mettre-a-jour.sh, état terminé, demande et cache effacés (M-10)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  i.publier("1.2.0");
  i.demander("{\"version\":\"1.2.0\"}\n");
  const r = i.lancer();
  assert.equal(r.code, 0, r.sortie);
  const e = i.etat()!;
  assert.deepEqual({ ...e, operation: "x", debut: 0, fin: 0 }, { operation: "x", version_cible: "1.2.0", etape: "termine", resultat: "reussie", motif: null, debut: 0, fin: 0, version_precedente: "1.1.0" });
  assert.ok((e.fin as number) >= (e.debut as number));
  assert.equal(readFileSync(i.trace, "utf8"), "1 1\n", "étapes demandées, verrou déjà tenu");
  assert.equal(JSON.parse(readFileSync(`${i.trace}.etat`, "utf8")).etape, "sauvegarde", "état écrit avant de lancer mettre-a-jour.sh");
  assert.equal(existsSync(join(i.echange, "demande.json")), false);
  assert.equal(existsSync(join(i.racine, "var/cache/lama-mise-a-jour/1.2.0")), false, "cache effacé");
  assert.deepEqual(i.curl(), ["SHA256SUMS", "SHA256SUMS.sig", "NOTES.md", "lama-1.2.0.tar.gz"].map((n) => `https://github.com/maebaconsulting/lama/releases/download/v1.2.0/${n}`));
  assert.match(r.sortie, /== Sauvegarde avant la mise à jour/, "sortie de mettre-a-jour.sh au journal");
});

test("déroulé : échec de mettre-a-jour.sh rendu par son motif, sauvegarde ou démarrage (M-10)", (t) => {
  for (const [sortie, motif] of [["3", "sauvegarde"], ["4", "demarrage"], ["1", "installation"]]) {
    const i = avecInstitut(t);
    if (!i) return;
    i.publier("1.2.0");
    i.demander("{\"version\":\"1.2.0\"}");
    const r = i.lancer({ LAMA_ESSAI_SORTIE: sortie });
    assert.equal(r.code, 1, r.sortie);
    assert.equal(existsSync(join(i.echange, "demande.json")), false, `${sortie} : demande effacée`);
    assert.deepEqual([i.etat()!.resultat, i.etat()!.motif], ["echec", motif], sortie);
  }
});

test("déroulé : archive falsifiée, signée par une autre clé ou incohérente, jamais installée (M-4, M-10)", (t) => {
  const autre = opensslEssai() ? paireEssai(opensslEssai()!) : null;
  for (const [cas, motif] of [["autre clé", "signature"], ["incohérente", "version_incoherente"], ["modifiée", "empreinte"]] as const) {
    const i = avecInstitut(t);
    if (!i || !autre) return;
    i.publier("1.2.0", cas === "autre clé" ? { privee: autre.privee } : cas === "incohérente" ? { versionDansArchive: "1.1.0" } : {});
    if (cas === "modifiée") writeFileSync(join(i.serveur.serveur, "maebaconsulting/lama/v1.2.0/NOTES.md"), "note changée\n");
    i.demander("{\"version\":\"1.2.0\"}");
    assert.equal(i.lancer().code, 1);
    assert.deepEqual([i.etat()!.resultat, i.etat()!.motif], ["echec", motif], cas);
    assert.equal(existsSync(i.trace), false, `${cas} : mettre-a-jour.sh jamais lancé`);
    assert.equal(existsSync(join(i.racine, "var/cache/lama-mise-a-jour/1.2.0")), false, `${cas} : archive jetée`);
  }
});

test("déroulé : demande invalide, version non plus récente, téléchargement impossible ; rien n'est téléchargé de plus que nécessaire (M-8, M-10)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  i.demander("{\"version\":\"1.2.0\",\"url\":\"https://ailleurs.exemple/lama.tar.gz\"}");
  assert.equal(i.lancer().code, 1);
  assert.deepEqual([i.etat()!.motif, i.etat()!.version_cible], ["demande_invalide", null]);
  assert.deepEqual(i.curl(), [], "rien téléchargé, adresse jamais prise dans la demande");
  i.demander("{\"version\":\"1.1.0\"}");
  i.lancer();
  assert.equal(i.etat()!.motif, "version_non_recente");
  i.demander("{\"version\":\"1.0.9\"}");
  i.lancer();
  assert.equal(i.etat()!.motif, "version_non_recente");
  i.demander("{\"version\":\"1.2.0\"}");
  i.lancer();
  assert.equal(i.etat()!.motif, "telechargement", "rien de publié");
});

test("demande.json effacée sur chaque issue : sinon l'unité .path relancerait le service sans fin (Review Focus 2)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  for (const [contenu, vars] of [["pas du json", {}], ["{\"version\":\"9.9.9\"}", {}], ["{\"version\":\"1.2.0\"}", { LAMA_ESSAI_VERROU_PRIS: "1" }]] as const) {
    i.demander(contenu);
    i.lancer(vars);
    assert.equal(existsSync(join(i.echange, "demande.json")), false, contenu);
  }
  const lien = join(i.racine, "ailleurs.json");
  writeFileSync(lien, "{\"version\":\"1.2.0\"}");
  symlinkSync(lien, join(i.echange, "demande.json"));
  i.lancer();
  assert.equal(i.etat()!.motif, "demande_invalide", "lien refusé");
  assert.equal(existsSync(join(i.echange, "demande.json")), false, "lien effacé");
  assert.equal(readFileSync(lien, "utf8"), "{\"version\":\"1.2.0\"}", "sa cible intacte");
  mkdirSync(join(i.echange, "demande.json", "dedans"), { recursive: true });
  i.lancer();
  assert.equal(i.etat()!.motif, "demande_invalide", "dossier refusé");
  assert.equal(existsSync(join(i.echange, "demande.json")), false, "dossier effacé");
});

test("service arrêté (SIGTERM de systemd) pendant mettre-a-jour.sh : état final écrit, jamais « en cours » pour toujours (revue finale 1a)", async (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  i.publier("1.2.0");
  i.demander("{\"version\":\"1.2.0\"}");
  // Groupe de processus à lui, tué en entier comme le fait systemd (KillMode=control-group).
  const service = spawn("bash", [join(DEPLOY, "mise-a-jour-reseau.sh")], { env: i.env({ LAMA_ESSAI_DORMIR: "30" }), detached: true, stdio: "ignore" });
  const fini = new Promise<number | null>((ok) => service.on("exit", (code, signal) => ok(code ?? (signal ? 128 : null))));
  for (let n = 0; n < 200 && i.etat()?.etape !== "installation"; n++) await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(i.etat()?.etape, "installation", "mettre-a-jour.sh en cours");
  process.kill(-service.pid!, "SIGTERM");
  assert.notEqual(await fini, 0);
  const e = i.etat()!;
  assert.deepEqual([e.etape, e.resultat, e.motif, e.version_cible, e.version_precedente], ["termine", "echec", "installation", "1.2.0", "1.1.0"]);
  assert.equal(typeof e.fin, "number");
  assert.equal(existsSync(join(i.echange, "demande.json")), false, "demande effacée");
});

test("nuit : rien sans le mode automatique ; sinon la dernière version, si elle est plus récente (M-9, M-10)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  i.publier("1.2.0");
  writeFileSync(join(i.serveur.serveur, "maebaconsulting/lama/latest"), "1.2.0");
  assert.equal(i.lancer().code, 0);
  assert.equal(i.etat(), null, "mode absent : manuel, rien");
  assert.deepEqual(i.curl(), []);
  writeFileSync(join(i.echange, "mode"), "automatique\n");
  writeFileSync(join(i.serveur.serveur, "maebaconsulting/lama/latest"), "1.1.0");
  assert.equal(i.lancer().code, 0);
  assert.equal(i.etat(), null, "déjà à jour : rien");
  writeFileSync(join(i.serveur.serveur, "maebaconsulting/lama/latest"), "1.2.0");
  assert.equal(i.lancer().code, 0);
  assert.deepEqual([i.etat()!.resultat, i.etat()!.version_cible], ["reussie", "1.2.0"]);
});

test("recette : /etc/lama/mise-a-jour.conf désigne un autre dépôt, un fichier du dossier d'échange jamais (M-10)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  writeFileSync(join(i.racine, "etc/lama/mise-a-jour.conf"), "DEPOT=essai-lama/lama-recette\n");
  writeFileSync(join(i.echange, "mise-a-jour.conf"), "DEPOT=pirate/lama\n");
  i.demander("{\"version\":\"1.2.0\"}");
  i.lancer();
  assert.ok(i.curl().every((a) => a.startsWith("https://github.com/essai-lama/lama-recette/releases/download/v1.2.0/")), i.curl().join("\n"));
});

test("verrou simulé : déjà pris, le service abandonne sans rien écrire ni télécharger (M-9)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  i.publier("1.2.0");
  i.demander("{\"version\":\"1.2.0\"}");
  const r = i.lancer({ LAMA_ESSAI_VERROU_PRIS: "1" });
  assert.equal(r.code, 0);
  assert.match(r.sortie, /Une autre mise à jour est en cours/);
  assert.equal(i.etat(), null);
  assert.deepEqual(i.curl(), []);
});

test("verrou : fichier en 0600, même s'il existait avant ; un compte lama compromis ne peut pas le tenir (revue finale 2)", (t) => {
  const i = avecInstitut(t);
  if (!i) return;
  const verrou = join(i.racine, "run/lama-mise-a-jour.verrou");
  i.demander("{\"version\":\"1.1.0\"}");
  i.lancer();
  assert.equal(statSync(verrou).mode & 0o777, 0o600, "créé en 0600");
  chmodSync(verrou, 0o644);
  i.demander("{\"version\":\"1.1.0\"}");
  i.lancer();
  assert.equal(statSync(verrou).mode & 0o777, 0o600, "ancien fichier remis en 0600");
  // mettre-a-jour.sh (root seulement, essayé sur son texte) : même ouverture.
  for (const script of ["mise-a-jour-reseau.sh", "mettre-a-jour.sh"]) {
    assert.match(lire(script), /\( umask 077 && : >> "\$VERROU" \)\n\s*chmod 0600 "\$VERROU"\n\s*exec 9>"\$VERROU"/, script);
  }
});

test("verrou réel (flock) : deux demandes, jamais deux opérations à la fois (M-9)", async (t) => {
  if (spawnSync("bash", ["-c", "command -v flock"]).status !== 0) { t.skip("flock absent (Mac) : le verrou simulé couvre l'abandon, cet essai tourne sous Linux"); return; }
  const i = avecInstitut(t, { flockReel: true });
  if (!i) return;
  i.publier("1.2.0");
  i.demander("{\"version\":\"1.2.0\"}");
  const tenant = spawn("flock", [join(i.racine, "run/lama-mise-a-jour.verrou"), "sleep", "5"]);
  await new Promise((ok) => setTimeout(ok, 300));
  const r = i.lancer({ LAMA_ESSAI_ATTENTE_VERROU: "1" });
  tenant.kill();
  assert.equal(r.code, 0);
  assert.equal(i.etat(), null, "seconde opération jamais commencée");
});

test("lecture hostile : un tube (FIFO) posé après le contrôle du fichier ne bloque pas le service, qui garde le verrou (M-8)", (t) => {
  // runuser d'essai : juste avant de lancer la commande, remplace le fichier par un tube sans
  // écrivain, comme le ferait le compte lama entre le contrôle « -f » et la lecture.
  const dossier = mkdtempSync(join(tmpdir(), "lama-fifo-programmes-"));
  writeFileSync(join(dossier, "runuser"), "#!/usr/bin/env bash\nshift 2\n[ \"$1\" = -- ] && shift\nrm -f \"$LAMA_ESSAI_TUBE\" && mkfifo \"$LAMA_ESSAI_TUBE\"\nexec \"$@\"\n");
  chmodSync(join(dossier, "runuser"), 0o755);
  const demande = fichier("{\"version\":\"1.2.0\"}");
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, "mise-a-jour-reseau.sh")}'; lire_demande "$1"`, "essai", demande], {
    env: envEssai({ PATH: `${dossier}:${PROGRAMMES}:${process.env.PATH}`, LAMA_ESSAI_TUBE: demande, LAMA_ESSAI_DELAI_LECTURE: "1" }), encoding: "utf8", timeout: 8000,
  });
  assert.equal(r.error, undefined, "la lecture est revenue d'elle-même");
  assert.equal(r.status, 1, "refus");
  assert.equal(r.stdout, "");
});

test("etat.json.tmp posé en tube (FIFO) : l'écriture de l'état revient au lieu de bloquer le service (M-8)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-etat-tube-"));
  const tube = join(dossier, "etat.json.tmp");
  spawnSync("mkfifo", [tube]);
  const r = spawnSync("bash", ["-c", `source '${join(DEPLOY, "mise-a-jour-reseau.sh")}'; ecrire_etat "$1" 1-1 1.2.0 sauvegarde "" "" 1 "" 1.1.0`, "essai", dossier], {
    env: envEssai({ PATH: `${PROGRAMMES}:${process.env.PATH}`, LAMA_ESSAI_DELAI_LECTURE: "1" }), encoding: "utf8", timeout: 8000,
  });
  assert.equal(r.error, undefined, "l'écriture est revenue d'elle-même");
  assert.notEqual(r.status, 0, "écriture abandonnée");
});

const lire = (nom: string) => readFileSync(join(DEPLOY, nom), "utf8");

test("unités : service root oneshot, lancé par le fichier de demande et chaque nuit à 3 h 30 de Douala, sans rattrapage (M-9)", () => {
  const service = lire("systemd/lama-mise-a-jour.service");
  assert.match(service, /^Type=oneshot$/m);
  assert.match(service, /^ExecStart=\/opt\/lama\/actuelle\/deploy\/mise-a-jour-reseau\.sh$/m);
  assert.match(service, /^TimeoutStartSec=4h$/m, "attente du verrou, téléchargements, sauvegarde et installation");
  assert.doesNotMatch(service, /^User=/m, "root : seul à télécharger, vérifier, installer");
  assert.match(service, /^After=network-online\.target lama-sauvegarde\.service lama-certificat\.service$/m);
  const chemin = lire("systemd/lama-mise-a-jour.path");
  assert.match(chemin, /^PathExists=\/var\/lib\/lama\/mise-a-jour\/demande\.json$/m);
  assert.match(chemin, /^Unit=lama-mise-a-jour\.service$/m);
  assert.match(chemin, /^WantedBy=paths\.target$/m);
  const minuterie = lire("systemd/lama-mise-a-jour.timer");
  assert.match(minuterie, /^OnCalendar=\*-\*-\* 03:30:00 Africa\/Douala$/m);
  assert.match(minuterie, /^Persistent=false$/m);
  assert.match(minuterie, /^Unit=lama-mise-a-jour\.service$/m);
});

test("droits : le service lama inchangé, aucune règle polkit ni sudoers nouvelle (M-7)", () => {
  const lama = lire("systemd/lama.service");
  for (const ligne of ["User=lama", "NoNewPrivileges=true", "ProtectSystem=strict", "ReadWritePaths=/var/lib/lama -/mnt/lama-sauvegarde", "ReadOnlyPaths=/etc/lama"]) assert.ok(lama.includes(`${ligne}\n`), ligne);
  assert.deepEqual(readdirSync(join(DEPLOY, "polkit")), ["50-lama-heure.rules"]);
  for (const nom of readdirSync(DEPLOY).filter((n) => n.endsWith(".sh"))) assert.doesNotMatch(lire(nom), /sudoers|NOPASSWD/, nom);
});

test("pose : dossier d'échange créé par le compte du service, cache de root en 0700, unités en marche (M-11)", () => {
  const dossier = mkdtempSync(join(tmpdir(), "lama-pose-"));
  const journal = join(dossier, "journal");
  writeFileSync(journal, "");
  const essai = join(dossier, "essai.sh");
  writeFileSync(essai, `#!/usr/bin/env bash
set -euo pipefail
runuser() { printf 'runuser %s\\n' "$*" >> '${journal}'; }
install() { printf 'install %s\\n' "$*" >> '${journal}'; }
systemctl() { printf 'systemctl %s\\n' "$*" >> '${journal}'; }
source '${join(DEPLOY, "mise-a-jour-pose.sh")}'
poser_mise_a_jour_reseau /var/lib/lama lama /var/cache/lama-mise-a-jour
`);
  const r = spawnSync("bash", [essai], { env: envEssai(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readFileSync(journal, "utf8").split("\n").filter(Boolean), [
    "runuser -u lama -- install -d -m 0700 /var/lib/lama/mise-a-jour",
    "install -d -m 0700 -o root -g root /var/cache/lama-mise-a-jour",
    "systemctl enable --now lama-mise-a-jour.path lama-mise-a-jour.timer",
  ]);
});

test("installation et mise à jour posent le mécanisme ; un serveur installé avant le reçoit à sa première mise à jour à la main (M-11)", () => {
  const installation = lire("installer.sh");
  assert.match(installation, /"\$APP\/actuelle\/deploy\/systemd\/lama-mise-a-jour\.service" "\$APP\/actuelle\/deploy\/systemd\/lama-mise-a-jour\.path" "\$APP\/actuelle\/deploy\/systemd\/lama-mise-a-jour\.timer" \/etc\/systemd\/system\//);
  const pose = installation.indexOf('poser_mise_a_jour_reseau "$DATA" "$COMPTE" /var/cache/lama-mise-a-jour');
  assert.ok(pose > installation.indexOf("systemctl restart lama.service"), "après le premier démarrage (dossier des données prêt)");
  const maj = lire("mettre-a-jour.sh");
  const poseMaj = maj.indexOf('poser_mise_a_jour_reseau "$DATA" "$COMPTE" /var/cache/lama-mise-a-jour');
  assert.ok(poseMaj > maj.indexOf('rm -f "$TEMOIN"'), "une fois la nouvelle version vérifiée");
  assert.match(maj, /source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/mise-a-jour-pose\.sh"/);
});
