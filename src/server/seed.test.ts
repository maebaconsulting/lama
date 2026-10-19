import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bundleOf, setupApp } from "./test-support.ts";
import { serieHistorique } from "./neutralite-empreintes.ts";
import { doualaDay } from "../shared/caisse.ts";

test("mode démo : institut de beauté de Douala, prix entiers en FCFA, téléphones +237 (spec § 9)", async (t) => {
  const ctx = await setupApp(t);
  const g = await ctx.as("manager");
  const services = (await g("GET", "/api/services")).body.services as { name: string; name_en: string; category: string; price: number; duration: number }[];
  assert.deepEqual([...new Set(services.map((s) => s.category))].sort(), ["Coiffure", "Maquillage", "Massages", "Onglerie", "Soins du visage", "Épilation"].sort());
  for (const s of services) assert.ok(Number.isInteger(s.price) && s.price >= 1000 && s.price % 500 === 0, `${s.name} : ${s.price}`);
  const anglais = services.filter((s) => s.name_en).length;
  assert.ok(anglais > services.length / 2 && anglais < services.length, "anglais pour la plupart, pas toutes");
  const produits = (await g("GET", "/api/products")).body.products as { name_en: string; price: number }[];
  assert.ok(produits.some((p) => p.name_en) && produits.some((p) => !p.name_en));
  for (const p of produits) assert.ok(Number.isInteger(p.price));
  const clientes = (await g("GET", "/api/clients")).body.clients as { phone: string }[];
  assert.ok(clientes.length >= 5);
  for (const c of clientes) assert.match(c.phone, /^\+237 6\d{2}( \d{2}){3}$/);
  const equipe = (await g("GET", "/api/staff")).body.staff as { title: string; title_en: string }[];
  assert.ok(equipe.some((s) => s.title_en) && equipe.some((s) => !s.title_en));
});

test("installation réelle : aucune donnée fictive", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  assert.equal((await g("GET", "/api/services")).body.services.length, 0);
  assert.equal((await g("GET", "/api/clients")).body.clients.length, 0);
  assert.equal((await g("GET", "/api/products")).body.products.length, 0);
});

/** Valeur d'un réglage lue par la gérante. */
async function reglage(g: Awaited<ReturnType<Awaited<ReturnType<typeof setupApp>>["as"]>>, key: string): Promise<unknown> {
  const settings = (await g("GET", "/api/settings")).body.settings as { key: string; value: unknown }[];
  return settings.find((s) => s.key === key)?.value;
}

test("démonstration neutre (distribution D-02) : « Institut Démo », série DEMO, marque « Maison Démo » ; service réel vide et FAC", async (t) => {
  const reel = await setupApp(t, { demo: false });
  const gReel = await reel.as("manager");
  assert.equal(await reglage(gReel, "institut.nom"), "");
  assert.equal(await reglage(gReel, "caisse.prefixe"), "FAC", "installation neuve : défaut du code");
  const demo = await setupApp(t);
  const g = await demo.as("manager");
  assert.equal(await reglage(g, "institut.nom"), "Institut Démo");
  assert.equal(await reglage(g, "caisse.prefixe"), "DEMO");
  const marques = ((await g("GET", "/api/products")).body.products as { brand: string }[]).map((p) => p.brand);
  assert.ok(marques.includes("Maison Démo"), marques.join(", "));
  // Un nom changé par la gérante n'est jamais remis par la démonstration.
  assert.equal((await g("PUT", "/api/settings/institut.nom", { value: "Institut Akwa" })).status, 200);
  assert.equal(await reglage(g, "institut.nom"), "Institut Akwa");
});

test("démonstration : logos au signe de lama déposés (jamais docs/brand), image d'impression prête ; aucun logo en service réel", async (t) => {
  const demo = await setupApp(t);
  const lignes = () => demo.db.prepare("SELECT variante, type, version, impression FROM institut_logos ORDER BY variante").all() as { variante: string; type: string; version: number; impression: Uint8Array | null }[];
  await (await demo.as("manager"))("GET", "/api/settings");
  const avant = lignes();
  assert.deepEqual(avant.map((l) => [l.variante, l.type]), [["clair", "image/png"], ["sombre", "image/png"]]);
  assert.ok(avant[0].impression && avant[0].impression.length > 0, "image d'impression du logo clair");
  assert.equal(avant[1].impression, null);
  const octets = (variante: string) => Buffer.from((demo.db.prepare("SELECT octets FROM institut_logos WHERE variante = ?").get(variante) as { octets: Uint8Array }).octets);
  assert.deepEqual(octets("clair"), readFileSync("src/server/demo/logo-clair.png"));
  assert.deepEqual(octets("sombre"), readFileSync("src/server/demo/logo-sombre.png"));
  assert.doesNotMatch(readFileSync("src/server/seed.ts", "utf8"), /docs\/brand|docs", "brand/, "la démonstration ne lit rien de docs/brand (D-04)");
  await (await demo.as("manager"))("GET", "/api/settings");
  assert.deepEqual(lignes().map((l) => l.version), avant.map((l) => l.version), "versions inchangées");
  const reel = await setupApp(t, { demo: false });
  await (await reel.as("manager"))("GET", "/api/settings");
  assert.equal((reel.db.prepare("SELECT COUNT(*) AS n FROM institut_logos").get() as { n: number }).n, 0);
});

