import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/**
 * Numéro de carte (mini CRM § 5) : saisi par la réception ou la gérante,
 * enregistré sans espaces ni tirets et en majuscules, unique, trouvé par la
 * recherche de la liste et rendu à la recherche de cliente de la caisse.
 */

const FR = { "Accept-Language": "fr" };

test("numéro de carte : nettoyé, contrôlé, unique, retiré par une valeur vide ; la praticienne ne le change pas", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("reception");
  const aicha = await g("POST", "/api/clients", { name: "Aïcha", card: " ab-12 34 " });
  assert.equal(aicha.status, 201, JSON.stringify(aicha.body));
  assert.equal(aicha.body.client.card, "AB1234");
  const brenda = (await g("POST", "/api/clients", { name: "Brenda" })).body.client.id as number;

  const pris = await g("PUT", `/api/clients/${brenda}`, { card: "AB 1234" }, FR);
  assert.equal(pris.status, 409);
  assert.equal(pris.body.error, "Ce numéro de carte est déjà celui d'une autre cliente.");
  const doublon = await g("POST", "/api/clients", { name: "Ngozi", card: "ab1234" }, FR);
  assert.equal(doublon.status, 409);
  for (const card of ["A1", "x".repeat(33), "AB12é", 1234]) {
    const res = await g("PUT", `/api/clients/${brenda}`, { card }, FR);
    assert.equal(res.status, 400, String(card));
    assert.equal(res.body.error, "Le numéro de carte compte 4 à 32 lettres ou chiffres.");
  }
  assert.equal((await g("PUT", `/api/clients/${aicha.body.client.id}`, { card: "AB1234" })).status, 200, "son propre numéro");
  assert.equal((await g("PUT", `/api/clients/${brenda}`, { card: "cd5678" })).status, 200);
  assert.equal((await g("PUT", `/api/clients/${brenda}`, { card: "" })).status, 200);
  assert.equal(ctx.db.prepare("SELECT card FROM clients WHERE id = ?").get(brenda)!.card, null, "valeur vide : numéro retiré");

  const praticienne = await ctx.as("practitioner");
  await praticienne("PUT", `/api/clients/${brenda}`, { card: "EF9999" });
  assert.equal(ctx.db.prepare("SELECT card FROM clients WHERE id = ?").get(brenda)!.card, null);
});

test("numéro de carte trouvé par la recherche de la liste (espaces et tirets ignorés) et rendu à la caisse", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("POST", "/api/clients", { name: "Aïcha", card: "LAM00042" });
  await g("POST", "/api/clients", { name: "Brenda" });
  for (const [search, total] of [["LAM00042", 1], ["lam-000 42", 1], ["00042", 1], ["LAM9", 0]] as const) {
    assert.equal((await g("GET", `/api/clients?search=${encodeURIComponent(search)}`)).body.total, total, search);
  }
  const all = (await g("GET", "/api/clients/all")).body.clients;
  assert.deepEqual(all, [{ id: all[0].id, name: "Aïcha", card: "LAM00042" }, { id: all[1].id, name: "Brenda", card: null }]);
});
