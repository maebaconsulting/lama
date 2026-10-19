import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { catalogueEnLigne } from "../en-ligne/offre.ts";
import { runMigrations } from "../migrations.ts";
import { setupApp, type Caller } from "../test-support.ts";

/** Catalogue des suppléments (spec du 18/10/2026 § 3.1) : case « supplément seulement », listes, « Recopier vers… ». */

const FR = { "Accept-Language": "fr" };

test("prestation « supplément seulement » : durée 0 permise, jamais en ligne ; les autres gardent 5 à 720 minutes", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const meche = await g("POST", "/api/services", { name: "Mèches", duration: 0, price: 5000, supplement_seulement: 1, en_ligne: 1 });
  assert.equal(meche.status, 201, JSON.stringify(meche.body));
  assert.deepEqual([meche.body.service.duration, meche.body.service.supplement_seulement, meche.body.service.en_ligne], [0, 1, 0]);
  const refus = await g("POST", "/api/services", { name: "Tresses", duration: 0, price: 15000 }, FR);
  assert.equal(refus.status, 400);
  assert.equal(refus.body.error, "Saisie invalide\u00a0: duration.");
  assert.equal((await g("POST", "/api/services", { name: "Tresses", duration: 721, price: 15000 })).status, 400);
  assert.equal((await g("POST", "/api/services", { name: "Tresses", price: 15000 })).body.service.duration, 60, "durée par défaut gardée");

  const id = meche.body.service.id as number;
  assert.equal((await g("PUT", `/api/services/${id}`, { supplement_seulement: 0 })).status, 400, "décochée, la durée de 0 minute ne tient plus");
  assert.equal((await g("PUT", `/api/services/${id}`, { supplement_seulement: 0, duration: 15 })).status, 200);
  assert.equal((await g("PUT", `/api/services/${id}`, { en_ligne: 1 })).status, 200);
  assert.equal((await g("PUT", `/api/services/${id}`, { supplement_seulement: 1 })).status, 200);
  const ligne = () => ({ ...(ctx.db.prepare("SELECT supplement_seulement, en_ligne, duration FROM services WHERE id = ?").get(id) as object) });
  assert.deepEqual(ligne(), { supplement_seulement: 1, en_ligne: 0, duration: 15 }, "cochée : retirée de l'offre en ligne");
  assert.equal((await g("PUT", `/api/services/${id}`, { en_ligne: 1 })).status, 200);
  assert.deepEqual(ligne(), { supplement_seulement: 1, en_ligne: 0, duration: 15 }, "jamais republiée tant qu'elle est cochée");
  assert.equal((await g("PUT", `/api/services/${id}`, { duration: 0 })).status, 200);

  const liste = (await g("GET", "/api/services")).body.services as { id: number; supplement_seulement: number; supplements: unknown[] }[];
  assert.deepEqual(liste.find((s) => s.id === id)!.supplements, []);
  assert.equal(liste.find((s) => s.id === id)!.supplement_seulement, 1);
});

test("offre en ligne : une prestation « supplément seulement » n'est jamais publiée, même cochée en ligne en SQL direct", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  db.exec(`
    INSERT INTO staff (id, name, en_ligne) VALUES (1, 'Awa', 1);
    INSERT INTO services (id, name, duration, price, en_ligne) VALUES (1, 'Tresses', 60, 15000, 1);
    INSERT INTO services (id, name, duration, price, en_ligne, supplement_seulement) VALUES (2, 'Mèches', 30, 5000, 1, 1);
  `);
  assert.deepEqual(catalogueEnLigne(db).prestations.map((p) => p.id), [1]);
  db.close();
});

async function catalogue(g: Caller) {
  const svc = async (name: string, extra: Record<string, unknown> = {}) =>
    (await g("POST", "/api/services", { name, duration: 60, price: 15000, ...extra })).body.service.id as number;
  const tresses = await svc("Tresses", { category: "Coiffure" });
  const nattes = await svc("Nattes", { category: "Coiffure" });
  const meches = await svc("Mèches", { duration: 30, price: 5000, supplement_seulement: 1, category: "Coiffure" });
  const soin = await svc("Soin du visage", { category: "Visage" });
  const perles = (await g("POST", "/api/products", { name: "Perles", price: 500, stock: 50 })).body.product.id as number;
  return { tresses, nattes, meches, soin, perles };
}

const listeDe = (db: DatabaseSync, id: number) =>
  db.prepare("SELECT kind, ref_id FROM service_supplements WHERE service_id = ? ORDER BY position").all(id).map((r) => ({ ...r }));

