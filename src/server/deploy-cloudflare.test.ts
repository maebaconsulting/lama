import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

/**
 * deploy/cloudflare.sh contre un wrangler, un curl et un pnpm simulés : rien ne part chez Cloudflare. Le faux wrangler
 * note chaque appel dans un journal et répond comme le vrai pour `whoami`, `d1 list`, `d1 create` et `secret list` ; le
 * faux curl note l'adresse lue et ce qu'il reçoit sur l'entrée standard, et répond comme l'API selon les droits du jeton.
 */
const SCRIPT = new URL("../../deploy/cloudflare.sh", import.meta.url).pathname;
const COMPTE = "0123456789abcdef0123456789abcdef";
const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OPTIONS = ["--compte", COMPTE, "--worker", "lama-relais", "--base", "lama-relais", "--cle-site-turnstile", "0x4AAAAAAAexemple"];

const JETON = "jeton-d-essai-a-ne-jamais-voir";
const ZONE_ID = "023e105f4ecef8ad9ca31a8372d0c353";
const AVEC_DOMAINE = [...OPTIONS, "--domaine", "rdv.exemple.com"];

/** `droits` : ce que le jeton simulé peut lire (`d1`, `zone`, `routes`, `dns`), tout par défaut. */
type Essai = { bases?: string; secrets?: string; connecte?: boolean; droits?: string[]; listeSecretsEchoue?: boolean; enregistrementDns?: boolean; etatZone?: string; domaineRattache?: "meme" | "autre" | "illisible"; sousDomaine?: "present" | "absent" };

function lancer(args: string[], e: Essai = {}, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lama-cloudflare-"));
  const journal = join(dir, "journal");
  const bases = join(dir, "bases.json");
  writeFileSync(journal, "");
  writeFileSync(bases, e.bases ?? "[]");
  writeFileSync(join(dir, "secrets.json"), e.secrets ?? "[]");
  const faux = join(dir, "wrangler");
  writeFileSync(faux, `#!/usr/bin/env bash
printf 'wrangler %s | compte=%s\\n' "$*" "\${CLOUDFLARE_ACCOUNT_ID:-}" >> '${journal}'
case "$1 \${2:-}" in
  "whoami --json") ${e.connecte === false ? "echo 'Not logged in.' >&2; exit 1" : "echo '{}'"} ;;
  "d1 list") echo '⛅️ wrangler 4.142.0'; cat '${bases}' ;;
  "d1 create") printf '[{"uuid":"${UUID}","name":"%s"}]' "$3" > '${bases}' ;;
  "secret list") ${e.listeSecretsEchoue ? "echo 'network error' >&2; exit 1" : `cat '${join(dir, "secrets.json")}'`} ;;
esac
`);
  writeFileSync(join(dir, "pnpm"), `#!/usr/bin/env bash\nprintf 'pnpm %s\\n' "$*" >> '${journal}'\n`);
  const droits = e.droits ?? ["d1", "zone", "routes", "dns"];
  const reponse = (droit: string, ok: string) => (droits.includes(droit) ? ok : '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}');
  writeFileSync(join(dir, "curl"), `#!/usr/bin/env bash
entree="$(cat)"
adresse="\${@: -1}"
printf 'curl %s | entree=%s | args=%s\\n' "$adresse" "$entree" "$*" >> '${journal}'
case "$adresse" in
  */d1/database*) echo '${reponse("d1", '{"success":true,"result":[]}')}' ;;
  */zones\\?name=*) echo '${droits.includes("zone") ? `{"success":true,"result":[{"id":"${ZONE_ID}","name":"exemple.com","status":"${e.etatZone ?? "active"}"}]}` : '{"success":true,"result":[]}'}' ;;
  */workers/subdomain*) echo '${e.sousDomaine === "absent" ? '{"success":false,"errors":[{"code":10007,"message":"workers.api.error.no_subdomain"}]}' : '{"success":true,"result":{"subdomain":"exemple"}}'}' ;;
  */workers/routes) echo '${reponse("routes", '{"success":true,"result":[]}')}' ;;
  */workers/domains*) echo '${e.domaineRattache === "illisible" ? "pas du json" : `{"success":true,"result":[${e.domaineRattache ? `{"hostname":"rdv.exemple.com","service":"${e.domaineRattache === "meme" ? "lama-relais" : "autre-worker"}"}` : ""}]}`}' ;;
  */dns_records*) echo '${reponse("dns", `{"success":true,"result":[${e.enregistrementDns ? '{"type":"A","name":"rdv.exemple.com","content":"192.0.2.1"}' : ""}]}`)}' ;;
esac
`);
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(faux, 0o755);
  chmodSync(join(dir, "pnpm"), 0o755);
  const config = join(dir, "wrangler.deploiement.toml");
  const base = { ...process.env };
  for (const v of ["LANG", "LC_ALL", "LAMA_LANGUE", "CLOUDFLARE_ACCOUNT_ID", "RELAIS_WORKER", "RELAIS_BASE_D1", "RELAIS_DOMAINE", "RELAIS_DEMANDES_PAR_HEURE", "TURNSTILE_CLE_SITE", "RELAIS_D1_REGION", "RELAIS_ZONE", "CLOUDFLARE_API_TOKEN"]) delete base[v];
  const r = spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...base, PATH: `${dir}:${process.env.PATH}`, RELAIS_WRANGLER: faux, RELAIS_CONFIG_DEPLOIEMENT: config, LAMA_LANGUE: "fr", ...env },
  });
  const appels = readFileSync(journal, "utf8").split("\n").filter(Boolean);
  return { statut: r.status, sortie: r.stdout, erreur: r.stderr, appels, config, configEcrite: existsSync(config) ? readFileSync(config, "utf8") : null };
}

