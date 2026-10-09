import assert from "node:assert/strict";
import { test } from "node:test";
import { MIGRATIONS, runMigrations } from "../migrations.ts";
import { openDatabase } from "../storage.ts";
import { setupApp } from "../test-support.ts";

const row = (value: unknown) => ({ ...(value as object) });

test("migration 003 sur une base existante : données gardées, versions anglaises vides, français par défaut (spec § 5.1)", () => {
  const db = openDatabase(":memory:");
  runMigrations(db, MIGRATIONS.filter((m) => m.id !== "003_bilingue"));
  db.exec("INSERT INTO services (name, description, category) VALUES ('Soin du visage', 'Nettoyage de peau', 'Visage')");
  db.exec("INSERT INTO products (name, category) VALUES ('Beurre de karité', 'Corps')");
  db.exec("INSERT INTO staff (name, title) VALUES ('Aïcha', 'Esthéticienne')");
  db.exec("INSERT INTO accounts (display_name, login, role, password_hash, created_at) VALUES ('Dan', 'dan', 'admin', 'x', 0)");
  assert.deepEqual(runMigrations(db), ["003_bilingue"]);
  assert.deepEqual(row(db.prepare("SELECT name, name_en, description_en, category_en FROM services").get()),
    { name: "Soin du visage", name_en: "", description_en: "", category_en: "" });
  assert.deepEqual(row(db.prepare("SELECT name, name_en, category_en FROM products").get()), { name: "Beurre de karité", name_en: "", category_en: "" });
  assert.deepEqual(row(db.prepare("SELECT title, title_en FROM staff").get()), { title: "Esthéticienne", title_en: "" });
  assert.equal((db.prepare("SELECT language FROM accounts").get() as { language: string }).language, "fr");
  assert.throws(() => db.exec("UPDATE accounts SET language = 'de'"), /CHECK/);
  db.close();
});

test("l'état de connexion renvoie la langue du compte, français par défaut", async (t) => {
  const ctx = await setupApp(t);
  const call = await ctx.as("reception");
  assert.equal((await call("GET", "/api/auth/state")).body.account.language, "fr");
});

test("chacun change sa propre langue, quel que soit son rôle, sans mot de passe (spec § 3.2)", async (t) => {
  const ctx = await setupApp(t);
  for (const role of ["admin", "manager", "reception", "practitioner"] as const) {
    const call = await ctx.as(role);
    const res = await call("PUT", "/api/auth/me/language", { language: "en" });
    assert.equal(res.status, 200, role);
    assert.equal(res.body.account.language, "en", role);
    assert.equal((await call("GET", "/api/auth/state")).body.account.language, "en", role);
  }
});

test("une langue inconnue est refusée", async (t) => {
  const ctx = await setupApp(t);
  const call = await ctx.as("reception");
  assert.equal((await call("PUT", "/api/auth/me/language", { language: "de" })).status, 400);
  assert.equal((await call("PUT", "/api/auth/me/language", {})).status, 400);
  assert.equal((await call("GET", "/api/auth/state")).body.account.language, "fr");
});

test("la gérante choisit la langue d'un compte de son équipe, jamais celle de l'administrateur ; le changement est journalisé", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace");
  const admin = await ctx.seedAccount("admin", "dan");
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("PUT", `/api/accounts/${grace.id}`, { language: "en" })).body.code, "confirmation");
  assert.equal((await gerante("POST", "/api/auth/confirm", { password: "mot-de-passe-test" })).status, 200);
  assert.equal((await gerante("PUT", `/api/accounts/${grace.id}`, { language: "en" })).status, 200);
  assert.equal((ctx.db.prepare("SELECT language FROM accounts WHERE id = ?").get(grace.id) as { language: string }).language, "en");
  assert.equal((await gerante("PUT", `/api/accounts/${admin.id}`, { language: "en" })).status, 403);
  const audit = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'compte.modification' AND target = 'grace'").get() as { n: number };
  assert.equal(audit.n, 1);
  const creee = await gerante("POST", "/api/accounts", { display_name: "Ngozi", login: "ngozi", role: "reception", password: "assez-long-1", language: "en" });
  assert.equal(creee.status, 201);
  assert.equal(creee.body.account.language, "en");
});

test("la nouvelle langue s'applique au prochain chargement de l'état, sans couper la session (spec § 3.2)", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace");
  const appareil = ctx.anonymous();
  await appareil("POST", "/api/auth/login", { login: grace.login, password: grace.password });
  const gerante = await ctx.as("manager");
  await gerante("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  await gerante("PUT", `/api/accounts/${grace.id}`, { language: "en" });
  const state = await appareil("GET", "/api/auth/state");
  assert.equal(state.body.account.login, "grace", "toujours connectée");
  assert.equal(state.body.account.language, "en");
});

test("installation : le compte administrateur prend la langue de l'écran d'installation", async (t) => {
  const ctx = await setupApp(t);
  const res = await ctx.anonymous()("POST", "/api/auth/install", { display_name: "Dan", login: "dan", password: "assez-long-1", language: "en" });
  assert.equal(res.status, 201);
  assert.equal(res.body.account.language, "en");
});
