import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

async function declarePoste(ctx: Awaited<ReturnType<typeof setupApp>>) {
  const manager = await ctx.as("manager");
  const res = await manager("POST", "/api/devices", { name: "Tablette réception" });
  assert.equal(res.status, 201);
  return manager;
}

test("un poste déclaré liste l'équipe (sans administrateur) et connecte par PIN", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("admin", "dan", { pin: "2580" });
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  await ctx.seedAccount("reception", "sanspin");
  const poste = await declarePoste(ctx);
  await poste("POST", "/api/auth/logout");
  const roster = await poste("GET", "/api/auth/roster");
  assert.equal(roster.status, 200);
  const names = roster.body.accounts.map((a: { display_name: string }) => a.display_name);
  assert.ok(names.includes("grace"));
  assert.ok(!names.includes("dan"), "pas d'administrateur sur un poste");
  assert.ok(!names.includes("sanspin"), "pas de compte sans PIN");
  assert.equal((await poste("POST", "/api/auth/pin", { account_id: grace.id, pin: "9999" })).status, 401);
  const ok = await poste("POST", "/api/auth/pin", { account_id: grace.id, pin: "2580" });
  assert.equal(ok.status, 200);
  assert.equal((await poste("GET", "/api/auth/me")).body.session.kind, "poste");
});

test("sans cookie de poste, pas de liste ni de PIN", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  const anon = ctx.anonymous();
  assert.equal((await anon("GET", "/api/auth/roster")).status, 401);
  assert.equal((await anon("POST", "/api/auth/pin", { account_id: grace.id, pin: "2580" })).status, 401);
});

test("le poste se verrouille après 5 minutes sans activité", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  const poste = await declarePoste(ctx);
  await poste("POST", "/api/auth/pin", { account_id: grace.id, pin: "2580" });
  ctx.clock.now += 4 * 60_000;
  assert.equal((await poste("GET", "/api/stats")).status, 200);
  ctx.clock.now += 5 * 60_000 + 1;
  const locked = await poste("GET", "/api/stats");
  assert.equal(locked.status, 401);
  assert.equal(locked.body.code, "verrouille");
});

function deviceCookieOf(headers: Headers): string | undefined {
  return headers.getSetCookie().find((line) => line.startsWith("lama_poste="))?.split(";")[0];
}

test("une connexion PIN réémet le cookie de poste avec le même jeton", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  const manager = await ctx.as("manager");
  const declared = await manager("POST", "/api/devices", { name: "Tablette réception" });
  assert.equal(declared.status, 201);
  const posed = deviceCookieOf(declared.headers);
  assert.ok(posed, "le cookie de poste est posé à la déclaration");
  await manager("POST", "/api/auth/logout");
  const pinRes = await manager("POST", "/api/auth/pin", { account_id: grace.id, pin: "2580" });
  assert.equal(pinRes.status, 200);
  const reissued = deviceCookieOf(pinRes.headers);
  assert.ok(reissued, "le cookie de poste est réémis à la connexion PIN");
  assert.equal(reissued, posed);
});

test("révoquer un poste coupe la session en cours", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  const poste = await declarePoste(ctx);
  const deviceId = (ctx.db.prepare("SELECT id FROM devices").get() as { id: number }).id;
  await poste("POST", "/api/auth/pin", { account_id: grace.id, pin: "2580" });
  const admin = await ctx.as("admin");
  assert.equal((await admin("DELETE", `/api/devices/${deviceId}`)).status, 200);
  assert.equal((await poste("GET", "/api/stats")).status, 401);
  assert.equal((await poste("GET", "/api/auth/roster")).status, 401);
});

test("PIN sur un compte inexistant ou administrateur : même 401 que pour un mauvais PIN, journal sans numéro inexistant", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.seedAccount("admin", "dan", { pin: "2580" });
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  const poste = await declarePoste(ctx);
  await poste("POST", "/api/auth/logout");
  const wrong = await poste("POST", "/api/auth/pin", { account_id: grace.id, pin: "9731" });
  const missing = await poste("POST", "/api/auth/pin", { account_id: 999, pin: "9731" });
  const text = await poste("POST", "/api/auth/pin", { account_id: "abc", pin: "9731" });
  const adminRight = await poste("POST", "/api/auth/pin", { account_id: admin.id, pin: "2580" });
  for (const r of [wrong, missing, text, adminRight]) {
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, wrong.body);
  }
  const rows = ctx.db.prepare("SELECT account_id, target FROM audit_log WHERE action = 'connexion.echec' ORDER BY id").all() as { account_id: number | null; target: string }[];
  assert.equal(rows.length, 4);
  assert.equal(rows[0].account_id, grace.id);
  assert.equal(rows[1].account_id, null);
  assert.equal(rows[1].target, "999");
  assert.equal(rows[3].account_id, null, "l'administrateur est traité comme un inconnu");
});

test("cinq PIN faux sur l'administrateur ne bloquent pas son compte", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.seedAccount("admin", "dan", { pin: "2580" });
  const poste = await declarePoste(ctx);
  await poste("POST", "/api/auth/logout");
  for (let i = 0; i < 5; i++) await poste("POST", "/api/auth/pin", { account_id: admin.id, pin: "9731" });
  const row = ctx.db.prepare("SELECT failed_attempts, locked_until FROM accounts WHERE id = ?").get(admin.id) as { failed_attempts: number; locked_until: number | null };
  assert.equal(row.failed_attempts, 0);
  assert.equal(row.locked_until, null);
  const login = await ctx.anonymous()("POST", "/api/auth/login", { login: "dan", password: admin.password });
  assert.equal(login.status, 200);
});

test("« Qui êtes-vous ? » : un compte bloqué porte locked: true, redevient normal après déblocage (V1-07)", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace", { pin: "2580" });
  await ctx.seedAccount("reception", "ngozi", { pin: "1357" });
  const poste = await declarePoste(ctx);
  await poste("POST", "/api/auth/logout");
  const lockedOf = async (name: string) =>
    ((await poste("GET", "/api/auth/roster")).body.accounts as { display_name: string; locked: boolean }[]).find((a) => a.display_name === name)!.locked;
  assert.equal(await lockedOf("grace"), false);
  for (let i = 0; i < 5; i++) await poste("POST", "/api/auth/pin", { account_id: grace.id, pin: "9731" });
  const roster = await poste("GET", "/api/auth/roster");
  const carte = roster.body.accounts.find((a: { display_name: string }) => a.display_name === "grace");
  assert.equal(carte.locked, true);
  assert.equal("locked_until" in carte, false, "l'échéance du blocage ne sort pas");
  assert.equal(await lockedOf("ngozi"), false, "les autres comptes restent ouverts");
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("POST", `/api/accounts/${grace.id}/unlock`)).status, 200);
  assert.equal(await lockedOf("grace"), false);
});