const count = (ctx: Awaited<ReturnType<typeof setupApp>>, sql: string) => Number((ctx.db.prepare(sql).get() as { n: number }).n);

test("démonstration : six mois d'historique par le vrai encaissement, un avoir, anniversaire du jour, préférences et étiquettes (mini CRM, décision 31)", async (t) => {
  const ctx = await setupApp(t, { history: true });
  const g = await ctx.as("manager");
  const invoices = count(ctx, "SELECT COUNT(*) AS n FROM invoices WHERE kind = 'invoice'");
  assert.ok(invoices >= 20, `${invoices} factures`);
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM invoices WHERE kind = 'credit_note'"), 1, "un avoir");
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM accounts"), 1, "aucun compte créé");
  const issued = (ctx.db.prepare("SELECT issued_at FROM invoices WHERE kind = 'invoice' ORDER BY year, seq").all() as { issued_at: number }[]).map((r) => r.issued_at);
  assert.deepEqual(issued, [...issued].sort((a, b) => a - b), "numéros dans l'ordre des dates");
  assert.ok(issued[0] < ctx.clock.now - 150 * 86_400_000, "environ six mois d'histoire");
  assert.ok(issued.every((at) => at < ctx.clock.now), "rien dans le futur");
  assert.deepEqual(ctx.db.prepare("SELECT DISTINCT series FROM invoices WHERE kind = 'invoice'").all().map((r) => (r as { series: string }).series), ["DEMO"], "série DEMO");

  const aicha = (await g("GET", "/api/clients/1")).body;
  assert.equal(aicha.client.birthday, doualaDay(ctx.clock.now).slice(5), "anniversaire aujourd'hui (Douala)");
  assert.deepEqual(aicha.client.tags, ["VIP", "Peau sensible"]);
  assert.ok(aicha.client.preferences.length > 0);
  assert.equal(aicha.summary.visits, 8);
  assert.equal(aicha.summary.days_since, 20);
  assert.ok(aicha.summary.next_appointment, "prochain rendez-vous");
  assert.equal(aicha.summary.favorite_staff.name, "Solange Ekambi");
  assert.ok(aicha.summary.total_spent > 0 && aicha.summary.average_basket > 0);

  const brenda = (await g("GET", "/api/clients/2")).body.summary;
  assert.deepEqual([brenda.days_since, brenda.next_appointment], [74, null], "absente au-delà du seuil de 60 jours");
  const mc = (await g("GET", "/api/clients/4")).body.summary;
  assert.equal(mc.products.find((p: { label_fr: string }) => p.label_fr === "Beurre de karité")?.quantity, 1, "achat net de l'avoir");
  const florence = (await g("GET", "/api/clients/5")).body.summary;
  assert.equal(florence.visits, 0, "une cliente jamais venue");
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM appointments WHERE status = 'no_show'"), 1);

  const tags = (await g("GET", "/api/clients/tags")).body.tags as { tag: string; count: number }[];
  assert.deepEqual(tags.slice(0, 2), [{ tag: "Peau sensible", count: 2 }, { tag: "VIP", count: 2 }]);
  assert.ok(tags.some((x) => x.tag === "Mariée"));

  await g("GET", "/api/clients");
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM invoices WHERE kind = 'invoice'"), invoices, "une seule fois");
});

test("historique de démonstration : jamais sans le demander (essais), jamais en service réel, attend un compte, jamais par-dessus une activité", async (t) => {
  const sans = await setupApp(t);
  await (await sans.as("manager"))("GET", "/api/clients");
  assert.equal(count(sans, "SELECT COUNT(*) AS n FROM invoices"), 0, "essais : pas d'historique sans history");

  const reel = await setupApp(t, { demo: false, history: true });
  await (await reel.as("manager"))("GET", "/api/clients");
  assert.equal(count(reel, "SELECT COUNT(*) AS n FROM invoices") + count(reel, "SELECT COUNT(*) AS n FROM appointments"), 0, "service réel");

  const occupe = await setupApp(t, { history: true });
  await occupe.raw("GET", "/api/clients");
  assert.equal(count(occupe, "SELECT COUNT(*) AS n FROM invoices"), 0, "aucun compte de gérante ni de réception : rien encore");
  occupe.db.exec("INSERT INTO appointments (identifier, client_id, scheduled_date) VALUES ('APT-900', 1, '2026-09-01')");
  await (await occupe.as("manager"))("GET", "/api/clients");
  assert.equal(count(occupe, "SELECT COUNT(*) AS n FROM invoices"), 0, "un rendez-vous existe : l'historique n'est pas créé");
  assert.equal(count(occupe, "SELECT COUNT(*) AS n FROM appointments"), 1);
});

