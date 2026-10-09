import assert from "node:assert/strict";
import { test } from "node:test";
import { MIGRATIONS, runMigrations } from "../migrations.ts";
import { openDatabase } from "../storage.ts";
import { setupApp } from "../test-support.ts";

test("migration 004 sur une base existante : comptes gardés, thème « system » par défaut, valeur contrôlée (spec § 3.2)", () => {
  const db = openDatabase(":memory:");
  runMigrations(db, MIGRATIONS.filter((m) => m.id !== "004_theme"));
  db.exec("INSERT INTO accounts (display_name, login, role, password_hash, created_at, language) VALUES ('Dan', 'dan', 'admin', 'x', 0, 'en')");
  assert.deepEqual(runMigrations(db), ["004_theme"]);
  const row = db.prepare("SELECT login, language, theme FROM accounts").get() as { login: string; language: string; theme: string };
  assert.deepEqual({ ...row }, { login: "dan", language: "en", theme: "system" });
  assert.throws(() => db.exec("UPDATE accounts SET theme = 'sepia'"), /CHECK/);
  db.close();
});

test("l'état de connexion renvoie le thème du compte, « system » par défaut", async (t) => {
  const ctx = await setupApp(t);
  const call = await ctx.as("reception");
  assert.equal((await call("GET", "/api/auth/state")).body.account.theme, "system");
});

test("chacun change son propre thème, quel que soit son rôle, sans mot de passe ni journal (spec § 3.2)", async (t) => {
  const ctx = await setupApp(t);
  for (const [role, theme] of [["admin", "dark"], ["manager", "light"], ["reception", "dark"], ["practitioner", "system"]] as const) {
    const call = await ctx.as(role);
    const res = await call("PUT", "/api/auth/me/theme", { theme });
    assert.equal(res.status, 200, role);
    assert.equal(res.body.account.theme, theme, role);
    assert.equal((await call("GET", "/api/auth/state")).body.account.theme, theme, role);
  }
  const audit = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'compte.modification'").get() as { n: number };
  assert.equal(audit.n, 0);
});

test("un thème inconnu ou absent est refusé, message dans la langue de la requête", async (t) => {
  const ctx = await setupApp(t);
  const call = await ctx.as("reception");
  const refus = await call("PUT", "/api/auth/me/theme", { theme: "sepia" });
  assert.equal(refus.status, 400);
  assert.match(refus.body.error, /light, dark or system/);
  assert.equal((await call("PUT", "/api/auth/me/theme", {})).status, 400);
  assert.equal((await call("PUT", "/api/auth/me/theme", { theme: "DARK" })).status, 400);
  assert.equal((await call("GET", "/api/auth/state")).body.account.theme, "system");
});

test("sans session, le changement de thème est refusé", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("reception", "grace");
  assert.equal((await ctx.anonymous()("PUT", "/api/auth/me/theme", { theme: "dark" })).status, 401);
});

test("la gérante choisit le thème d'un compte de son équipe, jamais celui de l'administrateur ; le changement est journalisé", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace");
  const admin = await ctx.seedAccount("admin", "dan");
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("POST", "/api/auth/confirm", { password: "mot-de-passe-test" })).status, 200);
  assert.equal((await gerante("PUT", `/api/accounts/${grace.id}`, { theme: "dark" })).status, 200);
  assert.equal((ctx.db.prepare("SELECT theme FROM accounts WHERE id = ?").get(grace.id) as { theme: string }).theme, "dark");
  assert.equal((await gerante("PUT", `/api/accounts/${grace.id}`, { theme: "sepia" })).status, 400);
  assert.equal((await gerante("PUT", `/api/accounts/${admin.id}`, { theme: "dark" })).status, 403);
  const audit = ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'compte.modification' AND target = 'grace'").get() as { n: number };
  assert.equal(audit.n, 1);
});
