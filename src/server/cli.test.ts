import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSecret } from "./auth/crypto.ts";
import { openDatabase } from "./storage.ts";
import { runMigrations } from "./migrations.ts";
import { cliBundle } from "./test-support.ts";

const CLI = cliBundle();

/** Lance `cli waha-cle` sur une base (jetable par défaut), la clé sur l'entrée standard. */
function wahaCle(entree: string, dir = mkdtempSync(join(tmpdir(), "lama-cli-"))) {
  const env = { ...process.env, LAMA_DEV: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_LANGUE: "fr" };
  const r = spawnSync(process.execPath, ["--no-warnings", CLI, "waha-cle"], { input: entree, env, encoding: "utf8" });
  return { ...r, dir };
}

test("cli waha-cle : clé lue sur l'entrée standard, chiffrée en base, adresse du conteneur local", () => {
  const cle = "a".repeat(64);
  const r = wahaCle(`${cle}\n`);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(cle), "la clé n'est jamais affichée");
  const db = openDatabase(join(r.dir, "lama.db"));
  const ligne = db.prepare("SELECT value, secret, updated_by FROM settings WHERE key = 'waha.cle'").get() as { value: string; secret: number; updated_by: number | null };
  assert.equal(ligne.secret, 1);
  assert.ok(!ligne.value.includes(cle));
  assert.equal(ligne.updated_by, null);
  const maitresse = new Uint8Array(Buffer.from(readFileSync(join(r.dir, "config", "master.key"), "utf8").trim(), "base64"));
  assert.equal(JSON.parse(openSecret(ligne.value, maitresse)), cle);
  const adresse = db.prepare("SELECT value FROM settings WHERE key = 'waha.adresse'").get() as { value: string };
  assert.equal(JSON.parse(adresse.value), "http://127.0.0.1:3000");
  const fournisseur = db.prepare("SELECT value FROM settings WHERE key = 'whatsapp.fournisseur'").get();
  assert.equal(fournisseur, undefined, "le choix du fournisseur reste à l'administrateur");
  const journal = db.prepare("SELECT action, target FROM audit_log WHERE action = 'reglage'").all() as { target: string }[];
  assert.deepEqual(journal.map((l) => l.target).sort(), ["waha.adresse", "waha.cle"]);
  db.close();
});

test("cli waha-cle : entrée vide refusée, rien d'écrit", () => {
  const r = wahaCle("\n");
  assert.notEqual(r.status, 0);
  assert.equal(existsSync(join(r.dir, "lama.db")), false, "la base n'est même pas ouverte");
});

test("cli waha-cle : une adresse choisie par l'administrateur est gardée, la clé est remplacée (relecture, mineur 5)", () => {
  const premier = wahaCle(`${"a".repeat(64)}\n`);
  const db = openDatabase(join(premier.dir, "lama.db"));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'waha.adresse'").run(JSON.stringify("http://192.168.1.20:3000"));
  db.close();
  const second = wahaCle(`${"b".repeat(64)}\n`, premier.dir);
  assert.equal(second.status, 0, second.stderr);
  const relue = openDatabase(join(premier.dir, "lama.db"));
  assert.equal(JSON.parse((relue.prepare("SELECT value FROM settings WHERE key = 'waha.adresse'").get() as { value: string }).value), "http://192.168.1.20:3000");
  const maitresse = new Uint8Array(Buffer.from(readFileSync(join(premier.dir, "config", "master.key"), "utf8").trim(), "base64"));
  assert.equal(JSON.parse(openSecret((relue.prepare("SELECT value FROM settings WHERE key = 'waha.cle'").get() as { value: string }).value, maitresse)), "b".repeat(64));
  relue.close();
});

/** Lance `cli lire-devise` sur le dossier `dir`, comme lama-formation.sh sous le compte de lama. */
function lireDevise(dir: string) {
  const env = { ...process.env, LAMA_DEV: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_LANGUE: "fr" };
  return spawnSync(process.execPath, ["--no-warnings", CLI, "lire-devise"], { env, encoding: "utf8" });
}

test("cli lire-devise : les trois réglages en options de formation-comptes, une par ligne ; rien sans base ni réglage ; jamais d'écriture", () => {
  const vide = mkdtempSync(join(tmpdir(), "lama-cli-"));
  const absente = lireDevise(vide);
  assert.equal(absente.status, 0, absente.stderr);
  assert.equal(absente.stdout, "");
  assert.equal(existsSync(join(vide, "lama.db")), false, "aucune base créée");

  const dir = mkdtempSync(join(tmpdir(), "lama-cli-"));
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.close();
  assert.equal(lireDevise(dir).stdout, "", "base neuve : rien d'écrit, défaut XAF");

  const ecrit = openDatabase(join(dir, "lama.db"));
  const reglage = ecrit.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES (?, ?, 0, 0)");
  reglage.run("institut.devise", '"EUR"');
  reglage.run("affichage.symbole_position", '"avant"');
  reglage.run("affichage.symbole_ecran", "false");
  ecrit.close();
  const avant = statSync(join(dir, "lama.db")).mtimeMs;
  const r = lireDevise(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "--devise\nEUR\n--position\navant\n--symbole-ecran\nnon\n");
  assert.equal(statSync(join(dir, "lama.db")).mtimeMs, avant, "lecture seule");
});

/** Lance `cli importer-catalogue` sur un fichier écrit dans un dossier jetable. */
function importerCatalogue(contenu: string) {
  const dir = mkdtempSync(join(tmpdir(), "lama-cli-"));
  const fichier = join(dir, "catalogue.csv");
  writeFileSync(fichier, contenu, "utf8");
  const env = { ...process.env, LAMA_DEV: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_LANGUE: "fr" };
  return spawnSync(process.execPath, ["--no-warnings", CLI, "importer-catalogue", fichier], { env, encoding: "utf8" });
}

test("cli importer-catalogue : une erreur de fichier s'imprime seule, sans numéro de ligne ni nombre de lignes à corriger", () => {
  const entete = importerCatalogue("nom;prix\nTissage;5000\n");
  assert.equal(entete.status, 1);
  assert.match(entete.stderr, /^Colonnes manquantes sur la première ligne\u00a0: .+\.\n$/);
  assert.doesNotMatch(entete.stderr, /Ligne 1|lignes à corriger/);
  const guillemets = importerCatalogue('nom;prix\n"Tissage;5000\n');
  assert.equal(guillemets.status, 1);
  assert.equal(guillemets.stderr, "Ligne 2\u00a0: guillemets mal fermés.\n");
  const rien = importerCatalogue("");
  assert.equal(rien.status, 1);
  assert.doesNotMatch(rien.stderr, /Ligne 1|lignes à corriger/);
});