test("démonstration sur une base déjà en service : le préfixe écrit est conservé, aucune série DEMO ne s'ajoute (distribution D-02)", async (t) => {
  // Cas (a) : préfixe réglé par l'administrateur ; cas (b) : base migrée, série historique écrite par la migration 018.
  for (const serie of ["XYZ", serieHistorique()]) {
    const ctx = await setupApp(t);
    const { id: accountId } = await ctx.seedAccount("manager");
    ctx.db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.prefixe', ?, 0, ?)").run(JSON.stringify(serie), ctx.clock.now);
    ctx.db.prepare("INSERT INTO sequences (series, year, last) VALUES (?, 2026, 1)").run(serie);
    ctx.db.prepare(
      `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, request_id)
       VALUES ('invoice', ?, ?, 2026, 1, ?, 'fr', ?, 5000, 5000, 5000, 0, '{}', ?)`,
    ).run(`${serie}-2026-000001`, serie, ctx.clock.now, accountId, `service-${serie}`);
    // Premier appel : la démonstration (LAMA_DEMO=1) s'exécute sur cette base sans lever ni s'arrêter en route.
    const g = await ctx.as("manager");
    assert.equal((await g("GET", "/api/settings")).status, 200, serie);
    assert.ok((await g("GET", "/api/services")).body.services.length > 0, `${serie} : démonstration menée à son terme`);
    assert.equal(await reglage(g, "institut.nom"), "Institut Démo", serie);
    assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM institut_logos"), 2, `${serie} : logos déposés, fin de la démonstration atteinte`);
    assert.equal(await reglage(g, "caisse.prefixe"), serie);
    assert.deepEqual(ctx.db.prepare("SELECT DISTINCT series FROM invoices").all().map((l) => (l as { series: string }).series), [serie]);
    assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM settings WHERE key = 'caisse.prefixe'"), 1);
  }
});

test("démonstration sur une installation neuve qui a déjà vendu en FAC, sans réglage écrit : aucune ligne DEMO, les factures gardent leur série", async (t) => {
  const ctx = await setupApp(t);
  const { id: accountId } = await ctx.seedAccount("manager");
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM settings WHERE key = 'caisse.prefixe'"), 0);
  ctx.db.prepare("INSERT INTO sequences (series, year, last) VALUES ('FAC', 2026, 1)").run();
  ctx.db.prepare(
    `INSERT INTO invoices (kind, number, series, year, seq, issued_at, lang, account_id, subtotal, total_ttc, total_ht, total_tva, fiscal, request_id)
     VALUES ('invoice', 'FAC-2026-000001', 'FAC', 2026, 1, ?, 'fr', ?, 5000, 5000, 5000, 0, '{}', 'service-fac')`,
  ).run(ctx.clock.now, accountId);
  const g = await ctx.as("manager");
  assert.equal((await g("GET", "/api/settings")).status, 200);
  assert.ok((await g("GET", "/api/services")).body.services.length > 0, "démonstration menée à son terme");
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM institut_logos"), 2, "fin de la démonstration atteinte");
  assert.equal(count(ctx, "SELECT COUNT(*) AS n FROM settings WHERE key = 'caisse.prefixe'"), 0, "aucune ligne caisse.prefixe écrite");
  assert.deepEqual(ctx.db.prepare("SELECT DISTINCT series FROM invoices").all().map((l) => (l as { series: string }).series), ["FAC"]);
});

// seed.ts importe « ./db.js » : il ne se charge qu'assemblé (voir bundleOf).
const { produitsDemo, servicesDemo } = await import(await bundleOf("./seed.ts"));

test("jeu de démonstration converti : XAF inchangé, euros ronds", () => {
  const xaf = servicesDemo("XAF") as (string | number)[][];
  assert.ok(xaf.some((s) => s[6] === 20000), "Pose de gel à 20 000 F");
  const eur = (servicesDemo("EUR") as number[][]).map((s) => s[6]);
  assert.ok(eur.every((p) => p % 50 === 0 && p >= 100 && p < 20000), String(eur)); // 1 € à 200 €, ronds à 0,50 €
  const produits = produitsDemo("EUR") as number[][];
  assert.ok(produits.every((p) => p[6] % 50 === 0 && p[7] % 50 === 0), JSON.stringify(produits));
});
