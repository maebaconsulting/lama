import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { configWrangler, ecarts, idBase, idZone, MODELE, type Reglages, ReglagesRefuses, reglagesDepuis, reponseReussie, SECRETS, secretsPoses } from "./config-wrangler.ts";

const modele = readFileSync(MODELE, "utf8");
const OUTIL = fileURLToPath(new URL("./config-wrangler.ts", import.meta.url));
const REGLAGES: Reglages = {
  compte: "0123456789abcdef0123456789abcdef", worker: "lama-relais", base: "lama-relais", idBase: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  domaine: null, demandesParHeure: 30, cleSiteTurnstile: "0x4AAAAAAAexemple",
};
/** Lignes utiles du fichier (sans commentaires ni lignes vides). */
const lignes = (toml: string) => toml.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));

test("modèle versionné : aucun identifiant de compte ni de base, réglages notés à l'étape 2", () => {
  assert.doesNotMatch(modele, /[0-9a-f]{32}/, "aucun identifiant de compte");
  assert.doesNotMatch(modele, /[0-9a-f]{8}-[0-9a-f]{4}-/, "aucun identifiant de base");
  assert.match(modele, /^account_id = "@COMPTE@"$/m);
  assert.match(modele, /^database_id = "@ID_BASE@"$/m);
  for (const ligne of ['main = "worker.ts"', 'directory = "./dist"', 'binding = "ASSETS"', 'html_handling = "none"', "run_worker_first = true", 'binding = "BASE"', 'migrations_dir = "stockage/migrations"', 'crons = ["17 3 * * *"]', "preview_urls = false"]) {
    assert.ok(lignes(modele).includes(ligne), ligne);
  }
  assert.match(modele, /^compatibility_date = "\d{4}-\d{2}-\d{2}"$/m);
});

test("modèle : les variables du Worker sont celles de config.ts qui ne sont pas des secrets", () => {
  const config = readFileSync(new URL("../config.ts", import.meta.url), "utf8");
  const toutes = [...config.matchAll(/^\s+((?:RELAIS|TURNSTILE)_[A-Z_]+)\?: string;$/gm)].map((m) => m[1]).sort();
  const vars = [...modele.slice(modele.indexOf("[vars]")).matchAll(/^([A-Z_]+) = /gm)].map((m) => m[1]);
  assert.deepEqual([...vars, ...SECRETS].sort(), toutes);
  for (const s of SECRETS) assert.doesNotMatch(lignes(modele).join("\n"), new RegExp(`^${s} =`, "m"), `${s} n'est jamais une variable`);
});

test("configuration remplie : compte, base, variables ; workers.dev sans domaine personnalisé", () => {
  const toml = configWrangler(modele, REGLAGES);
  assert.doesNotMatch(toml, /@[A-Z_]+@/, "plus aucun repère");
  for (const ligne of ['account_id = "0123456789abcdef0123456789abcdef"', 'name = "lama-relais"', 'database_name = "lama-relais"', 'database_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"', "workers_dev = true", 'RELAIS_DEMANDES_PAR_HEURE = "30"', 'TURNSTILE_CLE_SITE = "0x4AAAAAAAexemple"']) {
    assert.ok(lignes(toml).includes(ligne), ligne);
  }
  assert.doesNotMatch(toml, /^routes/m);
  assert.ok(lignes(configWrangler(modele, { ...REGLAGES, cleSiteTurnstile: null })).includes('TURNSTILE_CLE_SITE = ""'), "Turnstile désactivé");
});

test("domaine personnalisé : route du domaine avant toute table, workers.dev coupé", () => {
  const toml = configWrangler(modele, { ...REGLAGES, domaine: "rdv.exemple.com" });
  const route = lignes(toml).indexOf('routes = [{ pattern = "rdv.exemple.com", custom_domain = true }]');
  assert.ok(route > 0, "route posée");
  assert.ok(route < lignes(toml).indexOf("[assets]"), "clé de premier niveau, avant les tables");
  assert.ok(lignes(toml).includes("workers_dev = false"));
});

