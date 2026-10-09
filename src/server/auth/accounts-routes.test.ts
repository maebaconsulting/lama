import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

async function confirmed(ctx: Awaited<ReturnType<typeof setupApp>>, role: "admin" | "manager") {
  const call = await ctx.as(role);
  assert.equal((await call("POST", "/api/auth/confirm", { password: "mot-de-passe-test" })).status, 200);
  return call;
}

test("la création exige la confirmation ; la gérante ne crée que son équipe", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const nouvelle = { display_name: "Grace", login: "grace", role: "reception", password: "assez-long-1", pin: "2580" };
  assert.equal((await gerante("POST", "/api/accounts", nouvelle)).body.code, "confirmation");
  const g = await confirmed(ctx, "manager");
  assert.equal((await g("POST", "/api/accounts", nouvelle)).status, 201);
  assert.equal((await g("POST", "/api/accounts", { ...nouvelle, login: "chef", role: "manager" })).status, 403);
  const admin = await confirmed(ctx, "admin");
  assert.equal((await admin("POST", "/api/accounts", { ...nouvelle, login: "chef", role: "manager" })).status, 201);
});

test("la gérante ne voit pas l'administrateur", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("admin", "dan");
  const list = await (await ctx.as("manager"))("GET", "/api/accounts");
  assert.ok(!list.body.accounts.some((a: { role: string }) => a.role === "admin"));
});

test("désactiver ferme toutes les sessions, y compris sur un deuxième appareil", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace");
  const appareil1 = ctx.anonymous();
  const appareil2 = ctx.anonymous();
  await appareil1("POST", "/api/auth/login", { login: grace.login, password: grace.password });
  await appareil2("POST", "/api/auth/login", { login: grace.login, password: grace.password });
  await appareil1("POST", "/api/auth/logout");
  assert.equal((await appareil2("GET", "/api/stats")).status, 200, "l'autre appareil reste connecté");
  const g = await confirmed(ctx, "manager");
  assert.equal((await g("PUT", `/api/accounts/${grace.id}`, { active: 0 })).status, 200);
  assert.equal((await appareil2("GET", "/api/stats")).status, 401);
});

test("déblocage sans confirmation ; changement de son propre mot de passe", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace");
  for (let i = 0; i < 5; i++) await ctx.anonymous()("POST", "/api/auth/login", { login: "grace", password: "pas-le-bon-1" });
  const gerante = await ctx.as("manager");
  assert.equal((await gerante("POST", `/api/accounts/${grace.id}/unlock`)).status, 200);
  const moi = ctx.anonymous();
  assert.equal((await moi("POST", "/api/auth/login", { login: "grace", password: grace.password })).status, 200);
  assert.equal((await moi("PUT", "/api/auth/me", { current_password: "faux-faux-faux", password: "nouveau-secret-1" })).status, 401);
  assert.equal((await moi("PUT", "/api/auth/me", { current_password: grace.password, password: "nouveau-secret-1", pin: "7391" })).status, 200);
  assert.equal((await ctx.anonymous()("POST", "/api/auth/login", { login: "grace", password: "nouveau-secret-1" })).status, 200);
});

test("journal consultable par la gérante et l'administrateur", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const res = await gerante("GET", "/api/audit");
  assert.equal(res.status, 200);
  assert.ok(res.body.entries.some((e: { action: string }) => e.action === "connexion"));
  assert.equal((await (await ctx.as("reception"))("GET", "/api/audit")).status, 403);
});

test("une modification refusée n'écrit rien en base", async (t) => {
  const ctx = await setupApp(t);
  const grace = await ctx.seedAccount("reception", "grace");
  const aya = await ctx.seedAccount("practitioner", "aya");
  const g = await confirmed(ctx, "manager");
  const read = (id: number) => ctx.db.prepare("SELECT display_name, role, staff_id FROM accounts WHERE id = ?").get(id);
  const graceBefore = read(grace.id);
  const toPractitioner = await g("PUT", `/api/accounts/${grace.id}`, { display_name: "Grace B", role: "practitioner" });
  assert.equal(toPractitioner.status, 400);
  assert.match(toPractitioner.body.error, /staff record/);
  assert.deepEqual(read(grace.id), graceBefore);
  const ayaBefore = read(aya.id);
  assert.equal((await g("PUT", `/api/accounts/${aya.id}`, { staff_id: null })).status, 400);
  assert.deepEqual(read(aya.id), ayaBefore);
  const unknownStaff = await g("PUT", `/api/accounts/${aya.id}`, { staff_id: 4242 });
  assert.equal(unknownStaff.status, 400);
  assert.equal(unknownStaff.body.error, "Staff record not found.");
  assert.deepEqual(read(aya.id), ayaBefore);
});

test("praticienne dont la fiche a été supprimée reste gérable", async (t) => {
  const ctx = await setupApp(t);
  const aya = await ctx.seedAccount("practitioner", "aya");
  const staffId = (ctx.db.prepare("SELECT staff_id FROM accounts WHERE id = ?").get(aya.id) as { staff_id: number }).staff_id;
  const g = await confirmed(ctx, "manager");
  // Depuis la vague 4 du sous-projet 4, l'écran ne peut plus supprimer une fiche reliée à un compte (409) ;
  // une base plus ancienne peut encore contenir ce cas : la fiche est retirée directement dans la base.
  assert.equal((await g("DELETE", `/api/staff/${staffId}`)).status, 409);
  ctx.db.prepare("DELETE FROM staff WHERE id = ?").run(staffId);
  assert.equal((ctx.db.prepare("SELECT staff_id FROM accounts WHERE id = ?").get(aya.id) as { staff_id: number | null }).staff_id, null);
  // Réinitialisation du mot de passe par la gérante : ne touche ni au rôle ni à la fiche.
  const reset = await g("PUT", `/api/accounts/${aya.id}`, { password: "nouveau-mdp-aya-1" });
  assert.equal(reset.status, 200);
  // La praticienne peut changer ses propres mot de passe et PIN.
  const moi = ctx.anonymous();
  assert.equal((await moi("POST", "/api/auth/login", { login: "aya", password: "nouveau-mdp-aya-1" })).status, 200);
  assert.equal((await moi("PUT", "/api/auth/me", { current_password: "nouveau-mdp-aya-1", password: "encore-un-mdp-1", pin: "7391" })).status, 200);
  // La gérante peut toujours la désactiver.
  assert.equal((await g("PUT", `/api/accounts/${aya.id}`, { active: 0 })).status, 200);
  // Mais reconnecter le rôle de praticienne à une fiche reste impossible sans fiche.
  const other = await ctx.seedAccount("reception", "greta");
  const refused = await g("PUT", `/api/accounts/${other.id}`, { role: "practitioner" });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /staff record/);
});

test("créer un compte relié à une fiche inexistante : 400 lisible", async (t) => {
  const ctx = await setupApp(t);
  const g = await confirmed(ctx, "manager");
  const r = await g("POST", "/api/accounts", { display_name: "Aya", login: "aya", role: "practitioner", password: "assez-long-1", staff_id: 4242 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Staff record not found.");
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE login = 'aya'").get()!.n, 0);
});
