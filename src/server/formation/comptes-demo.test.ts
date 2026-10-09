import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { avecDemoPublique, avecFormation, bundleOf, setupApp } from "../test-support.ts";
import { runMigrations } from "../migrations.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { authenticatePassword, authenticatePin } from "../auth/accounts.ts";
import { createSession, resolveSession } from "../auth/sessions.ts";
import { ecrireComptesDemo } from "./comptes.ts";
import { numeroFictif } from "./demo.ts";
import { demanderRemiseAZero } from "./remise-a-zero.ts";

/** Démonstration publique (démo publique DP-02, DP-03, DP-05, DP-06) : comptes publics et administration, état public, numéros fictifs, démarrage et remise. */

// boot.ts importe index.ts, dont les imports internes finissent en .js : on le charge assemblé, comme en production.
// Deux exemplaires du module : après une remise, le service redémarre dans un processus neuf (semis de la démonstration compris).
const BOOT = await bundleOf("./boot.ts");
const { readConfig, start, shutdown } = await import(`${BOOT}#avant-remise`);
const apres = await import(`${BOOT}#apres-remise`);
// Le semis garde son état dans le module : un exemplaire neuf par démarrage sur une base neuve.
const court = await import(`${BOOT}#mot-de-passe-court`);
const reseau = await import(`${BOOT}#reseau`);

const ADMIN = "secret-admin-demo-1";

/** Statut HTTP d'une connexion par mot de passe au serveur démarré sur `port`. */
const connexion = async (port: number, login: string, password: string) =>
  (await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", "X-Lama": "1" }, body: JSON.stringify({ login, password }) })).status;

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

type Ligne = { id: number; login: string; role: string; staff_id: number | null; language: string; display_name: string; active: number };
const comptes = (db: DatabaseSync) => db.prepare("SELECT id, login, role, staff_id, language, display_name, active FROM accounts ORDER BY id").all() as Ligne[];
const idDe = (db: DatabaseSync, login: string) => (db.prepare("SELECT id FROM accounts WHERE login = ?").get(login) as { id: number }).id;

test("comptes de démonstration : trois comptes publics (rôle, fiche, nom, langue), mots de passe et PIN publics ; administration par LAMA_DEMO_MDP_ADMIN", (t) => avecDemoPublique(true, async () => {
  const db = base(t);
  const now = Date.parse("2026-10-08T08:00:00Z");
  assert.deepEqual(await ecrireComptesDemo("fr", now, ADMIN), { comptes: ["gerante", "reception", "praticienne"], admin: "pret" });
  assert.deepEqual(comptes(db).map((c) => [c.login, c.role, c.staff_id, c.language, c.display_name, c.active]), [
    ["gerante", "manager", null, "fr", "Gérante (démo)", 1],
    ["reception", "reception", null, "fr", "Réception (démo)", 1],
    ["praticienne", "practitioner", 1, "fr", "Praticienne (démo)", 1],
    ["administration", "admin", null, "fr", "Administration (démo)", 1],
  ]);
  for (const [login, motDePasse, pin] of [["gerante", "gerante-demo", "2580"], ["reception", "reception-demo", "1357"], ["praticienne", "praticienne-demo", "2468"]]) {
    assert.equal((await authenticatePassword(login, motDePasse, now)).ok, true, login);
    assert.equal((await authenticatePin(idDe(db, login), pin, now)).ok, true, `${login} : PIN`);
  }
  assert.equal((await authenticatePassword("administration", ADMIN, now)).ok, true);
  assert.equal((await ecrireComptesDemo("en", now, ADMIN)).admin, "pret");
  assert.equal(comptes(db)[0].display_name, "Manager (demo)", "langue de l'institut au démarrage");
}));

test("comptes de démonstration rétablis à chaque démarrage : mot de passe, PIN, rôle, fiche, nom et activité remis, sans doublon ; sessions de l'administration fermées", (t) => avecDemoPublique(true, async () => {
  const db = base(t);
  const now = Date.parse("2026-10-08T08:00:00Z");
  await ecrireComptesDemo("fr", now, ADMIN);
  db.prepare("UPDATE accounts SET password_hash = 'x', pin_hash = NULL, active = 0, display_name = 'Autre', role = 'reception', locked_until = ?, failed_attempts = 4 WHERE login = 'gerante'").run(now + 3_600_000);
  const { token } = await createSession(idDe(db, "administration"), "personnel", null, now);
  const avant = await resolveSession(token, now);
  assert.ok(avant && "account" in avant && avant.account.login === "administration", "la session créée est valide avant le redémarrage");
  await ecrireComptesDemo("fr", now, ADMIN);
  assert.equal(await resolveSession(token, now), null, "la même session n'est plus valable après le redémarrage");
  assert.equal(comptes(db).length, 4, "aucun compte en double");
  assert.deepEqual(comptes(db).map((c) => [c.login, c.role, c.display_name, c.active]).slice(0, 1), [["gerante", "manager", "Gérante (démo)", 1]]);
  assert.equal((await authenticatePassword("gerante", "gerante-demo", now)).ok, true, "mot de passe public, compte débloqué");
  assert.equal((await authenticatePin(idDe(db, "gerante"), "2580", now)).ok, true, "PIN public");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?").get(idDe(db, "administration")) as { n: number }).n, 0, "un compte du même identifiant créé en séance ne garde aucune session");
}));

test("sans LAMA_DEMO_MDP_ADMIN valable (absente, vide, trop courte) : aucune administration ; une administration existante est désactivée et déconnectée", (t) => avecDemoPublique(true, async () => {
  const db = base(t);
  const now = Date.parse("2026-10-08T08:00:00Z");
  assert.deepEqual(await ecrireComptesDemo("fr", now, undefined), { comptes: ["gerante", "reception", "praticienne"], admin: "absent" });
  assert.deepEqual(comptes(db).map((c) => c.login), ["gerante", "reception", "praticienne"]);
  assert.equal((await ecrireComptesDemo("fr", now, "court-9ch")).admin, "trop_court", "moins de 10 caractères : traitée comme absente");
  assert.deepEqual(comptes(db).map((c) => c.login), ["gerante", "reception", "praticienne"], "aucun compte créé");
  await ecrireComptesDemo("fr", now, ADMIN);
  await createSession(idDe(db, "administration"), "personnel", null, now);
  assert.equal((await ecrireComptesDemo("fr", now, "")).admin, "absent", "variable vide : absente");
  assert.equal(comptes(db).find((c) => c.login === "administration")?.active, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 0);
  assert.equal((await authenticatePassword("administration", ADMIN, now)).ok, false);
  await ecrireComptesDemo("fr", now, ADMIN);
  await createSession(idDe(db, "administration"), "personnel", null, now);
  assert.equal((await ecrireComptesDemo("fr", now, "court-9ch")).admin, "trop_court");
  assert.equal(comptes(db).find((c) => c.login === "administration")?.active, 0, "administration existante désactivée");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 0, "et déconnectée");
  assert.equal((await authenticatePassword("administration", "court-9ch", now)).ok, false);
  assert.equal((await authenticatePassword("administration", ADMIN, now)).ok, false);
}));

