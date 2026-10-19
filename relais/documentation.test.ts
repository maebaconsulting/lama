import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { frenchFaults, titleCaseFaults } from "../src/client/i18n/typography.ts";
import { DELAI_MS } from "../src/server/en-ligne/client-relais.ts";
import { HORIZON_MAX_JOURS } from "./noyau/contrat.ts";
import { ESSAIS_CONNEXION } from "./routes-gestion.ts";
import { MAX_PAR_TELEPHONE } from "./routes-publiques.ts";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const contrat = lire("../docs/reservation-en-ligne/contrat-v1.md");
const lisezmoi = lire("./LISEZMOI.md");
const apiPublique = lire("../docs/reservation-en-ligne/api-publique-v1.md");

/** Lignes de prose d'un document Markdown (hors blocs de code et code en ligne), comme src/server/docs.test.ts. */
function prose(doc: string): string[] {
  let code = false;
  return doc.split("\n").filter((ligne) => {
    if (ligne.startsWith("```")) {
      code = !code;
      return false;
    }
    return !code;
  }).map((ligne) => ligne.replace(/`[^`]*`/g, "code"));
}

/** Noms propres des titres, absents de la liste partagée de typography.ts. */
const NOMS_PROPRES = ["Cloudflare", "Turnstile"];

/** Chaque terme doit figurer dans le document. */
function nomme(doc: string, termes: string[], enCode = false): void {
  for (const terme of termes) assert.ok(doc.includes(enCode ? `\`${terme}\`` : terme), terme);
}

test("contrat : chaque route de la description OpenAPI est documentée", () => {
  const openapi = JSON.parse(lire("../docs/reservation-en-ligne/contrat-v1.openapi.json")) as { paths: Record<string, unknown> };
  for (const chemin of Object.keys(openapi.paths)) assert.ok(contrat.includes(chemin), chemin);
});

test("contrat : codes d'erreur, en-têtes et règles nommés", () => {
  nomme(contrat, ["signature", "horodatage", "suspendu", "introuvable", "version_ancienne", "donnees_invalides", "corps_trop_gros", "ferme", "inconnue", "rappel_seulement", "indisponible", "interne"], true);
  nomme(contrat, ["X-Lama-Institut", "X-Lama-Horodatage", "X-Lama-Signature", "HMAC-SHA256", "delai_minimal", "genere_le", "composante connexe", "cli verifier-relais"]);
});

test("contrat : les comportements du relais tel que construit sont décrits", () => {
  nomme(contrat, [
    "mode_essai", "LAMA_LANGUE", "entrée standard", "signé à nouveau", "tous salons confondus", "ne saute donc jamais de curseur",
    "même réponse", "1\u00a0Mo", "salon d'essai dédié", "64 caractères hexadécimaux minuscules", "sans avoir rien écrit",
  ]);
  nomme(contrat, ["theme", "horaires", "elegante", "classique", "moderne"], true);
  nomme(contrat, ["prenom", "issue", "sans_suite", "rdv_pris", "injoignable"], true);
  nomme(contrat, ["Votre demande est close", "Bonjour,"]);
  nomme(contrat, ["4,5:1", "3:1", "dès l'ouverture", "reste conforme"]);
  for (const code of ["0", "1", "2", "3"]) assert.match(contrat, new RegExp(`^\\| ${code} \\|`, "m"), `code de sortie ${code}`);
});

test("API publique : routes, codes d'erreur et origines autorisées décrits", () => {
  nomme(apiPublique, ["/api/<salon>/vitrine", "/api/<salon>/jours", "/api/<salon>/creneaux", "/api/<salon>/demandes", "POST /api/<salon>/suivi"]);
  assert.doesNotMatch(apiPublique, /suivi\/<jeton>/, "le jeton ne voyage jamais dans une adresse");
  nomme(apiPublique, ["indisponible", "rappel_seulement", "ferme", "inconnue", "donnees_invalides", "verification", "trop_de_demandes", "trop_de_demandes_telephone", "corps_trop_gros", "introuvable", "origine", "type_contenu"], true);
  nomme(apiPublique, ["hors_horaires", "theme", "horaires"], true);
  nomme(apiPublique, ["prenom", "issue", "sans_suite"], true);
  nomme(apiPublique, ["Access-Control-Allow-Origin", "Vary: Origin", "no-store", "data-salon", "#suivi=", "RELAIS_DEMANDES_PAR_HEURE", "16\u00a0Ko", "1\u00a0Ko", "Turnstile", "application/json", "Salon suspendu", "Salon en essai", "Adresse de prise de rendez-vous incomplète ou inconnue"]);
});

