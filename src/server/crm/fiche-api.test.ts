import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/**
 * Routes clientes du mini CRM (spec du 04/10/2026, § 1 et § 4) : anniversaire,
 * préférences et étiquettes contrôlés, droits de la praticienne, liste
 * filtrée par étiquette, recherche dans les étiquettes, comptes des étiquettes.
 */

const FR = { "Accept-Language": "fr" };

test("fiche : anniversaire, préférences et étiquettes contrôlés ; la praticienne n'écrit que la note et les préférences", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const created = await g("POST", "/api/clients", { name: "Aïcha", birthday: "10-14", preferences: "  Thé à la citronnelle ", tags: ["VIP", "vip", "Peau sensible"] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const c0 = created.body.client;
  assert.deepEqual([c0.birthday, c0.preferences, c0.tags], ["10-14", "Thé à la citronnelle", ["VIP", "Peau sensible"]]);
  const id = c0.id as number;

  const refus: [Record<string, unknown>, string][] = [
    [{ birthday: "14-10" }, "L'anniversaire doit être un jour et un mois valables (MM-JJ)."],
    [{ birthday: "02-30" }, "L'anniversaire doit être un jour et un mois valables (MM-JJ)."],
    [{ preferences: "x".repeat(501) }, "Les préférences comptent 500 caractères au plus."],
    [{ tags: "VIP" }, "Les étiquettes doivent être une liste de textes."],
    [{ tags: ["x".repeat(31)] }, "Une étiquette compte 30 caractères au plus."],
    [{ tags: Array.from({ length: 11 }, (_, i) => `E${i}`) }, "Une cliente porte 10 étiquettes au plus."],
  ];
  for (const [body, message] of refus) {
    const res = await g("PUT", `/api/clients/${id}`, body, FR);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error, message);
  }
  const refusCreation = await g("POST", "/api/clients", { name: "Brenda", birthday: "31-12" }, FR);
  assert.equal(refusCreation.status, 400);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM clients WHERE name = 'Brenda'").get()!.n, 0, "rien d'écrit sur un refus");

  assert.equal((await g("PUT", `/api/clients/${id}`, { birthday: "02-29" })).status, 200, "29 février accepté");
  assert.equal((await g("PUT", `/api/clients/${id}`, { birthday: "" })).status, 200, "anniversaire effacé");
  assert.equal((await g("PUT", "/api/clients/999", { tags: ["VIP"] })).status, 404);

  const praticienne = await ctx.as("practitioner");
  const res = await praticienne("PUT", `/api/clients/${id}`, { preferences: "Café", notes: "Allergie", tags: ["Autre"], birthday: "01-01", name: "X" });
  assert.equal(res.status, 200);
  const fiche = (await praticienne("GET", `/api/clients/${id}`)).body.client;
  assert.deepEqual([fiche.name, fiche.preferences, fiche.notes, fiche.birthday, fiche.tags], ["Aïcha", "Café", "Allergie", "", ["VIP", "Peau sensible"]]);
});

test("liste : étiquettes sur chaque ligne, filtre exact par étiquette, recherche dans les étiquettes ; comptes lus par les trois rôles", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("POST", "/api/clients", { name: "Aïcha", tags: ["VIP", "Mariée"] });
  await g("POST", "/api/clients", { name: "Brenda", tags: ["vip"] });
  await g("POST", "/api/clients", { name: "Ngozi" });
  const all = (await g("GET", "/api/clients")).body.clients as { name: string; tags: string[] }[];
  assert.deepEqual(all.map((c) => [c.name, c.tags]), [["Aïcha", ["VIP", "Mariée"]], ["Brenda", ["VIP"]], ["Ngozi", []]]);

  const vip = (await g("GET", "/api/clients?tag=Vip")).body;
  assert.equal(vip.total, 2);
  assert.deepEqual(vip.clients.map((c: { name: string }) => c.name), ["Aïcha", "Brenda"]);
  assert.equal((await g("GET", `/api/clients?tag=${encodeURIComponent("mariee")}`)).body.total, 1, "accents et majuscules ignorés");
  assert.equal((await g("GET", "/api/clients?tag=VI")).body.total, 0, "filtre exact, pas une recherche");
  assert.equal((await g("GET", "/api/clients?tag=")).body.total, 3, "étiquette vide : toutes");
  assert.equal((await g("GET", `/api/clients?search=${encodeURIComponent("marié")}`)).body.total, 1, "la recherche trouve les étiquettes");
  assert.equal((await g("GET", "/api/clients?search=vip&tag=mariee")).body.total, 1, "recherche et filtre ensemble");

  for (const role of ["manager", "reception", "practitioner"] as const) {
    const res = await (await ctx.as(role))("GET", "/api/clients/tags");
    assert.equal(res.status, 200, role);
    assert.deepEqual(res.body.tags, [{ tag: "VIP", count: 2 }, { tag: "Mariée", count: 1 }], role);
  }
});
