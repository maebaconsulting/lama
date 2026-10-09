import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { message } from "../messages.ts";
import { avecDemoPublique, avecFormation, bundleOf, setupApp } from "../test-support.ts";
import { runMigrations } from "../migrations.ts";
import { openDatabase } from "../storage.ts";
import { COMPTES_FORMATION } from "./comptes.ts";
import { appliquerRemiseAZero, DEMANDE_REMISE_A_ZERO, demanderRemiseAZero } from "./remise-a-zero.ts";

/** Remise à zéro de la base de formation (distribution D-19) : démonstration recréée à neuf, comptes de formation gardés, vraie base jamais touchée. */

// Chemin relatif à test-support.ts (src/server), comme dans les autres essais.
const { start, shutdown } = await import(await bundleOf("./boot.ts"));

/** Base de formation « usée » : les quatre comptes, un compte créé en séance, un poste, une session, des fiches et un réglage. */
function baseUsee(dir: string): void {
  const db = openDatabase(join(dir, "lama.db"));
  runMigrations(db);
  db.prepare("INSERT INTO staff (id, name, email, title, color) VALUES (1, 'Solange Ekambi', '', '', '#4A5D73'), (9, 'Créée en séance', '', '', '#4A5D73')").run();
  const compte = db.prepare("INSERT INTO accounts (id, display_name, login, role, password_hash, staff_id, created_at) VALUES (?, ?, ?, ?, 'empreinte', ?, 0)");
  compte.run(1, "Administration (formation)", "formation.admin", "admin", null);
  compte.run(2, "Gérante (formation)", "formation.gerante", "manager", null);
  compte.run(3, "Réception (formation)", "formation.reception", "reception", null);
  compte.run(4, "Praticienne (formation)", "formation.praticienne", "practitioner", 1);
  compte.run(5, "Stagiaire", "stagiaire", "practitioner", 9);
  db.prepare("INSERT INTO devices (id, token_hash, name, created_by, created_at) VALUES (7, 'jeton-poste', 'Tablette du comptoir', 5, 0)").run();
  db.prepare("INSERT INTO sessions (token_hash, account_id, kind, created_at, last_seen_at, expires_at) VALUES ('jeton-session', 2, 'personnel', 0, 0, 9999999999999)").run();
  db.prepare("INSERT INTO clients (name, email, phone) VALUES ('Cliente de séance', '', '')").run();
  db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', '\"Renommé en séance\"', 0, 0)").run();
  db.close();
}

const n = (dir: string, sql: string) => {
  const db = openDatabase(join(dir, "lama.db"));
  try {
    return (db.prepare(sql).get() as { n: number }).n;
  } finally {
    db.close();
  }
};

test("remise à zéro : les quatre comptes de formation et les postes gardés, tout le reste recréé à neuf ; demande consommée", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-remise-"));
  baseUsee(dir);
  demanderRemiseAZero(dir);
  assert.equal(appliquerRemiseAZero(dir), true);
  assert.equal(existsSync(join(dir, DEMANDE_REMISE_A_ZERO)), false, "demande consommée");
  const db = openDatabase(join(dir, "lama.db"));
  const comptes = db.prepare("SELECT id, login, staff_id FROM accounts ORDER BY id").all() as { id: number; login: string; staff_id: number | null }[];
  assert.deepEqual(comptes.map((c) => [c.id, c.login, c.staff_id]), [[1, "formation.admin", null], [2, "formation.gerante", null], [3, "formation.reception", null], [4, "formation.praticienne", 1]]);
  assert.deepEqual(db.prepare("SELECT id, name, created_by FROM devices").all().map((d) => ({ ...d })), [{ id: 7, name: "Tablette du comptoir", created_by: null }]);
  for (const table of ["sessions", "staff", "clients", "settings", "invoices"]) {
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
  }
  db.close();
  assert.equal(appliquerRemiseAZero(dir), false, "sans demande, rien");
  rmSync(dir, { recursive: true, force: true });
});

test("remise à zéro : sans demande, la base n'est pas touchée ; base illisible, base neuve sans compte et journal explicite", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lama-remise-sans-"));
  baseUsee(dir);
  assert.equal(appliquerRemiseAZero(dir), false);
  assert.equal(n(dir, "SELECT COUNT(*) AS n FROM clients"), 1);
  const journal = mock.method(console, "log", () => {});
  t.after(() => journal.mock.restore());
  const abimee = mkdtempSync(join(tmpdir(), "lama-remise-abimee-"));
  writeFileSync(join(abimee, "lama.db"), "pas une base");
  demanderRemiseAZero(abimee);
  assert.equal(appliquerRemiseAZero(abimee), true);
  assert.equal(n(abimee, "SELECT COUNT(*) AS n FROM accounts"), 0);
  assert.match(journal.mock.calls.map((a) => String(a.arguments[0])).join("\n"), /(illisible|unreadable).*lama-formation --comptes/, "base illisible signalée, sans prétendre garder des comptes");
  assert.doesNotMatch(journal.mock.calls.map((a) => String(a.arguments[0])).join("\n"), /rétablis|restored/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(abimee, { recursive: true, force: true });
});