test("suppléments possibles : liste ordonnée de prestations et de produits, jamais la prestation elle-même ni en cascade", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { tresses, meches, soin, perles } = await catalogue(g);
  const put = (id: number, items: unknown, who = g, headers: Record<string, string> = FR) => who("PUT", `/api/services/${id}/supplements`, { items }, headers);

  assert.equal((await put(tresses, [{ kind: "product", ref_id: perles }], r)).status, 403, "gérante seulement");
  const ok = await put(tresses, [{ kind: "product", ref_id: perles }, { kind: "service", ref_id: meches }, { kind: "product", ref_id: perles }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.supplements, [{ kind: "product", ref_id: perles }, { kind: "service", ref_id: meches }], "ordre gardé, doublon ignoré");
  const lue = (await g("GET", "/api/services")).body.services.find((s: { id: number }) => s.id === tresses);
  assert.deepEqual(lue.supplements, ok.body.supplements);

  const refus: [unknown, number, string | null][] = [
    [[{ kind: "service", ref_id: tresses }], 400, "Une prestation ne peut pas être son propre supplément."],
    [[{ kind: "product", ref_id: 999 }], 404, "Article introuvable (n°\u00a0999)."],
    [[{ kind: "forfait", ref_id: 1 }], 400, "Liste de suppléments invalide (30 articles au plus)."],
    [Array.from({ length: 31 }, (_, i) => ({ kind: "product", ref_id: i + 1 })), 400, null],
    ["Perles", 400, null],
  ];
  for (const [items, status, error] of refus) {
    const res = await put(tresses, items);
    assert.equal(res.status, status, JSON.stringify(items).slice(0, 60));
    if (error) assert.equal(res.body.error, error);
  }
  const cascade = await put(soin, [{ kind: "service", ref_id: tresses }]);
  assert.deepEqual([cascade.status, cascade.body.error], [409, "«\u00a0Tresses\u00a0» a ses propres suppléments\u00a0: un supplément n'en a pas lui-même."]);
  const deja = await put(meches, [{ kind: "product", ref_id: perles }]);
  assert.deepEqual([deja.status, deja.body.error], [409, "Cette prestation est le supplément d'une autre prestation\u00a0: elle ne peut pas avoir de suppléments."]);
  assert.deepEqual(listeDe(ctx.db, tresses), [{ kind: "product", ref_id: perles }, { kind: "service", ref_id: meches }], "un refus ne touche à rien");
  assert.equal((await put(tresses, [], g, {})).status, 200, "liste vidée");
  assert.deepEqual(listeDe(ctx.db, tresses), []);
});

test("Recopier vers… : la liste remplace celle des prestations choisies, toutes ou aucune", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { tresses, nattes, meches, soin, perles } = await catalogue(g);
  await g("PUT", `/api/services/${tresses}/supplements`, { items: [{ kind: "product", ref_id: perles }, { kind: "service", ref_id: meches }] });
  await g("PUT", `/api/services/${soin}/supplements`, { items: [{ kind: "product", ref_id: perles }] });
  const copie = (targets: unknown, who = g) => who("POST", `/api/services/${tresses}/supplements/copie`, { targets }, FR);

  assert.equal((await copie([nattes], r)).status, 403);
  const ok = await copie([nattes, soin, nattes]);
  assert.deepEqual([ok.status, ok.body.copied], [200, 2]);
  assert.deepEqual(listeDe(ctx.db, nattes), listeDe(ctx.db, tresses));
  assert.deepEqual(listeDe(ctx.db, soin), listeDe(ctx.db, tresses), "la liste de la cible est remplacée");

  await g("PUT", `/api/services/${nattes}/supplements`, { items: [] });
  const refus = await copie([nattes, meches]);
  assert.equal(refus.status, 409, "Mèches est le supplément de Tresses : elle ne reçoit pas de liste");
  assert.deepEqual(listeDe(ctx.db, nattes), [], "copie refusée : aucune cible touchée");
  assert.deepEqual([(await copie([])).status, (await copie([])).body.error], [400, "Choisissez au moins une prestation où recopier la liste."]);
});

test("« supplément seulement » et liste : jamais de liste sous une telle prestation, jamais la case cochée sur une prestation qui a une liste", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { tresses, nattes, meches, perles } = await catalogue(g);
  const MESSAGE = "Une prestation «\u00a0supplément seulement\u00a0» n'a pas de suppléments possibles.";
  const liste = await g("PUT", `/api/services/${meches}/supplements`, { items: [{ kind: "product", ref_id: perles }] }, FR);
  assert.deepEqual([liste.status, liste.body.error], [409, MESSAGE]);
  assert.equal((await g("PUT", `/api/services/${meches}/supplements`, { items: [] })).status, 200, "une liste vide reste permise");
  assert.equal((await g("PUT", `/api/services/${tresses}/supplements`, { items: [{ kind: "product", ref_id: perles }] })).status, 200);
  const caseCochee = await g("PUT", `/api/services/${tresses}`, { supplement_seulement: 1 }, FR);
  assert.deepEqual([caseCochee.status, caseCochee.body.error], [409, MESSAGE]);
  assert.equal((ctx.db.prepare("SELECT supplement_seulement FROM services WHERE id = ?").get(tresses) as { supplement_seulement: number }).supplement_seulement, 0);
  assert.equal((await g("PUT", `/api/services/${tresses}`, { supplement_seulement: 0, price: 16000 })).status, 200, "décocher ou modifier autre chose reste permis");
  assert.equal((await g("PUT", `/api/services/${nattes}`, { supplement_seulement: 1 })).status, 200, "sans liste, la case se coche");
});
