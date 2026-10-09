import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

test("sans compte, l'API exige l'installation ; l'installation crée l'administrateur une seule fois", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const anon = ctx.anonymous();
  assert.deepEqual((await anon("GET", "/api/auth/state")).body, { installed: false, account: null, device: null, session: null, marque: { ecran: "logo_nom", nom: "", logos: { clair: null, sombre: null } }, crm: null, formation: false, demo: null });
  const blocked = await anon("GET", "/api/stats");
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, "installation");
  const install = await anon("POST", "/api/auth/install", { display_name: "Dan", login: "dan", password: "assez-long-1" });
  assert.equal(install.status, 201);
  assert.equal(install.body.account.role, "admin");
  assert.equal((await anon("GET", "/api/auth/me")).body.account.login, "dan", "connecté après installation");
  assert.equal((await ctx.anonymous()("POST", "/api/auth/install", { display_name: "Bis", login: "bis", password: "assez-long-1" })).status, 409);
});

test("connexion, cookie protégé, déconnexion", async (t) => {
  const ctx = await setupApp(t);
  const { login, password } = await ctx.seedAccount("manager", "aicha");
  const anon = ctx.anonymous();
  assert.equal((await anon("GET", "/api/stats")).status, 401);
  const res = await anon("POST", "/api/auth/login", { login, password });
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("lama_session="))!;
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, /Path=\//);
  assert.equal((await anon("GET", "/api/stats")).status, 200);
  assert.equal((await anon("POST", "/api/auth/logout")).status, 200);
  assert.equal((await anon("GET", "/api/stats")).status, 401);
});

test("mauvais mot de passe, blocage et message clair", async (t) => {
  const ctx = await setupApp(t);
  const { login } = await ctx.seedAccount("reception", "grace");
  const anon = ctx.anonymous();
  const wrong = await anon("POST", "/api/auth/login", { login, password: "pas-le-bon-1" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "Incorrect username or password.");
  for (let i = 0; i < 4; i++) await anon("POST", "/api/auth/login", { login, password: "pas-le-bon-1" });
  const locked = await anon("POST", "/api/auth/login", { login, password: "pas-le-bon-1" });
  assert.equal(locked.status, 423);
  assert.match(locked.body.error, /Account locked until \d{2}:\d{2}/);
  assert.ok(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connexion.blocage'").get());
});

test("une modification sans l'en-tête X-Lama est refusée", async (t) => {
  const ctx = await setupApp(t);
  const call = await ctx.as("manager");
  const forged = await call("POST", "/api/clients", { name: "Intruse" }, { "X-Lama": "" });
  assert.equal(forged.status, 403);
  assert.match(forged.body.error, /X-Lama/);
  assert.equal((await call("POST", "/api/clients", { name: "Aïcha" })).status, 201);
});

test("confirmation par mot de passe", async (t) => {
  const ctx = await setupApp(t);
  const { password } = await ctx.seedAccount("admin", "dan");
  const call = await ctx.as("admin");
  assert.equal((await call("POST", "/api/auth/confirm", { password: "faux-faux-faux" })).status, 401);
  const ok = await call("POST", "/api/auth/confirm", { password });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.confirmed_until, ctx.clock.now + 5 * 60_000);
});

test("l'administrateur n'accède pas à l'activité", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.as("admin");
  assert.equal((await admin("GET", "/api/clients")).status, 403);
  assert.equal((await admin("GET", "/api/stats")).status, 403);
});

test("la session personnelle glisse : une requête authentifiée plus tard réémet le cookie avec 14 jours pleins", async (t) => {
  const ctx = await setupApp(t);
  const { login, password } = await ctx.seedAccount("manager", "fatima");
  const anon = ctx.anonymous();
  assert.equal((await anon("POST", "/api/auth/login", { login, password })).status, 200);
  ctx.clock.now += 10 * 24 * 60 * 60_000;
  const later = await anon("GET", "/api/auth/me");
  assert.equal(later.status, 200);
  const cookie = later.headers.getSetCookie().find((c) => c.startsWith("lama_session="))!;
  assert.match(cookie, /Max-Age=1209600/);
});

test("essais parallèles : le compteur d'échecs est atomique, au plus 5 essais évalués", async (t) => {
  const ctx = await setupApp(t);
  const { login } = await ctx.seedAccount("reception", "grace");
  const replies = await Promise.all(Array.from({ length: 40 }, () => ctx.anonymous()("POST", "/api/auth/login", { login, password: "pas-le-bon-1" })));
  const evaluated = replies.filter((r) => r.status === 401).length;
  assert.ok(evaluated <= 5, `${evaluated} essais évalués sur 40`);
  assert.ok(replies.every((r) => r.status === 401 || r.status === 423));
});