test("réglages refusés : rien d'autre que des noms sûrs n'entre dans le fichier", () => {
  const refus = (r: Partial<Reglages>) => ecarts({ ...REGLAGES, ...r }).length;
  for (const compte of ["", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef", 'x" = 1']) assert.equal(refus({ compte }), 1, compte);
  for (const worker of ["", "Lama-Relais", "-relais", "relais-", "relais eclat", 'relais"\nmain = "x', "r".repeat(64)]) assert.equal(refus({ worker }), 1, worker);
  for (const base of ["", "base_d1", "base.d1"]) assert.equal(refus({ base }), 1, base);
  for (const idBase of ["", "à-créer", "9ACD5035-826F-4146-AFE3-651F0A7CC763"]) assert.equal(refus({ idBase }), 1, idBase);
  for (const domaine of ["https://rdv.exemple.com", "rdv.exemple.com/", "RDV.exemple.com", "localhost", 'rdv.exemple.com", custom_domain = false }]']) assert.equal(refus({ domaine }), 1, domaine);
  for (const demandesParHeure of [0, -1, 1.5, 1001, Number.NaN]) assert.equal(refus({ demandesParHeure }), 1, String(demandesParHeure));
  for (const cleSiteTurnstile of ["", "clé", 'x"']) assert.equal(refus({ cleSiteTurnstile }), 1, cleSiteTurnstile);
  assert.throws(() => configWrangler(modele, { ...REGLAGES, worker: "Relais" }), ReglagesRefuses);
  assert.throws(() => configWrangler("name = \"@INCONNU@\"", REGLAGES), /repère inconnu/);
});

test("sorties de wrangler : identifiant de la base nommée, secrets posés, bandeau ignoré", () => {
  const liste = `⛅️ wrangler 4.142.0\n[{"uuid":"11111111-2222-3333-4444-555555555555","name":"autre"},{"uuid":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","name":"lama-relais"}]`;
  assert.equal(idBase(liste, "lama-relais"), "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.equal(idBase(liste, "manquante"), null);
  assert.equal(idBase("[]", "lama-relais"), null);
  assert.throws(() => idBase("Not logged in.", "lama-relais"), ReglagesRefuses);
  assert.deepEqual(secretsPoses('[{"name":"RELAIS_CLE_MAITRE","type":"secret_text"},{"name":"TURNSTILE_SECRET","type":"secret_text"}]'), ["RELAIS_CLE_MAITRE", "TURNSTILE_SECRET"]);
});

test("réponses de l'API de Cloudflare : succès, zone visible par le jeton", () => {
  assert.equal(reponseReussie('{"success":true,"errors":[],"result":[]}'), true);
  for (const r of ['{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}', "", "<html>", '{"result":[]}']) assert.equal(reponseReussie(r), false, r);
  const zones = '{"success":true,"result":[{"id":"023e105f4ecef8ad9ca31a8372d0c353","name":"exemple.com","status":"active"}]}';
  assert.equal(idZone(zones, "exemple.com"), "023e105f4ecef8ad9ca31a8372d0c353");
  assert.equal(idZone(zones, "autre.com"), null);
  assert.equal(idZone('{"success":true,"result":[]}', "exemple.com"), null, "zone hors de portée du jeton");
  assert.equal(idZone('{"success":false,"result":null}', "exemple.com"), null);
});

test("zone trouvée mais pas encore active : refus bilingue qui nomme l'état", () => {
  for (const status of ["pending", "moved", ""]) {
    const zones = `{"success":true,"result":[{"id":"023e105f4ecef8ad9ca31a8372d0c353","name":"exemple.com","status":"${status}"}]}`;
    assert.throws(
      () => idZone(zones, "exemple.com"),
      (e: unknown) => e instanceof ReglagesRefuses && e.motifs[0].fr === `Zone exemple.com pas encore active (état\u00a0: ${status})\u00a0: attendre la bascule des serveurs de noms.` && e.motifs[0].en === `Zone exemple.com not active yet (status: ${status}): wait for the nameserver switch.`,
      status,
    );
  }
  assert.throws(() => idZone('{"success":true,"result":[{"id":"023e","name":"exemple.com"}]}', "exemple.com"), ReglagesRefuses, "état absent : pas active");
});

test("ligne de commande : fichier sur la sortie standard, refus en code 2 dans la langue demandée", () => {
  const args = ["config", "--compte", REGLAGES.compte, "--worker", "lama-relais", "--base", "lama-relais", "--id-base", REGLAGES.idBase, "--demandes-par-heure", "30"];
  const toml = execFileSync(process.execPath, ["--experimental-strip-types", OUTIL, ...args], { encoding: "utf8" });
  assert.match(toml, /^name = "lama-relais"$/m);
  const refus = spawnSync(process.execPath, ["--experimental-strip-types", OUTIL, "config", "--worker", "Relais"], { encoding: "utf8", env: { ...process.env, LAMA_LANGUE: "en" } });
  assert.equal(refus.status, 2);
  assert.equal(refus.stdout, "");
  assert.match(refus.stderr, /Cloudflare account ID: 32 lowercase hexadecimal characters/);
  assert.match(refus.stderr, /Worker name/);
  const id = execFileSync(process.execPath, ["--experimental-strip-types", OUTIL, "id-base", "lama-relais"], { encoding: "utf8", input: '[{"uuid":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","name":"lama-relais"}]' });
  assert.equal(id, REGLAGES.idBase);
});

test("options de la commande config : toute option inconnue ou répétée est refusée, dans les deux langues", () => {
  const bonnes = ["--compte", "a", "--worker", "b", "--base", "c", "--id-base", "d", "--domaine", "rdv.exemple.com", "--demandes-par-heure", "30", "--cle-site-turnstile", "k"];
  assert.equal(reglagesDepuis(bonnes).domaine, "rdv.exemple.com");
  const motif = (args: string[]) => {
    try {
      reglagesDepuis(args);
    } catch (e) {
      assert.ok(e instanceof ReglagesRefuses);
      return e.motifs[0];
    }
    assert.fail(`option acceptée : ${args.join(" ")}`);
  };
  const inconnue = motif([...bonnes, "--domain", "rdv.exemple.com"]);
  assert.match(inconnue.fr, /option inconnue/);
  assert.match(inconnue.fr, /--domain/);
  assert.match(inconnue.en, /unknown option/);
  const repetee = motif([...bonnes, "--domaine", "autre.exemple.com"]);
  assert.match(repetee.fr, /option répétée/);
  assert.match(repetee.en, /repeated option/);
});
