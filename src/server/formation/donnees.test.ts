import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { avecFormation, cliBundle, setupApp } from "../test-support.ts";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { authenticatePassword } from "../auth/accounts.ts";
import { ecrireComptesFormation, retablirComptesFormation } from "./comptes.ts";
import { prixDemo } from "../../shared/devises.ts";

/** Base de formation (distribution D-16) : démonstration semée au premier démarrage, quatre comptes créés par le technicien. */

const CLI = cliBundle();

const MOTS = ["admin-formation-1", "gerante-formation-1", "reception-formation-1", "praticienne-form-1"];

/** Lance `cli formation-comptes` sur un dossier jetable, les mots de passe sur l'entrée standard. */
function cliComptes(entree: string, env: Record<string, string>, dir = mkdtempSync(join(tmpdir(), "lama-formation-cli-")), options: string[] = []) {
  const vars = { ...process.env, LAMA_DEV: "1", LAMA_DATA_DIR: dir, LAMA_CONFIG_DIR: join(dir, "config"), LAMA_LANGUE: "fr", LAMA_DEMO: "0", LAMA_DEMO_HISTORY: "1", ...env };
  return { ...spawnSync(process.execPath, ["--no-warnings", CLI, "formation-comptes", ...options], { input: entree, env: vars, encoding: "utf8" }), dir };
}

/** Base en mémoire migrée, branchée sur @clawnify/db, avec la fiche de praticienne n° 1 de la démonstration. */
function base(t: { after: (fn: () => void) => void }): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  initDB({ STORAGE: sqliteStorage(db) });
  db.prepare("INSERT INTO staff (id, name, email, title, color) VALUES (1, 'Solange Ekambi', '', '', '#4A5D73')").run();
  t.after(() => db.close());
  return db;
}

test("formation : démonstration semée même sans LAMA_DEMO (Institut Démo, série DEMO), historique dès qu'une gérante existe", async (t) => {
  await avecFormation(true, async () => {
    const ctx = await setupApp(t, { demo: false, history: true });
    await ctx.seedAccount("manager", "formation.gerante");
    assert.equal((await ctx.raw("GET", "/api/auth/state")).status, 200);
    const n = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
    assert.equal(n("SELECT COUNT(*) AS n FROM staff"), 4);
    assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 6);
    assert.ok(n("SELECT COUNT(*) AS n FROM invoices") > 20, "six mois d'historique");
    assert.equal(n("SELECT COUNT(*) AS n FROM invoices WHERE number NOT LIKE 'DEMO-%' AND number NOT LIKE 'AV-%'"), 0, "factures de la série DEMO");
    const nom = ctx.db.prepare("SELECT value FROM settings WHERE key = 'institut.nom'").get() as { value: string };
    assert.equal(JSON.parse(nom.value), "Institut Démo");
  });
});

test("hors formation et sans LAMA_DEMO : base vide, comme en service réel", async (t) => {
  await avecFormation(false, async () => {
    const ctx = await setupApp(t, { demo: false, history: true });
    await ctx.raw("GET", "/api/auth/state");
    assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM staff").get() as { n: number }).n, 0);
  });
});

test("comptes de formation : quatre rôles, praticienne reliée à la fiche n° 1, langue choisie ; relancés, mots de passe changés et comptes débloqués", async (t) => {
  const db = base(t);
  const now = Date.parse("2026-10-05T08:00:00Z");
  assert.deepEqual(await ecrireComptesFormation(MOTS, "fr", now), ["formation.admin", "formation.gerante", "formation.reception", "formation.praticienne"]);
  const comptes = db.prepare("SELECT login, role, staff_id, language, display_name FROM accounts ORDER BY id").all() as { login: string; role: string; staff_id: number | null; language: string; display_name: string }[];
  assert.deepEqual(comptes.map((c) => [c.login, c.role, c.staff_id, c.language]), [
    ["formation.admin", "admin", null, "fr"], ["formation.gerante", "manager", null, "fr"],
    ["formation.reception", "reception", null, "fr"], ["formation.praticienne", "practitioner", 1, "fr"],
  ]);
  assert.deepEqual(comptes.map((c) => c.display_name), ["Administration (formation)", "Gérante (formation)", "Réception (formation)", "Praticienne (formation)"]);
  db.prepare("UPDATE accounts SET locked_until = ?, failed_attempts = 5 WHERE login = 'formation.gerante'").run(now + 3_600_000);
  const nouveaux = MOTS.map((m) => `${m}-bis`);
  await ecrireComptesFormation(nouveaux, "fr", now);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 4, "aucun compte en double");
  assert.equal((await authenticatePassword("formation.gerante", nouveaux[1], now)).ok, true, "nouveau mot de passe, compte débloqué");
  assert.equal((await authenticatePassword("formation.admin", MOTS[0], now)).ok, false, "ancien mot de passe refusé");
});