test("notice du relais : variables, entrées Node et Cloudflare, gestion", () => {
  nomme(lisezmoi, [
    "RELAIS_CLE_MAITRE", "RELAIS_ADMIN_MOT_DE_PASSE", "RELAIS_BASE", "RELAIS_PORT", "RELAIS_HOTE", "RELAIS_DIST", "RELAIS_PROXY_DE_CONFIANCE",
    "RELAIS_DEMANDES_PAR_HEURE", "TURNSTILE_CLE_SITE", "TURNSTILE_SECRET", "X-Forwarded-For", "X-Forwarded-Proto", "Ne jamais la changer en service",
    "/assets/*", "/integrer.js", "assets.html_handling = \"none\"", "assets.run_worker_first = true", "wrangler d1 migrations apply", "relais/stockage/migrations/",
    "gestionnaire `scheduled`", "12\u00a0heures", "ferme **toutes** les sessions", "data-salon", "grandit et rétrécit", "motifs.ts", "outils/", "essais/",
  ]);
});

test("notice de mise en service : script, modèle, secrets à l'invite, adresse, budget, essai local", () => {
  nomme(lisezmoi, [
    "deploy/cloudflare.sh --a-blanc", "deploy/cloudflare.sh --secrets", "relais/wrangler.modele.toml", "relais/wrangler.deploiement.toml", "wrangler secret put",
    "jamais en argument", "openssl rand -hex 32", "workers.dev", "--domaine rdv.exemple.com", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "RELAIS_ZONE", "RELAIS_D1_REGION", "Budget du forfait gratuit",
    "Workers Scripts et D1, en modification", "Account Settings, en lecture", "Workers Routes et DNS, en modification", "~/.config/lama/cloudflare.env",
    "100\u00a0000 par jour", "10\u00a0ms par requête", "une fois par minute au plus", "dev --local --test-scheduled", "__scheduled", "verifier-relais", "data-prestation", "salon d'essai dédié",
    "Compte visé", "option inconnue", "rend illisibles", "sans terminal", "déjà rattaché", "enregistrement DNS",
  ]);
  assert.doesNotMatch(lisezmoi, /arrivent avec l'étape de mise en service/);
  assert.match(lisezmoi, /^deploy\/cloudflare\.sh --secrets .*--cle-site-turnstile/m, "l'exemple --secrets garde la clé de site");
  const version = /^WRANGLER_VERSION=(\S+)$/m.exec(lire("../deploy/cloudflare.sh"))?.[1];
  assert.ok(version);
  const citees = [...lisezmoi.matchAll(/npx wrangler@(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  assert.ok(citees.length >= 3);
  assert.deepEqual([...new Set(citees)], [version], "même version de wrangler que le script");
});

test("documents : les nombres et les variables suivent le code", () => {
  const etapes = readFileSync(new URL("../src/server/en-ligne/verifier-relais.ts", import.meta.url), "utf8").match(/^ {4}\["[a-z_]+", /gm)?.length;
  assert.ok(etapes && etapes > 0);
  assert.ok(contrat.includes(`${etapes} points`), `${etapes} points`);
  assert.ok(contrat.includes(`${DELAI_MS / 1000}\u00a0secondes`), "délai par appel");
  assert.ok(contrat.includes(`${HORIZON_MAX_JOURS}\u00a0jours au plus`), "horizon des plages");
  assert.ok(lisezmoi.includes(`${ESSAIS_CONNEXION} essais de connexion`), "essais de connexion");
  assert.ok(apiPublique.includes(`${MAX_PAR_TELEPHONE} demandes en attente`), "limite par numéro");
  const sources = ["./config.ts", "./node.ts"].map(lire).join("\n");
  const variables = [...new Set(sources.match(/\b(?:RELAIS|TURNSTILE)_[A-Z_]+\b/g))];
  assert.ok(variables.length >= 10, "variables extraites des sources");
  for (const v of variables) assert.ok(lisezmoi.includes(`\`${v}\``), v);
});

test("contrat : l'exemple de signature est juste", () => {
  const corps = '{"version":12}';
  const empreinte = createHash("sha256").update(corps).digest("hex");
  const signature = createHmac("sha256", "cle-d-exemple-a-remplacer-0123456789abcdef").update(`1792170000000\nPUT\n/lama/v1/offre\n${empreinte}`).digest("hex");
  assert.ok(contrat.includes(empreinte), "empreinte du corps");
  assert.ok(contrat.includes(signature), "signature");
});

test("documents : typographie française, pas de tiret cadratin, pas de séparateur ni de « booking »", () => {
  for (const doc of [contrat, apiPublique, lisezmoi]) {
    assert.doesNotMatch(doc, /\u2014/);
    assert.doesNotMatch(doc, /@@N*NBSP@@/);
    assert.doesNotMatch(doc, /^---\s*$/m, "pas de triple tiret comme séparateur");
    assert.doesNotMatch(doc, /booking/i);
    assert.doesNotMatch(doc, /\u00a0\u00a0/);
    assert.deepEqual(prose(doc).flatMap((l) => frenchFaults(l).map((f) => `${f} : ${l}`)), []);
    // Majuscules en milieu de titre (« Title Case ») : seuls les titres sont examinés, la prose courante commence ses phrases par des noms propres et des puces.
    assert.deepEqual(doc.split("\n").filter((l) => l.startsWith("#")).flatMap((l) => titleCaseFaults(l.replace(/^#+\s*/, "")).filter((f) => !NOMS_PROPRES.includes(f)).map((f) => `${f} : ${l}`)), []);
  }
});