test("identifiant inconnu : même blocage et même réponse qu'un identifiant connu", async (t) => {
  const ctx = await setupApp(t);
  const { login } = await ctx.seedAccount("reception", "grace");
  const anon = ctx.anonymous();
  const known: number[] = [];
  const unknown: number[] = [];
  for (let i = 0; i < 6; i++) {
    known.push((await anon("POST", "/api/auth/login", { login, password: "pas-le-bon-1" })).status);
    unknown.push((await anon("POST", "/api/auth/login", { login: "fantome", password: "pas-le-bon-1" })).status);
  }
  assert.deepEqual(unknown, known);
  assert.deepEqual(unknown, [401, 401, 401, 401, 423, 423]);
  const a = await anon("POST", "/api/auth/login", { login, password: "pas-le-bon-1" });
  const b = await anon("POST", "/api/auth/login", { login: "FANTOME", password: "pas-le-bon-1" });
  assert.deepEqual(Object.keys(b.body).sort(), Object.keys(a.body).sort());
  assert.equal(b.body.error, a.body.error);
  ctx.clock.now += 5 * 60_000 + 1;
  assert.equal((await anon("POST", "/api/auth/login", { login: "fantome", password: "pas-le-bon-1" })).status, 401, "débloqué après 5 minutes");
});

test("un corps de requête trop gros est refusé (413) sans rien inscrire au journal", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("manager", "aicha");
  const before = (ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n;
  const res = await ctx.anonymous()("POST", "/api/auth/login", { login: "L".repeat(200_000), password: "x" });
  assert.equal(res.status, 413);
  assert.equal(res.body.error, "Request too large.");
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get() as { n: number }).n, before);
});

test("journal : un mot de passe tapé dans le champ identifiant n'est jamais inscrit, la cible est bornée", async (t) => {
  const ctx = await setupApp(t);
  const { login } = await ctx.seedAccount("manager", "aicha");
  const anon = ctx.anonymous();
  await anon("POST", "/api/auth/login", { login: "Mon mot de passe!", password: "x" });
  await anon("POST", "/api/auth/login", { login: "Bonapriso2026", password: "x" });
  await anon("POST", "/api/auth/login", { login, password: "x" });
  const targets = (ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'connexion.echec' ORDER BY id").all() as { target: string }[]).map((r) => r.target);
  assert.deepEqual(targets, ["(identifiant inconnu)", "(identifiant inconnu)", login]);
  const call = await ctx.as("manager");
  await call("POST", "/api/devices", { name: "P".repeat(500) });
  const device = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'poste.declaration'").get() as { target: string };
  assert.ok(device.target.length <= 64, `cible de ${device.target.length} caractères`);
});

test("installation : deux demandes simultanées ne créent qu'un seul administrateur", async (t) => {
  const ctx = await setupApp(t);
  const [a, b] = await Promise.all([
    ctx.anonymous()("POST", "/api/auth/install", { display_name: "Dan", login: "dan", password: "assez-long-1" }),
    ctx.anonymous()("POST", "/api/auth/install", { display_name: "Intrus", login: "intrus", password: "assez-long-1" }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 1);
});

test("la description de l'API (/api/openapi.json) exige une session", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("manager", "aicha");
  assert.equal((await ctx.anonymous()("GET", "/api/openapi.json")).status, 401);
  const call = await ctx.as("manager");
  const res = await call("GET", "/api/openapi.json");
  assert.equal(res.status, 200);
  assert.ok(res.body.paths);
});

test("l'état de session indique le type et, pour un poste, le délai de verrouillage", async (t) => {
  const ctx = await setupApp(t);
  const anon = ctx.anonymous();
  assert.equal((await anon("GET", "/api/auth/state")).body.session, null);
  const manager = await ctx.as("manager");
  assert.deepEqual((await manager("GET", "/api/auth/state")).body.session, { kind: "personnel", idle_ms: null });
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  assert.equal((await manager("POST", "/api/devices", { name: "Tablette réception" })).status, 201);
  await manager("POST", "/api/auth/logout");
  assert.equal((await manager("POST", "/api/auth/pin", { account_id: grace.id, pin: "2580" })).status, 200);
  assert.deepEqual((await manager("GET", "/api/auth/state")).body.session, { kind: "poste", idle_ms: 5 * 60_000 });
});