test("administration traitée même si un compte public échoue : retirée et déconnectée sans variable ; PIN posé sur l'administration effacé quand la variable est valable", (t) => avecDemoPublique(true, async () => {
  const db = base(t);
  const now = Date.parse("2026-10-08T08:00:00Z");
  await ecrireComptesDemo("fr", now, ADMIN);
  const id = idDe(db, "administration");
  await createSession(id, "personnel", null, now);
  // Fiche n° 1 absente : la praticienne échoue (clé étrangère).
  db.prepare("DELETE FROM staff WHERE id = 1").run();
  db.prepare("DELETE FROM accounts WHERE login = 'praticienne'").run();
  await assert.rejects(ecrireComptesDemo("fr", now, undefined));
  assert.equal(comptes(db).find((c) => c.login === "administration")?.active, 0, "désactivée malgré l'échec");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 0, "et déconnectée");
  // Variable valable : un PIN posé par un visiteur sur l'administration ne survit pas.
  db.prepare("INSERT INTO staff (id, name, email, title, color) VALUES (1, 'Solange Ekambi', '', '', '#4A5D73')").run();
  db.prepare("UPDATE accounts SET pin_hash = 'x' WHERE id = ?").run(id);
  await ecrireComptesDemo("fr", now, ADMIN);
  assert.equal((db.prepare("SELECT pin_hash FROM accounts WHERE id = ?").get(id) as { pin_hash: string | null }).pin_hash, null);
}));

