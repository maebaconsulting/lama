import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openSecret } from "./auth/crypto.ts";
import { openDatabase } from "./storage.ts";
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