test("sans compte, Worker ni base : refus, aucun appel à Cloudflare", () => {
  const r = lancer(["--worker", "lama-relais"]);
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /--compte, --worker, --base/);
  assert.deepEqual(r.appels, []);
});

test("réglage refusé (nom de Worker en capitales) : refus avant tout appel, motif affiché", () => {
  const r = lancer(["--compte", COMPTE, "--worker", "Relais Eclat", "--base", "lama-relais"]);
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /nom du Worker/);
  assert.match(r.erreur, /rien n'a été fait/);
  assert.deepEqual(r.appels, []);
});

test("option inconnue, ou valeur de secret proposée en argument : refus", () => {
  for (const args of [["--cle-maitre", "abc"], ["--secret", "RELAIS_CLE_MAITRE=abc"]]) {
    const r = lancer([...OPTIONS, ...args]);
    assert.equal(r.statut, 1, args.join(" "));
    assert.match(r.erreur, /Option inconnue/);
    assert.deepEqual(r.appels, []);
  }
});

test("à blanc : toutes les commandes affichées dans l'ordre, rien d'exécuté ni d'écrit", () => {
  const r = lancer(["--a-blanc", ...OPTIONS]);
  assert.equal(r.statut, 0, r.erreur);
  assert.deepEqual(r.appels, [], "ni wrangler ni pnpm");
  assert.equal(r.configEcrite, null, "aucun fichier écrit");
  const ordre = [
    "+ npx wrangler@4.142.0 whoami --json",
    "+ pnpm --dir",
    "+ npx wrangler@4.142.0 d1 list --json",
    "+ npx wrangler@4.142.0 d1 create lama-relais --location weur",
    `+ npx wrangler@4.142.0 d1 migrations apply lama-relais --remote --config ${r.config}`,
    `+ npx wrangler@4.142.0 deploy --config ${r.config}`,
  ].map((l) => r.sortie.indexOf(l));
  assert.ok(ordre.every((i, k) => i >= 0 && (k === 0 || i > ordre[k - 1])), `ordre ${ordre.join(", ")}\n${r.sortie}`);
  assert.match(r.sortie, /html_handling = "none"/, "contenu du fichier montré");
  assert.match(r.sortie, /account_id = "0123456789abcdef0123456789abcdef"/);
  for (const s of ["RELAIS_CLE_MAITRE", "RELAIS_ADMIN_MOT_DE_PASSE", "TURNSTILE_SECRET"]) assert.match(r.sortie, new RegExp(`secret put ${s} --config`), s);
});