test("comptes de formation : un compte modifié en séance retrouve nom (dans sa langue gardée), rôle, fiche et activité, sans doublon ; mot de passe et PIN gardés par le rétablissement seul", async (t) => {
  const db = base(t);
  const now = Date.parse("2026-10-05T08:00:00Z");
  await ecrireComptesFormation(MOTS, "fr", now);
  db.prepare("UPDATE accounts SET display_name = 'Renommée', role = 'reception', staff_id = NULL, active = 0, language = 'en', pin_hash = 'x', failed_attempts = 3 WHERE login = 'formation.praticienne'").run();
  db.prepare("UPDATE accounts SET role = 'practitioner', staff_id = 1 WHERE login = 'formation.admin'").run();
  assert.deepEqual(await retablirComptesFormation(), ["formation.admin", "formation.gerante", "formation.reception", "formation.praticienne"]);
  const lire = (login: string) => ({ ...db.prepare("SELECT role, staff_id, display_name, active, language, pin_hash, failed_attempts FROM accounts WHERE login = ?").get(login) });
  assert.deepEqual(lire("formation.praticienne"), { role: "practitioner", staff_id: 1, display_name: "Practitioner (training)", active: 1, language: "en", pin_hash: "x", failed_attempts: 0 }, "la langue du compte est gardée, le nom affiché la suit");
  assert.deepEqual([lire("formation.admin").role, lire("formation.admin").staff_id], ["admin", null]);
  assert.equal((await authenticatePassword("formation.praticienne", MOTS[3], now)).ok, true, "mot de passe conservé");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 4);
  db.prepare("DELETE FROM accounts WHERE login = 'formation.reception'").run();
  assert.deepEqual(await retablirComptesFormation(), ["formation.admin", "formation.gerante", "formation.praticienne"], "un compte absent n'est pas recréé sans mot de passe");
  await ecrireComptesFormation(MOTS, "en", now);
  assert.deepEqual(lire("formation.praticienne").display_name, "Practitioner (training)");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 4, "relancer recrée le compte absent");
});

test("comptes de formation : un mot de passe trop court ou un nombre faux, refus avant toute écriture", async (t) => {
  const db = base(t);
  await assert.rejects(ecrireComptesFormation([...MOTS.slice(0, 3), "court"], "fr", 0), /compte\.mot_de_passe_court/);
  await assert.rejects(ecrireComptesFormation(MOTS.slice(0, 3), "fr", 0), /formation\.mots_de_passe/);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 0);
});

test("cli formation-comptes : base créée avec la démonstration et son historique, quatre comptes ; jamais affichés, les mots de passe", () => {
  const r = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Comptes de formation prêts\u00a0: formation\.admin, formation\.gerante, formation\.reception, formation\.praticienne\.\n$/);
  for (const mot of MOTS) assert.ok(!(r.stdout + r.stderr).includes(mot));
  const db = new DatabaseSync(join(r.dir, "lama.db"));
  const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  assert.equal(n("SELECT COUNT(*) AS n FROM accounts"), 4);
  assert.equal(n("SELECT COUNT(*) AS n FROM staff"), 4);
  assert.ok(n("SELECT COUNT(*) AS n FROM invoices") > 20, "historique semé une fois la gérante créée");
  db.close();
});

test("cli formation-comptes : refusée hors formation (rien d'écrit) ; trois lignes seulement, refus lisible", () => {
  const hors = cliComptes(`${MOTS.join("\n")}\n`, {});
  assert.equal(hors.status, 1);
  assert.match(hors.stderr, /Commande réservée à la base de formation/);
  assert.equal(existsSync(join(hors.dir, "lama.db")), false);
  const court = cliComptes(`${MOTS.slice(0, 3).join("\n")}\n`, { LAMA_FORMATION: "1" });
  assert.equal(court.status, 1);
  assert.match(court.stderr, /Quatre mots de passe attendus/);
});

