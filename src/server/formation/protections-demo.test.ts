import assert from "node:assert/strict";
import { test } from "node:test";
import { avecDemoPublique, setupApp, type Caller, type TestApp } from "../test-support.ts";
import { OpenAPIHono } from "@hono/zod-openapi";
import { mountAccountRoutes } from "../auth/accounts-routes.ts";
import { fichierRefuse } from "./protections-demo.ts";

/** Démonstration publique (démo publique DP-06) : comptes publics figés, jamais bloqués, aucun fichier reçu ; rien de tout cela ailleurs. */

/** Connecte `login` (créé avec le rôle donné et le mot de passe des essais) dans un pot à cookies. */
async function connecte(ctx: TestApp, role: Parameters<TestApp["seedAccount"]>[0], login: string): Promise<{ appel: Caller; id: number; password: string }> {
  const { id, password } = await ctx.seedAccount(role, login, role === "practitioner" ? { staff_id: 1 } : {});
  const appel = ctx.anonymous();
  assert.equal((await appel("POST", "/api/auth/login", { login, password })).status, 200, login);
  return { appel, id, password };
}

test("son propre mot de passe et son PIN : refusés (409) pour un compte public, permis pour un autre compte ; langue et thème toujours permis", async (t) => {
  await avecDemoPublique(true, async () => {
    const ctx = await setupApp(t, { demo: true });
    const { appel, password } = await connecte(ctx, "manager", "gerante");
    for (const corps of [{ current_password: password, password: "nouveau-mot-1" }, { current_password: password, pin: "8642" }]) {
      const refus = await appel("PUT", "/api/auth/me", corps, { "accept-language": "fr" });
      assert.equal(refus.status, 409);
      assert.equal(refus.body.code, "demo");
      assert.equal(refus.body.error, "Compte de démonstration\u00a0: son mot de passe, son code PIN et sa fiche ne se changent pas.");
    }
    assert.equal((await appel("PUT", "/api/auth/me/language", { language: "en" })).status, 200);
    assert.equal((await appel("PUT", "/api/auth/me/theme", { theme: "dark" })).status, 200);
    const autre = await connecte(ctx, "manager", "autre.gerante");
    assert.equal((await autre.appel("PUT", "/api/auth/me", { current_password: autre.password, password: "nouveau-mot-1" })).status, 200, "compte créé en séance : rien de figé");
  });
  await avecDemoPublique(false, async () => {
    const ctx = await setupApp(t, { demo: true });
    const { appel, password } = await connecte(ctx, "manager", "gerante");
    assert.equal((await appel("PUT", "/api/auth/me", { current_password: password, password: "nouveau-mot-1" })).status, 200, "hors démonstration publique, rien de figé");
  });
});

test("fiche d'un compte public : modification refusée (409) à la gérante comme à l'administration ; un compte créé en séance se modifie", async (t) => {
  await avecDemoPublique(true, async () => {
    const ctx = await setupApp(t, { demo: true });
    const reception = await ctx.seedAccount("reception", "reception");
    const visiteuse = await ctx.seedAccount("reception", "visiteuse");
    for (const [role, login] of [["manager", "gerante"], ["admin", "administration"]] as const) {
      const { appel, password } = await connecte(ctx, role, login);
      assert.equal((await appel("POST", "/api/auth/confirm", { password })).status, 200);
      for (const corps of [{ active: false }, { password: "nouveau-mot-1" }, { pin: "8642" }, { display_name: "Autre" }]) {
        const refus = await appel("PUT", `/api/accounts/${reception.id}`, corps);
        assert.equal(refus.status, 409, `${login} ${JSON.stringify(corps)}`);
        assert.equal(refus.body.code, "demo");
      }
      assert.equal((await appel("PUT", `/api/accounts/${visiteuse.id}`, { display_name: `Visiteuse ${login}` })).status, 200);
    }
    const ligne = ctx.db.prepare("SELECT active, display_name FROM accounts WHERE id = ?").get(reception.id) as { active: number; display_name: string };
    assert.deepEqual({ ...ligne }, { active: 1, display_name: "reception" });
  });
});

test("envoi de fichiers refusé (409) : logo de l'institut et photo de produit, dépôt comme retrait ; hors démonstration publique, la route juge le fichier", async (t) => {
  assert.equal(fichierRefuse("PUT", "/api/institut/logos/clair"), true);
  assert.equal(fichierRefuse("GET", "/api/institut/logos/clair"), false, "la lecture reste permise");
  assert.equal(fichierRefuse("GET", "/api/products/1/image"), false);
  const pasUneImage = Buffer.from("pas une image");
  await avecDemoPublique(true, async () => {
    const ctx = await setupApp(t, { demo: true });
    const { appel } = await connecte(ctx, "manager", "gerante");
    for (const [methode, chemin] of [["PUT", "/api/institut/logos/clair"], ["DELETE", "/api/institut/logos/sombre"], ["PUT", "/api/products/1/image"], ["DELETE", "/api/products/1/image"], ["PUT", "/api/products/%31/image"]] as const) {
      const refus = await appel(methode, chemin, methode === "PUT" ? pasUneImage : undefined, { "accept-language": "fr" });
      assert.equal(refus.status, 409, `${methode} ${chemin}`);
      assert.equal(refus.body.error, "Démonstration\u00a0: l'envoi de fichiers est coupé (logo, photos des produits).");
    }
  });
  await avecDemoPublique(false, async () => {
    const ctx = await setupApp(t, { demo: true });
    const { appel } = await connecte(ctx, "manager", "gerante");
    assert.equal((await appel("PUT", "/api/institut/logos/clair", pasUneImage)).status, 400, "fichier jugé par la route");
  });
});