test("première mise en service : base créée dans la région, fichier écrit, migrations, construction, déploiement, rappel des secrets", () => {
  const r = lancer(OPTIONS);
  assert.equal(r.statut, 0, r.erreur);
  assert.deepEqual(r.appels.map((a) => a.replace(/ \| compte=.*$/, "")), [
    "wrangler whoami --json",
    `pnpm --dir ${new URL("../../", import.meta.url).pathname.replace(/\/$/, "")} build:relais`,
    "wrangler d1 list --json",
    "wrangler d1 create lama-relais --location weur",
    "wrangler d1 list --json",
    `wrangler d1 migrations apply lama-relais --remote --config ${r.config}`,
    `wrangler deploy --config ${r.config}`,
    `wrangler secret list --config ${r.config}`,
  ]);
  assert.ok(r.appels.filter((a) => a.startsWith("wrangler")).every((a) => a.endsWith(`compte=${COMPTE}`)), "compte de l'exploitant à chaque appel");
  assert.match(r.configEcrite ?? "", new RegExp(`^database_id = "${UUID}"$`, "m"));
  assert.match(r.configEcrite ?? "", /^RELAIS_DEMANDES_PAR_HEURE = "30"$/m);
  assert.match(r.configEcrite ?? "", /^TURNSTILE_CLE_SITE = "0x4AAAAAAAexemple"$/m);
  for (const s of ["RELAIS_CLE_MAITRE", "RELAIS_ADMIN_MOT_DE_PASSE", "TURNSTILE_SECRET"]) assert.match(r.sortie, new RegExp(`secret put ${s} --config`), s);
});

test("relancé : base existante gardée, jamais recréée ; secrets déjà posés, plus de rappel", () => {
  const secrets = JSON.stringify(["RELAIS_CLE_MAITRE", "RELAIS_ADMIN_MOT_DE_PASSE", "TURNSTILE_SECRET"].map((name) => ({ name, type: "secret_text" })));
  const r = lancer(OPTIONS, { bases: `[{"uuid":"${UUID}","name":"lama-relais"}]`, secrets });
  assert.equal(r.statut, 0, r.erreur);
  assert.ok(!r.appels.some((a) => a.includes("d1 create")), "aucune création");
  assert.match(r.sortie, /Base déjà créée, gardée/);
  assert.match(r.sortie, /Les trois secrets sont posés/);
  assert.doesNotMatch(r.sortie, /secret put/);
});

test("un secret manquant : seul celui-là est rappelé", () => {
  const r = lancer(OPTIONS, { bases: `[{"uuid":"${UUID}","name":"lama-relais"}]`, secrets: '[{"name":"RELAIS_CLE_MAITRE"},{"name":"RELAIS_ADMIN_MOT_DE_PASSE"}]' });
  assert.equal(r.statut, 0, r.erreur);
  assert.deepEqual([...r.sortie.matchAll(/secret put (\w+)/g)].map((m) => m[1]), ["TURNSTILE_SECRET"]);
});

test("pas connecté à Cloudflare : arrêt avec la commande de connexion, aucune base touchée", () => {
  const r = lancer(OPTIONS, { connecte: false });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /npx wrangler@4\.142\.0 login/);
  assert.deepEqual(r.appels.map((a) => a.replace(/ \| compte=.*$/, "")), ["wrangler whoami --json"]);
});

test("domaine personnalisé et variables d'environnement à la place des options", () => {
  const r = lancer(["--a-blanc"], {}, { CLOUDFLARE_ACCOUNT_ID: COMPTE, RELAIS_WORKER: "relais-editeur", RELAIS_BASE_D1: "relais-editeur", RELAIS_DOMAINE: "rdv.exemple.com", RELAIS_DEMANDES_PAR_HEURE: "45" });
  assert.equal(r.statut, 0, r.erreur);
  assert.match(r.sortie, /routes = \[\{ pattern = "rdv\.exemple\.com", custom_domain = true \}\]/);
  assert.match(r.sortie, /workers_dev = false/);
  assert.match(r.sortie, /RELAIS_DEMANDES_PAR_HEURE = "45"/);
  assert.match(r.sortie, /^https:\/\/rdv\.exemple\.com$/m);
  assert.match(r.sortie, /Turnstile reste désactivé/);
});