test("cli formation-comptes : refusée sur les dossiers de la vraie base, même avec LAMA_FORMATION=1", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-formation-garde-"));
  const donnees = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1", LAMA_DATA_DIR: "/var/lib/lama" }, dir);
  assert.equal(donnees.status, 1);
  assert.match(donnees.stderr, /vraie base/);
  const config = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1", LAMA_CONFIG_DIR: "/etc/lama" }, dir);
  assert.equal(config.status, 1);
  assert.match(config.stderr, /vraie base/);
  assert.equal(existsSync(join(dir, "lama.db")), false, "rien d'écrit");
});

/** Réglage tel qu'écrit en base, relu en JSON ; `undefined` sans ligne. */
const reglage = (db: DatabaseSync, key: string) => {
  const ligne = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return ligne ? (JSON.parse(ligne.value) as unknown) : undefined;
};

test("cli formation-comptes --devise EUR : réglages écrits avant le semis, démonstration et historique en euros, devise figée en EUR", () => {
  const r = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" }, undefined, ["--devise", "EUR", "--position", "avant", "--symbole-ecran", "non"]);
  assert.equal(r.status, 0, r.stderr);
  const db = new DatabaseSync(join(r.dir, "lama.db"));
  try {
    assert.equal(reglage(db, "institut.devise"), "EUR");
    assert.equal(reglage(db, "affichage.symbole_position"), "avant");
    assert.equal(reglage(db, "affichage.symbole_ecran"), false);
    const prix = (sql: string) => (db.prepare(sql).get() as { p: number }).p;
    assert.equal(prix("SELECT price AS p FROM services WHERE id = 1"), prixDemo(25000, "EUR"));
    assert.equal(prix("SELECT cost AS p FROM products WHERE id = 1"), prixDemo(2500, "EUR"));
    assert.ok((db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n > 20, "historique semé");
    assert.equal(prix("SELECT MIN(unit_price) AS p FROM invoice_lines WHERE kind = 'service' AND ref_id = 1"), prixDemo(25000, "EUR"), "historique facturé en euros");
    assert.throws(() => db.prepare("UPDATE settings SET value = '\"XAF\"' WHERE key = 'institut.devise'").run(), /Devise figée/);
  } finally {
    db.close();
  }
  // Relancée (mots de passe changés), la commande garde la devise et le dit si on en demande une autre.
  const relance = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" }, r.dir, ["--devise", "USD"]);
  assert.equal(relance.status, 0, relance.stderr);
  assert.match(relance.stdout, /garde sa devise, EUR, déjà figée par ses ventes\u00a0: USD n'est pas appliquée/);
});

test("cli formation-comptes : devise inconnue ou option refusée avant toute écriture ; sans option, XAF", () => {
  const inconnue = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" }, undefined, ["--devise", "ABC"]);
  assert.equal(inconnue.status, 1);
  assert.match(inconnue.stderr, /Devise inconnue\u00a0: ABC\. Codes acceptés\u00a0: XAF, /);
  assert.equal(existsSync(join(inconnue.dir, "lama.db")), false, "rien d'écrit");
  const position = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" }, undefined, ["--position", "milieu"]);
  assert.equal(position.status, 1);
  assert.match(position.stderr, /Valeur refusée pour --position\u00a0: milieu/);
  const seule = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" }, undefined, ["--devise"]);
  assert.equal(seule.status, 1);
  assert.match(seule.stderr, /Option inconnue ou sans valeur\u00a0: --devise/);
  const sans = cliComptes(`${MOTS.join("\n")}\n`, { LAMA_FORMATION: "1" });
  assert.equal(sans.status, 0, sans.stderr);
  const db = new DatabaseSync(join(sans.dir, "lama.db"));
  try {
    assert.equal(reglage(db, "institut.devise"), undefined, "défaut du code : XAF");
    assert.equal((db.prepare("SELECT price FROM services WHERE id = 1").get() as { price: number }).price, 25000);
  } finally {
    db.close();
  }
});