test("démarrage : la remise n'est appliquée qu'en formation ; la vraie base ignore une demande et garde ses données", async () => {
  const demarrer = async (dir: string, formation: boolean) => {
    mkdirSync(join(dir, "config"), { recursive: true });
    if (!existsSync(join(dir, "config", "master.key"))) writeFileSync(join(dir, "config", "master.key"), randomBytes(32).toString("base64"), { mode: 0o600 });
    const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb"), tlsDir: null, httpPort: null, formation });
    running.stopWorker();
    running.server.close();
    running.db.close();
  };
  await avecFormation(false, async () => {
    const vraie = mkdtempSync(join(tmpdir(), "lama-remise-vraie-"));
    baseUsee(vraie);
    demanderRemiseAZero(vraie);
    await demarrer(vraie, false);
    assert.equal(n(vraie, "SELECT COUNT(*) AS n FROM clients"), 1, "vraie base intacte");
    assert.equal(n(vraie, "SELECT COUNT(*) AS n FROM accounts"), 5);
    assert.equal(existsSync(join(vraie, DEMANDE_REMISE_A_ZERO)), true, "la demande n'est pas lue hors formation");
    const formation = mkdtempSync(join(tmpdir(), "lama-remise-formation-"));
    baseUsee(formation);
    // Comptes de formation dénaturés en séance : rôle, nom et fiche liée changés.
    const usee = openDatabase(join(formation, "lama.db"));
    usee.prepare("UPDATE accounts SET role = 'reception', display_name = 'Renommée', staff_id = 9 WHERE login = 'formation.praticienne'").run();
    usee.prepare("UPDATE accounts SET role = 'practitioner', staff_id = 9 WHERE login = 'formation.admin'").run();
    usee.close();
    demanderRemiseAZero(formation);
    const journal = mock.method(console, "log", () => {});
    try {
      await demarrer(formation, true);
    } finally {
      journal.mock.restore();
    }
    const lignesJournal = journal.mock.calls.map((a) => String(a.arguments[0]));
    assert.ok(lignesJournal.some((l) => (["fr", "en"] as const).some((langue) => l === message(langue, "formation.remise_faite"))), "formation de l'institut : journal « postes gardés »");
    assert.equal(n(formation, "SELECT COUNT(*) AS n FROM devices"), 1, "formation de l'institut : la tablette reste déclarée");
    // La fiche de séance a disparu ; la démonstration est semée de nouveau.
    assert.equal(n(formation, "SELECT COUNT(*) AS n FROM clients WHERE name = 'Cliente de séance'"), 0);
    assert.equal(n(formation, "SELECT COUNT(*) AS n FROM accounts"), 4);
    // Rétablis au démarrage par retablirComptesFormation : rôle, fiche liée (fiche n° 1 semée de nouveau), nom.
    const db = openDatabase(join(formation, "lama.db"));
    const lignes = db.prepare("SELECT login, role, staff_id, display_name FROM accounts ORDER BY id").all() as { login: string; role: string; staff_id: number | null; display_name: string }[];
    assert.deepEqual(lignes.map((l) => [l.login, l.role, l.staff_id]), COMPTES_FORMATION.map((c) => [c.login, c.role, c.staff_id]));
    assert.equal(lignes[3].display_name, message("fr", "formation.compte.praticienne"));
    assert.equal((db.prepare("SELECT name FROM staff WHERE id = 1").get() as { name: string }).name, "Solange Ekambi");
    db.close();
    rmSync(vraie, { recursive: true, force: true });
    rmSync(formation, { recursive: true, force: true });
  });
});