test("--secrets hors d'un terminal : refus, la valeur n'est jamais lue sur l'entrée standard", () => {
  const r = lancer(["--secrets", ...OPTIONS], { bases: `[{"uuid":"${UUID}","name":"lama-relais"}]` });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /--secrets demande un terminal/);
  assert.ok(!r.appels.some((a) => a.includes("secret put")));
});

test("messages en anglais avec LAMA_LANGUE=en", () => {
  const r = lancer(["--a-blanc", ...OPTIONS], {}, { LAMA_LANGUE: "en" });
  assert.equal(r.statut, 0, r.erreur);
  assert.match(r.sortie, /Dry run: the commands are shown, nothing is run or written\./);
  assert.match(r.sortie, /== D1 database lama-relais/);
});

test("le script ne lit ni n'écrit jamais la valeur d'un secret", () => {
  const texte = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(texte, /\|\s*(wr|npx[^|]*wrangler[^|]*) secret put/, "aucune valeur envoyée par un tube");
  assert.doesNotMatch(texte, /secret (put|bulk)[^\n]*(<|<<<)/, "ni par une redirection");
  assert.doesNotMatch(texte, /(^|[;&|(]\s*)read\b/m, "aucune saisie lue par le script");
});

test("domaine personnalisé et jeton d'API : droits vérifiés en lecture avant d'agir, jeton jamais en argument", () => {
  const r = lancer(AVEC_DOMAINE, {}, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 0, r.erreur);
  const appels = r.appels.map((a) => a.replace(/ \| (compte|entree|args)=.*$/, ""));
  assert.deepEqual(appels.slice(0, 8), [
    `curl https://api.cloudflare.com/client/v4/accounts/${COMPTE}/d1/database?per_page=1`,
    `curl https://api.cloudflare.com/client/v4/accounts/${COMPTE}/workers/subdomain`,
    `curl https://api.cloudflare.com/client/v4/zones?name=exemple.com&account.id=${COMPTE}`,
    `curl https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/workers/routes`,
    `curl https://api.cloudflare.com/client/v4/accounts/${COMPTE}/workers/domains?hostname=rdv.exemple.com`,
    `curl https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=rdv.exemple.com`,
    `pnpm --dir ${new URL("../../", import.meta.url).pathname.replace(/\/$/, "")} build:relais`,
    "wrangler d1 list --json",
  ]);
  assert.ok(!appels.includes("wrangler whoami --json"), "avec un jeton, pas de wrangler login");
  for (const a of r.appels.filter((x) => x.startsWith("curl"))) {
    assert.ok(a.includes(`entree=header = "Authorization: Bearer ${JETON}"`), "jeton lu sur l'entrée standard");
    assert.ok(!a.split(" | args=")[1].includes(JETON), "jamais en argument");
  }
  assert.doesNotMatch(r.sortie + r.erreur, new RegExp(JETON), "jamais affiché");
  assert.match(r.configEcrite ?? "", /^routes = \[\{ pattern = "rdv\.exemple\.com", custom_domain = true \}\]$/m);
  assert.match(r.configEcrite ?? "", /^workers_dev = false$/m);
  assert.match(r.sortie, /Jeton vérifié pour le compte 0123456789abcdef0123456789abcdef et la zone exemple\.com/);
  assert.match(r.sortie, /^https:\/\/rdv\.exemple\.com$/m);
});

test("droit manquant sur la zone : arrêt avant tout appel à wrangler, droit nommé", () => {
  const cas: [string[], RegExp][] = [
    [["zone", "routes", "dns"], /Workers Scripts et D1/],
    [["d1", "routes", "dns"], /Zone exemple\.com introuvable avec ce jeton/],
    [["d1", "zone", "dns"], /Workers Routes, en modification/],
    [["d1", "zone", "routes"], /DNS, en modification/],
  ];
  for (const [droits, motif] of cas) {
    const r = lancer(AVEC_DOMAINE, { droits }, { CLOUDFLARE_API_TOKEN: JETON });
    assert.equal(r.statut, 1, droits.join(","));
    assert.match(r.erreur, motif);
    assert.ok(!r.appels.some((a) => a.startsWith("wrangler")), `${droits.join(",")} : wrangler jamais appelé`);
  }
});

test("zone pas encore active : arrêt avant tout appel à wrangler, état nommé, motif dans la langue demandée", () => {
  const r = lancer(AVEC_DOMAINE, { etatZone: "pending" }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /Zone exemple\.com pas encore active \(état\u00a0: pending\)\u00a0: attendre la bascule des serveurs de noms\./);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler") || a.startsWith("pnpm")), "rien d'appelé avant l'arrêt");
  assert.ok(!r.appels.some((a) => a.includes("/workers/routes")), "pas de vérification suivante");
  const en = lancer(AVEC_DOMAINE, { etatZone: "pending" }, { CLOUDFLARE_API_TOKEN: JETON, LAMA_LANGUE: "en" });
  assert.equal(en.statut, 1);
  assert.match(en.erreur, /Zone exemple\.com not active yet \(status: pending\): wait for the nameserver switch\./);
});

test("zone : le domaine sans son premier mot par défaut, --zone pour une autre, domaine hors zone refusé", () => {
  const blanc = lancer(["--a-blanc", ...OPTIONS, "--domaine", "rdv.relais.exemple.com", "--zone", "exemple.com"], {}, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(blanc.statut, 0, blanc.erreur);
  assert.match(blanc.sortie, /\+ GET \/zones\?name=exemple\.com/);
  assert.match(blanc.sortie, /^\+ GET \/accounts\/0123456789abcdef0123456789abcdef\/workers\/domains\?hostname=rdv\.relais\.exemple\.com$/m, "vérification des domaines des Workers affichée");
  assert.deepEqual(blanc.appels, [], "à blanc : l'API n'est pas appelée non plus");
  const hors = lancer([...OPTIONS, "--domaine", "rdv.exemple.com", "--zone", "autre.com"], {}, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(hors.statut, 1);
  assert.match(hors.erreur, /n'est pas dans la zone autre\.com/);
  assert.deepEqual(hors.appels, []);
});

test("liste des secrets illisible : arrêt, aucun secret reposé ni proposé", () => {
  const r = lancer(OPTIONS, { bases: `[{"uuid":"${UUID}","name":"lama-relais"}]`, listeSecretsEchoue: true });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /Liste des secrets illisible/);
  assert.match(r.erreur, /aucun secret n'est reposé/);
  assert.match(r.erreur, /network error/, "la sortie d'erreur de wrangler reste visible");
  assert.ok(!r.appels.some((a) => a.includes("secret put")));
  assert.doesNotMatch(r.sortie, /secret put|openssl/);
});

test("--secrets sans terminal : refus dès le début, avant tout appel", () => {
  const r = lancer(["--secrets", ...OPTIONS]);
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /--secrets demande un terminal/);
  assert.deepEqual(r.appels, []);
});

test("enregistrement DNS déjà présent pour l'hôte : arrêt avant tout appel à wrangler, enregistrement nommé", () => {
  const r = lancer(AVEC_DOMAINE, { enregistrementDns: true }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /enregistrement DNS existe déjà pour rdv\.exemple\.com \(A 192\.0\.2\.1\)/);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler")));
});

test("compte visé affiché dès la première étape, même venu de l'environnement", () => {
  const r = lancer(["--a-blanc"], {}, { CLOUDFLARE_ACCOUNT_ID: COMPTE, RELAIS_WORKER: "lama-relais", RELAIS_BASE_D1: "lama-relais" });
  assert.equal(r.statut, 0, r.erreur);
  assert.ok(r.sortie.indexOf(`Compte visé\u00a0: ${COMPTE}`) > r.sortie.indexOf("== Connexion"));
});

test("chemin du fichier produit avec une espace : cité dans les commandes affichées", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama avec espace-"));
  const config = join(dir, "wrangler deploiement.toml");
  const r = lancer(["--a-blanc", ...OPTIONS], {}, { RELAIS_CONFIG_DEPLOIEMENT: config });
  assert.equal(r.statut, 0, r.erreur);
  const cite = config.replace(/ /g, "\\ ");
  assert.match(r.sortie, new RegExp(`^\\+ npx wrangler@4\\.142\\.0 d1 migrations apply lama-relais --remote --config ${cite.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.ok(r.sortie.includes(`secret put RELAIS_CLE_MAITRE --config ${cite}`), r.sortie);
});

test("relance : domaine déjà rattaché au même Worker, son enregistrement DNS présent : le script passe", () => {
  const r = lancer(AVEC_DOMAINE, { domaineRattache: "meme", enregistrementDns: true }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 0, r.erreur);
  assert.ok(r.appels.some((a) => a.startsWith("wrangler deploy")));
});

test("domaine rattaché à un autre Worker : arrêt avant tout appel à wrangler, Worker nommé", () => {
  const r = lancer(AVEC_DOMAINE, { domaineRattache: "autre", enregistrementDns: true }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /déjà rattaché au Worker autre-worker/);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler")));
});

test("réponse illisible pour les domaines des Workers : arrêt, le domaine n'est pas tenu pour libre", () => {
  const r = lancer(AVEC_DOMAINE, { domaineRattache: "illisible" }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /Réponse illisible ou refusée/);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler")));
});

test("DNS illisible sans --sans-controle-dns : arrêt avant tout appel à wrangler, le message cite l'option", () => {
  const r = lancer(AVEC_DOMAINE, { droits: ["d1", "zone", "routes"] }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /Le jeton ne lit pas le DNS/);
  assert.match(r.erreur, /--sans-controle-dns/);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler")));
});

test("DNS illisible avec --sans-controle-dns : avertissement, le script continue et déploie", () => {
  const r = lancer([...AVEC_DOMAINE, "--sans-controle-dns"], { droits: ["d1", "zone", "routes"] }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 0, r.erreur);
  assert.match(r.sortie + r.erreur, /Contrôle DNS sauté.*vérifier soi-même qu'aucun enregistrement n'existe pour rdv\.exemple\.com \(par exemple dig rdv\.exemple\.com\)/);
  assert.ok(r.appels.some((a) => a.startsWith("wrangler deploy")));
});

test("--sans-controle-dns : le domaine rattaché à un autre Worker arrête toujours le script", () => {
  const r = lancer([...AVEC_DOMAINE, "--sans-controle-dns"], { droits: ["d1", "zone", "routes"], domaineRattache: "autre" }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /déjà rattaché au Worker autre-worker/);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler")));
});

test("DNS lisible avec un conflit : --sans-controle-dns n'y change rien, le script s'arrête", () => {
  const r = lancer([...AVEC_DOMAINE, "--sans-controle-dns"], { enregistrementDns: true }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /enregistrement DNS existe déjà pour rdv\.exemple\.com \(A 192\.0\.2\.1\)/);
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler")));
});

test("à blanc : --sans-controle-dns accepté, lecture du sous-domaine workers.dev montrée", () => {
  const r = lancer(["--a-blanc", ...AVEC_DOMAINE, "--sans-controle-dns"], {}, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 0, r.erreur);
  assert.match(r.sortie, new RegExp(`^\\+ GET /accounts/${COMPTE}/workers/subdomain$`, "m"));
  assert.deepEqual(r.appels, []);
});

test("pas de sous-domaine workers.dev : arrêt avant toute écriture, les deux façons de le créer", () => {
  const r = lancer(AVEC_DOMAINE, { sousDomaine: "absent" }, { CLOUDFLARE_API_TOKEN: JETON });
  assert.equal(r.statut, 1);
  assert.match(r.erreur, /sous-domaine workers\.dev/);
  assert.match(r.erreur, /Workers & Pages/);
  assert.match(r.erreur, new RegExp(`PUT /accounts/${COMPTE}/workers/subdomain`));
  assert.ok(!r.appels.some((a) => a.startsWith("wrangler") || a.startsWith("pnpm")));
});