test("compte public jamais bloqué par des mots de passe faux ; l'administration de la démonstration se bloque comme tout compte", async (t) => {
  await avecDemoPublique(true, async () => {
    const ctx = await setupApp(t, { demo: true });
    const gerante = await ctx.seedAccount("manager", "gerante");
    const admin = await ctx.seedAccount("admin", "administration");
    for (let i = 0; i < 7; i++) assert.equal((await ctx.raw("POST", "/api/auth/login", { login: "gerante", password: "faux-mot-de-passe" }, { "X-Lama": "1" })).status, 401);
    assert.equal((await ctx.raw("POST", "/api/auth/login", { login: "gerante", password: gerante.password }, { "X-Lama": "1" })).status, 200);
    for (let i = 0; i < 4; i++) assert.equal((await ctx.raw("POST", "/api/auth/login", { login: "administration", password: "faux-mot-de-passe" }, { "X-Lama": "1" })).status, 401);
    assert.equal((await ctx.raw("POST", "/api/auth/login", { login: "administration", password: "faux-mot-de-passe" }, { "X-Lama": "1" })).status, 423);
    assert.equal((await ctx.raw("POST", "/api/auth/login", { login: "administration", password: admin.password }, { "X-Lama": "1" })).status, 423, "bloquée malgré le bon mot de passe");
  });
});

test("identifiant encodé (%2B, %20, +) : jamais 200 sur un compte public, fiche inchangée ; le contrôle est aussi dans la route ; hors démonstration publique, un compte normal se modifie", async (t) => {
  await avecDemoPublique(true, async () => {
    const ctx = await setupApp(t, { demo: true });
    const reception = await ctx.seedAccount("reception", "reception");
    const { appel, password } = await connecte(ctx, "manager", "gerante");
    assert.equal((await appel("POST", "/api/auth/confirm", { password })).status, 200);
    const avant = ctx.db.prepare("SELECT active, password_hash, pin_hash FROM accounts WHERE id = ?").get(reception.id);
    for (const chemin of [`%2B${reception.id}`, `%20${reception.id}`, `+${reception.id}`]) {
      const reponse = await appel("PUT", `/api/accounts/${chemin}`, { active: false, password: "nouveau-mot-1" });
      assert.notEqual(reponse.status, 200, chemin);
      assert.ok([404, 409].includes(reponse.status), `${chemin} : ${reponse.status}`);
      const deblocage = await appel("POST", `/api/accounts/${chemin}/unlock`);
      assert.equal(deblocage.status, 404, `unlock ${chemin}`);
    }
    assert.deepEqual({ ...(ctx.db.prepare("SELECT active, password_hash, pin_hash FROM accounts WHERE id = ?").get(reception.id) as object) }, { ...(avant as object) }, "fiche de la réception inchangée");
    const direct = await appel("PUT", `/api/accounts/${reception.id}`, { active: false });
    assert.equal(direct.status, 409);
    assert.equal(direct.body.code, "demo");
  });
  await avecDemoPublique(false, async () => {
    const ctx = await setupApp(t, { demo: true });
    const normale = await ctx.seedAccount("reception", "reception");
    const { appel, password } = await connecte(ctx, "manager", "gerante");
    assert.equal((await appel("POST", "/api/auth/confirm", { password })).status, 200);
    assert.equal((await appel("PUT", `/api/accounts/${normale.id}`, { display_name: "Autre" })).status, 200, "pas de régression hors démonstration publique");
  });
});

test("son propre mot de passe : la route PUT /api/auth/me refuse elle-même (409) un compte public, sans l'intermédiaire de la démonstration (le cas permis est essayé plus haut)", async (t) => {
  const ctx = await setupApp(t, { demo: true });
  const { password } = await ctx.seedAccount("manager", "gerante");
  const compte = ctx.db.prepare("SELECT * FROM accounts WHERE login = 'gerante'").get();
  // Application nue : seules les routes des comptes, le compte posé dans le contexte, aucune protection de la démonstration.
  const nue = new OpenAPIHono();
  nue.use("*", async (c, next) => {
    c.set("account" as never, { ...(compte as object) } as never);
    await next();
  });
  mountAccountRoutes(nue);
  const changer = () => nue.request("/api/auth/me", { method: "PUT", headers: { "content-type": "application/json", "accept-language": "fr" }, body: JSON.stringify({ current_password: password, password: "nouveau-mot-1" }) });
  const empreinteMdp = () => (ctx.db.prepare("SELECT password_hash FROM accounts WHERE login = 'gerante'").get() as { password_hash: string }).password_hash;
  const avant = empreinteMdp();
  await avecDemoPublique(true, async () => {
    const refus = await changer();
    assert.equal(refus.status, 409);
    assert.equal(((await refus.json()) as { code: string }).code, "demo");
  });
  assert.equal(empreinteMdp(), avant, "mot de passe inchangé");
});