test("remise à zéro avec un service en anglais : un compte de formation en français reste en français, son nom affiché aussi ; un compte en anglais reste en anglais", async () => {
  await avecFormation(true, async () => {
    const dir = mkdtempSync(join(tmpdir(), "lama-remise-langue-"));
    mkdirSync(join(dir, "config"), { recursive: true });
    writeFileSync(join(dir, "config", "master.key"), randomBytes(32).toString("base64"), { mode: 0o600 });
    baseUsee(dir);
    const usee = openDatabase(join(dir, "lama.db"));
    usee.prepare("UPDATE accounts SET language = 'en' WHERE login = 'formation.gerante'").run();
    usee.close();
    demanderRemiseAZero(dir);
    const avant = process.env.LAMA_LANGUE;
    process.env.LAMA_LANGUE = "en";
    try {
      const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "usb"), tlsDir: null, httpPort: null, formation: true });
      running.stopWorker();
      running.server.close();
      running.db.close();
    } finally {
      if (avant === undefined) delete process.env.LAMA_LANGUE;
      else process.env.LAMA_LANGUE = avant;
    }
    const db = openDatabase(join(dir, "lama.db"));
    const lignes = db.prepare("SELECT login, language, display_name FROM accounts ORDER BY id").all() as { login: string; language: string; display_name: string }[];
    db.close();
    assert.deepEqual(lignes.map((l) => [l.login, l.language]), [["formation.admin", "fr"], ["formation.gerante", "en"], ["formation.reception", "fr"], ["formation.praticienne", "fr"]]);
    assert.deepEqual(lignes.map((l) => l.display_name), [
      message("fr", "formation.compte.admin"), message("en", "formation.compte.gerante"), message("fr", "formation.compte.reception"), message("fr", "formation.compte.praticienne"),
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

test("remise à zéro : jamais la vraie base, ni pour la demande ni pour l'application", () => {
  for (const vraie of ["/var/lib/lama", "/var/lib/lama/sous-dossier"]) {
    assert.throws(() => demanderRemiseAZero(vraie), /vraie base|real database/);
    assert.throws(() => appliquerRemiseAZero(vraie), /vraie base|real database/);
  }
});

test("route : administrateur de la formation, mot de passe retapé ; demande déposée, maintenance annoncée, redémarrage demandé ; 404 hors formation", async (t) => {
  const avant = process.env.LAMA_FORMATION;
  t.after(() => { if (avant === undefined) delete process.env.LAMA_FORMATION; else process.env.LAMA_FORMATION = avant; });
  const dir = mkdtempSync(join(tmpdir(), "lama-remise-route-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let relances = 0;
  const BACKUP = { usbDir: join(dir, "usb"), tmpDir: join(dir, "tmp"), dataDir: dir, recipient: "", exec: async () => ({ code: 0, stdout: "", stderr: "" }), requestRestart: () => { relances++; } };
  process.env.LAMA_FORMATION = "1";
  const ctx = await setupApp(t, { demo: false, bindings: { BACKUP } });
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("POST", "/api/formation/remise-a-zero")).status, 403, "administrateur seulement");
  const admin = await ctx.as("admin");
  const sans = await admin("POST", "/api/formation/remise-a-zero");
  assert.equal(sans.status, 403);
  assert.equal(sans.body.code, "confirmation");
  assert.equal(existsSync(join(dir, DEMANDE_REMISE_A_ZERO)), false);
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  // Hors formation, les cookies changent de nom : une session ouverte sous ce mode-là.
  process.env.LAMA_FORMATION = "0";
  const horsFormation = await ctx.as("admin");
  await horsFormation("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await horsFormation("POST", "/api/formation/remise-a-zero")).status, 404, "hors formation");
  assert.equal(existsSync(join(dir, DEMANDE_REMISE_A_ZERO)), false);
  process.env.LAMA_FORMATION = "1";
  const ok = await admin("POST", "/api/formation/remise-a-zero");
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, restart: true });
  assert.equal(existsSync(join(dir, DEMANDE_REMISE_A_ZERO)), true);
  assert.equal(relances, 1);
  assert.equal((await admin("GET", "/api/auth/me")).status, 503, "maintenance jusqu'au redémarrage");
});

test("remise à zéro : copie en échec, l'ancienne base avec ses comptes et la demande restent intactes ; temporaire d'une panne effacé", () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-remise-atomique-"));
  baseUsee(dir);
  // Schéma divergent : une colonne inconnue de la base neuve fait refuser la copie des comptes.
  const db = openDatabase(join(dir, "lama.db"));
  db.exec("ALTER TABLE accounts ADD COLUMN inconnue TEXT");
  db.close();
  writeFileSync(join(dir, "lama.db.remise"), "reste d'une panne");
  demanderRemiseAZero(dir);
  assert.throws(() => appliquerRemiseAZero(dir));
  assert.equal(existsSync(join(dir, DEMANDE_REMISE_A_ZERO)), true, "demande conservée");
  assert.equal(existsSync(join(dir, "lama.db.remise")), false, "temporaire nettoyé");
  assert.equal(n(dir, "SELECT COUNT(*) AS n FROM accounts"), 5, "ancienne base intacte");
  assert.equal(n(dir, "SELECT COUNT(*) AS n FROM clients"), 1);
  rmSync(dir, { recursive: true, force: true });
});

test("remise à zéro : seule une base réellement illisible est refaite sans compte ; toute autre erreur de lecture remonte sans rien toucher", (t) => {
  const journal = mock.method(console, "log", () => {});
  t.after(() => journal.mock.restore());
  // Base lisible mais sans table des comptes : ce n'est pas une base illisible.
  const autre = mkdtempSync(join(tmpdir(), "lama-remise-autre-"));
  const db = openDatabase(join(autre, "lama.db"));
  db.exec("CREATE TABLE autre (x INTEGER)");
  db.close();
  demanderRemiseAZero(autre);
  assert.throws(() => appliquerRemiseAZero(autre), /accounts/);
  assert.equal(existsSync(join(autre, DEMANDE_REMISE_A_ZERO)), true, "demande conservée");
  assert.equal(n(autre, "SELECT COUNT(*) AS n FROM autre"), 0, "base d'origine intacte");
  assert.equal(existsSync(join(autre, "lama.db.remise")), false);
  // Fichier qui n'est pas une base : refait sans compte.
  const abimee = mkdtempSync(join(tmpdir(), "lama-remise-pasbase-"));
  writeFileSync(join(abimee, "lama.db"), "pas une base du tout, vraiment pas");
  demanderRemiseAZero(abimee);
  assert.equal(appliquerRemiseAZero(abimee), true);
  assert.equal(n(abimee, "SELECT COUNT(*) AS n FROM accounts"), 0);
  assert.equal(existsSync(join(abimee, DEMANDE_REMISE_A_ZERO)), false);
  rmSync(autre, { recursive: true, force: true });
  rmSync(abimee, { recursive: true, force: true });
});

test("remise de la démonstration publique : aucun poste gardé (ni nom saisi par un visiteur), comptes publics gardés", async () => {
  await avecDemoPublique(true, () => {
    const dir = mkdtempSync(join(tmpdir(), "lama-remise-demo-"));
    baseUsee(dir);
    const db = openDatabase(join(dir, "lama.db"));
    db.prepare("INSERT INTO accounts (id, display_name, login, role, password_hash, staff_id, created_at) VALUES (6, 'Gérante (démo)', 'gerante', 'manager', 'empreinte', NULL, 0)").run();
    db.prepare("INSERT INTO devices (id, token_hash, name, created_by, created_at) VALUES (8, 'jeton-visiteur', 'Poste du visiteur', 6, 0)").run();
    db.close();
    demanderRemiseAZero(dir);
    assert.equal(appliquerRemiseAZero(dir), true);
    assert.equal(n(dir, "SELECT COUNT(*) AS n FROM devices"), 0, "aucun poste gardé");
    assert.equal(n(dir, "SELECT COUNT(*) AS n FROM accounts WHERE login = 'gerante'"), 1, "compte public gardé");
    rmSync(dir, { recursive: true, force: true });
  });
});

test("démarrage de la démonstration publique après une remise : journal propre à la démonstration, aucun poste gardé", async () => {
  await avecDemoPublique(false, async () => {
    const dir = mkdtempSync(join(tmpdir(), "lama-remise-demo-boot-"));
    mkdirSync(join(dir, "config"), { recursive: true });
    baseUsee(dir);
    const avant = process.env.LAMA_DEMO_PUBLIQUE;
    process.env.LAMA_DEMO_PUBLIQUE = "1";
    try {
      demanderRemiseAZero(dir);
    } finally {
      process.env.LAMA_DEMO_PUBLIQUE = avant;
    }
    const journal = mock.method(console, "log", () => {});
    try {
      const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "usb"), tlsDir: null, httpPort: null, formation: true, demoPublique: true });
      await shutdown(running);
    } finally {
      journal.mock.restore();
    }
    const lignes = journal.mock.calls.map((a) => String(a.arguments[0]));
    const demo = (["fr", "en"] as const).map((l) => message(l, "demo.remise_faite"));
    const formation = (["fr", "en"] as const).map((l) => message(l, "formation.remise_faite"));
    assert.ok(lignes.some((l) => demo.includes(l)), `journal de la démonstration : ${lignes.join(" / ")}`);
    assert.ok(!lignes.some((l) => formation.includes(l)), "jamais « postes gardés » en démonstration");
    assert.equal(n(dir, "SELECT COUNT(*) AS n FROM devices"), 0, "aucun poste gardé");
    rmSync(dir, { recursive: true, force: true });
  });
});
