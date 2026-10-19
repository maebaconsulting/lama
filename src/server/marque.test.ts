import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

/**
 * Affichage de la marque à l'écran (renommage lama, § 1) : « logo et nom »
 * (défaut) ou « logo seul », réglé par la gérante. L'écran de connexion le lit
 * avant toute session dans l'état public, qui n'expose aucun autre réglage.
 */

test("marque.ecran : « logo_nom » par défaut, lu sans session dans l'état public, réglages exposés limités à la marque", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const anon = ctx.anonymous();
  assert.deepEqual((await anon("GET", "/api/auth/state")).body.marque, { ecran: "logo_nom", nom: "", logos: { clair: null, sombre: null } });
  const gerante = await ctx.as("manager");
  for (const [key, value] of [["marque.ecran", "logo"], ["institut.nom", "Institut Akwa"], ["institut.telephone", "+237 699 00 00 00"]] as const) {
    assert.equal((await gerante("PUT", `/api/settings/${key}`, { value })).status, 200, key);
  }
  const state = (await anon("GET", "/api/auth/state")).body;
  assert.deepEqual(state.marque, { ecran: "logo", nom: "Institut Akwa", logos: { clair: null, sombre: null } });
  assert.deepEqual(Object.keys(state).sort(), ["account", "crm", "demo", "device", "devise", "formation", "installed", "marque", "session"]);
  assert.equal(state.crm, null, "interrupteur du mini CRM : seulement une fois connecté");
  assert.doesNotMatch(JSON.stringify(state), /699/, "aucun autre réglage dans l'état public (le nom de l'institut et les versions des logos s'y ajoutent en vague B)");
});

test("marque.ecran : la gérante seule, « logo_nom » ou « logo » seulement, refus traduit", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const gerante = await ctx.as("manager");
  const refus = await gerante("PUT", "/api/settings/marque.ecran", { value: "nom" }, { "Accept-Language": "fr" });
  assert.equal(refus.status, 400);
  assert.equal(refus.body.error, "Choix inconnu pour l'affichage de la marque.");
  assert.equal((await gerante("PUT", "/api/settings/marque.ecran", { value: "logo_nom" })).status, 200);
  for (const role of ["reception", "practitioner", "admin"] as const) {
    assert.equal((await (await ctx.as(role))("PUT", "/api/settings/marque.ecran", { value: "logo" })).status, 403, role);
  }
  const keys = (await gerante("GET", "/api/settings")).body.settings.map((s: { key: string }) => s.key);
  assert.ok(keys.includes("marque.ecran"));
  assert.ok(keys.includes("marque.documents"));
});