test("mots de passe publics jamais hors de la démonstration publique : refusés dans la formation de l'institut et dans la vraie base", async (t) => {
  for (const formation of [true, false]) {
    await avecDemoPublique(false, () => avecFormation(formation, async () => {
      const db = base(t);
      await assert.rejects(ecrireComptesDemo("fr", Date.now(), ADMIN), /demo\.reservee/);
      assert.equal(comptes(db).length, 0);
    }));
  }
});

test("état public : en démonstration publique, les trois comptes publics (rôle, identifiant, mot de passe, PIN), jamais l'administration ; rien ailleurs", async (t) => {
  await avecDemoPublique(true, async () => {
    const ctx = await setupApp(t, { demo: false });
    await ctx.seedAccount("admin", "administration");
    const etat = await ctx.raw("GET", "/api/auth/state");
    assert.deepEqual(etat.body.demo, {
      comptes: [
        { login: "gerante", role: "manager", mot_de_passe: "gerante-demo", pin: "2580" },
        { login: "reception", role: "reception", mot_de_passe: "reception-demo", pin: "1357" },
        { login: "praticienne", role: "practitioner", mot_de_passe: "praticienne-demo", pin: "2468" },
      ],
    });
    assert.doesNotMatch(JSON.stringify(etat.body), /administration|"admin"/);
  });
  await avecFormation(true, async () => {
    const ctx = await setupApp(t, { demo: false });
    assert.equal((await ctx.raw("GET", "/api/auth/state")).body.demo, null, "formation de l'institut : aucun compte affiché");
  });
});

test("numéros des fiches : visiblement fictifs dans la démonstration publique (+237 600 00 00 01…), inchangés dans la formation de l'institut", async (t) => {
  assert.equal(numeroFictif(1), "+237 600 00 00 01");
  const numeros = async () => {
    const ctx = await setupApp(t, { demo: false });
    await ctx.raw("GET", "/api/auth/state");
    return (ctx.db.prepare("SELECT phone FROM clients ORDER BY id").all() as { phone: string }[]).map((c) => c.phone);
  };
  assert.deepEqual(await avecDemoPublique(true, numeros), [1, 2, 3, 4, 5, 6].map(numeroFictif));
  assert.equal((await avecFormation(true, numeros))[0], "+237 677 12 34 01");
});

test("démarrage en démonstration publique : comptes et historique sans commande ; remise à zéro : séance effacée, comptes rétablis, administration selon la variable", async () => {
  const avant = [process.env.LAMA_FORMATION, process.env.LAMA_DEMO_PUBLIQUE, process.env.LAMA_DEMO, process.env.LAMA_DEMO_HISTORY];
  const dir = mkdtempSync(join(tmpdir(), "lama-demo-comptes-"));
  const config = { dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true, demoPublique: true };
  delete process.env.LAMA_DEMO;
  delete process.env.LAMA_DEMO_HISTORY;
  // Journal du démarrage : jamais le mot de passe de l'administration.
  const journal: string[] = [];
  const [log, erreur] = [console.log, console.error];
  console.log = (...args: unknown[]) => { journal.push(args.join(" ")); };
  console.error = (...args: unknown[]) => { journal.push(args.join(" ")); };
  try {
    let running = await start({ ...config, demoMdpAdmin: ADMIN }).finally(() => { console.log = log; console.error = erreur; });
    assert.ok(journal.some((l) => l.includes("Comptes de démonstration prêts") || l.includes("Demo accounts ready")), journal.join("\n"));
    assert.ok(!journal.some((l) => l.includes(ADMIN)), "le mot de passe n'est jamais écrit dans le journal");
    assert.equal(await connexion(running.port, "gerante", "gerante-demo"), 200);
    assert.equal(await connexion(running.port, "administration", ADMIN), 200);
    const n = (sql: string) => (running.db.prepare(sql).get() as { n: number }).n;
    assert.ok(n("SELECT COUNT(*) AS n FROM invoices") > 20, "historique de démonstration semé");
    running.db.prepare("INSERT INTO clients (name, email, phone) VALUES ('Visiteuse', '', '+237 600 00 00 99')").run();
    running.db.prepare("UPDATE accounts SET password_hash = 'x' WHERE login = 'gerante'").run();
    await shutdown(running);
    demanderRemiseAZero(dir);
    running = await apres.start(config);
    try {
      assert.equal(await connexion(running.port, "gerante", "gerante-demo"), 200, "comptes publics rétablis");
      assert.equal(n("SELECT COUNT(*) AS n FROM clients WHERE name = 'Visiteuse'"), 0, "séance effacée");
      assert.equal(n("SELECT COUNT(*) AS n FROM clients"), 6, "démonstration recréée");
      assert.equal(await connexion(running.port, "administration", ADMIN), 403, "sans la variable, l'administration est désactivée");
    } finally {
      await apres.shutdown(running);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [nom, valeur] of [["LAMA_FORMATION", avant[0]], ["LAMA_DEMO_PUBLIQUE", avant[1]], ["LAMA_DEMO", avant[2]], ["LAMA_DEMO_HISTORY", avant[3]]] as const) {
      if (valeur === undefined) delete process.env[nom];
      else process.env[nom] = valeur;
    }
  }
});

test("LAMA_DEMO_MDP_ADMIN : jamais de valeur par défaut ; trop courte, la démonstration démarre sans administration et le journal le dit sans citer la valeur", async () => {
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1" }).demoMdpAdmin, undefined);
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1", LAMA_DEMO_MDP_ADMIN: "secret-admin-1" }).demoMdpAdmin, "secret-admin-1");
  const dir = mkdtempSync(join(tmpdir(), "lama-demo-court-"));
  const avant = [process.env.LAMA_LANGUE, process.env.LAMA_DEMO, process.env.LAMA_DEMO_HISTORY];
  process.env.LAMA_LANGUE = "fr";
  // Le semis lit LAMA_DEMO : les essais précédents peuvent l'avoir laissé à "0".
  delete process.env.LAMA_DEMO;
  delete process.env.LAMA_DEMO_HISTORY;
  const journal: string[] = [];
  const [log, erreur] = [console.log, console.error];
  console.log = (...args: unknown[]) => { journal.push(args.join(" ")); };
  console.error = (...args: unknown[]) => { journal.push(args.join(" ")); };
  let running: Awaited<ReturnType<typeof court.start>> | null = null;
  try {
    running = await court.start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true, demoPublique: true, demoMdpAdmin: "court-9ch" }).finally(() => { console.log = log; console.error = erreur; });
    assert.ok(journal.includes("LAMA_DEMO_MDP_ADMIN trop courte (10 caractères au moins)\u00a0: la démonstration démarre sans compte d'administration. Corrigez la variable du service."), journal.join("\n"));
    assert.ok(!journal.some((l) => l.includes("court-9ch")), "la valeur n'est jamais écrite au journal");
    assert.equal(await connexion(running.port, "gerante", "gerante-demo"), 200, "les comptes publics sont là");
    assert.equal(await connexion(running.port, "administration", "court-9ch"), 401, "aucun compte d'administration");
    assert.equal((running.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE login = 'administration'").get() as { n: number }).n, 0);
  } finally {
    if (running) await court.shutdown(running);
    rmSync(dir, { recursive: true, force: true });
    for (const [nom, valeur] of [["LAMA_LANGUE", avant[0]], ["LAMA_DEMO", avant[1]], ["LAMA_DEMO_HISTORY", avant[2]]] as const) {
      if (valeur === undefined) delete process.env[nom];
      else process.env[nom] = valeur;
    }
    delete process.env.LAMA_DEMO_PUBLIQUE;
    delete process.env.LAMA_FORMATION;
  }
});

test("démonstration publique : le démarrage force aussi httpPort et tlsDir à null, sans dépendre de l'appelant (aucun certificat lu, aucune écoute http)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-demo-reseau-"));
  const journal: string[] = [];
  const [log, erreur] = [console.log, console.error];
  console.log = (...args: unknown[]) => { journal.push(args.join(" ")); };
  console.error = (...args: unknown[]) => { journal.push(args.join(" ")); };
  let running: Awaited<ReturnType<typeof reseau.start>> | null = null;
  try {
    // L'appelant demande un dossier de certificats et une écoute http : la démonstration publique n'en veut aucun.
    running = await reseau.start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: join(dir, "tls-absent"), httpPort: 0, demoPublique: true }).finally(() => { console.log = log; console.error = erreur; });
    assert.ok(!journal.some((l) => l.includes("Certificat illisible")), journal.join("\n"));
    assert.equal(running.secure, false);
    assert.equal(running.http, null);
    assert.equal(running.httpPort, null);
  } finally {
    if (running) await reseau.shutdown(running);
    rmSync(dir, { recursive: true, force: true });
    delete process.env.LAMA_DEMO_PUBLIQUE;
    delete process.env.LAMA_FORMATION;
  }
});
