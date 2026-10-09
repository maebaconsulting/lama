import assert from "node:assert/strict";
import { test } from "node:test";
import { auditTarget } from "../../client/lib/libelles.ts";
import { setupApp, type Caller, type TestApp } from "../test-support.ts";

/**
 * Interrupteur général du mini CRM (spec du 04/10/2026, « Interrupteur
 * général ») : `crm.active`, vrai par défaut, à la gérante. Désactivé, le
 * serveur se comporte comme avant le chantier (ni points, ni synthèse, ni
 * campagne) sans jamais effacer les données ; réactivé, tout revient.
 */

const FR = { "Accept-Language": "fr" };

/** Une praticienne, une cliente étiquetée avec anniversaire et préférences, un soin à 25 000 F. */
async function catalogue(g: Caller) {
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const created = await g("POST", "/api/clients", { name: "Aïcha Mbida", phone: "699123456", birthday: "10-04", preferences: "Thé à la menthe", tags: ["VIP"] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const client = created.body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", name_en: "Radiance facial", duration: 60, price: 25000 })).body.service.id as number;
  return { staff, client, service };
}

const entries = (ctx: TestApp, invoiceId: number) =>
  ctx.db.prepare("SELECT kind, points FROM loyalty_entries WHERE invoice_id = ? ORDER BY id").all(invoiceId).map((row) => ({ ...row }));

test("réglage crm.active : vrai par défaut, gérante seule, au journal avec un libellé traduit", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  const value = async () => ((await g("GET", "/api/settings")).body.settings as { key: string; value: unknown }[]).find((s) => s.key === "crm.active")?.value;
  assert.equal(await value(), true);
  assert.equal((await r("PUT", "/api/settings/crm.active", { value: false })).status, 403);
  assert.equal((await p("PUT", "/api/settings/crm.active", { value: false })).status, 403);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: "non" })).status, 400);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: false })).status, 200);
  assert.equal(await value(), false);
  const journal = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'reglage'").all().map((row) => (row as { target: string }).target);
  assert.deepEqual(journal, ["crm.active"]);
  assert.equal(auditTarget("crm.active", "fr"), "Mini CRM activé ou désactivé");
  assert.equal(auditTarget("crm.active", "en"), "Mini CRM turned on or off");
});

test("état de session : chaque rôle connecté connaît l'interrupteur, rien avant la connexion", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  assert.equal((await ctx.anonymous()("GET", "/api/auth/state")).body.crm, null);
  assert.deepEqual((await p("GET", "/api/auth/state")).body.crm, { active: true });
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: false })).status, 200);
  assert.deepEqual((await p("GET", "/api/auth/state")).body.crm, { active: false });
  assert.deepEqual((await g("GET", "/api/auth/state")).body.crm, { active: false });
});

test("désactivé : ni gain ni récompense même fidélité active, synthèse nulle, données gardées ; réactivé : tout revient", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { staff, client, service } = await catalogue(g);
  assert.equal((await g("PUT", "/api/settings/fidelite.active", { value: true })).status, 200);
  ctx.db.prepare("INSERT INTO loyalty_entries (client_id, kind, points, note, created_at) VALUES (?, 'correction', 120, 'Carte papier', 0)").run(client);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: false })).status, 200);

  assert.deepEqual((await r("GET", "/api/sales/settings")).body.loyalty.active, false);
  const sale = (id: string, reward = false) => r("POST", "/api/sales", {
    request_id: id, client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }],
    ...(reward ? { discount: { reward_points: 100 } } : {}), payments: [{ method: "card", amount: reward ? 20000 : 25000 }],
  }, FR);
  const refused = await sale("crm-off-recompense", true);
  assert.deepEqual([refused.status, refused.body.error], [400, "Mini CRM désactivé."], "la cause dite à la caisse : le mini CRM, pas la case de fidélité");
  const plain = await sale("crm-off-vente");
  assert.equal(plain.status, 201, JSON.stringify(plain.body));
  assert.deepEqual(entries(ctx, plain.body.invoice.id), [], "aucun gain");
  const correction = await g("POST", `/api/clients/${client}/loyalty`, { points: 10, note: "Geste" }, FR);
  assert.deepEqual([correction.status, correction.body.error], [400, "La fidélité n'est pas activée dans les réglages."]);

  const detail = await r("GET", `/api/clients/${client}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.summary, null);
  assert.deepEqual([detail.body.client.birthday, detail.body.client.preferences, detail.body.client.tags], ["10-04", "Thé à la menthe", ["VIP"]]);
  // L'écran n'envoie plus ces champs : un enregistrement ne les efface jamais.
  assert.equal((await r("PUT", `/api/clients/${client}`, { name: "Aïcha Mbida", email: "", phone: "699123456", card: "" })).status, 200);
  const kept = (await r("GET", `/api/clients/${client}`)).body.client;
  assert.deepEqual([kept.birthday, kept.preferences, kept.tags], ["10-04", "Thé à la menthe", ["VIP"]]);

  // Avoir de la vente faite avant : la reprise des points s'écrit toujours (ajustement 3).
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: true })).status, 200);
  const before = await sale("crm-on-vente");
  assert.deepEqual(entries(ctx, before.body.invoice.id), [{ kind: "gain", points: 25 }], "réactivé : le gain revient");
  assert.equal((await r("GET", `/api/clients/${client}`)).body.summary.loyalty.balance, 145, "réactivé : la synthèse et le solde reviennent");
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: false })).status, 200);
  const back = await g("POST", "/api/credit-notes", {
    request_id: "crm-off-avoir", invoice_id: before.body.invoice.id, reason: "Erreur de caisse",
    lines: [{ line_id: before.body.invoice.lines[0].id, quantity: 1 }], refunds: [{ method: "card", amount: 25000 }],
  });
  assert.equal(back.status, 201, JSON.stringify(back.body));
  assert.deepEqual(entries(ctx, back.body.credit_note.id), [{ kind: "reprise", points: -25 }]);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: true })).status, 200);
  assert.equal((await r("GET", `/api/clients/${client}`)).body.summary.loyalty.balance, 120);
  assert.equal((await r("GET", `/api/clients/${client}`)).body.summary.visits, 0);
});

test("campagnes : envoi et aperçu refusés quand le mini CRM est désactivé, liste toujours lisible", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await catalogue(g);
  assert.equal((await g("POST", "/api/campaigns", { tag: "VIP", text_fr: "Bonjour {prenom}." })).status, 201);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: false })).status, 200);
  const sent = await g("POST", "/api/campaigns", { tag: "VIP", text_fr: "Encore {prenom}." }, FR);
  assert.deepEqual([sent.status, sent.body.error], [400, "Mini CRM désactivé."]);
  const preview = await g("GET", "/api/campaigns/preview?tag=VIP", undefined, { "Accept-Language": "en" });
  assert.deepEqual([preview.status, preview.body.error], [400, "Mini CRM turned off."]);
  const list = await g("GET", "/api/campaigns");
  assert.equal(list.status, 200);
  assert.equal(list.body.campaigns.length, 1);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number }).n, 1);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: true })).status, 200);
  assert.equal((await g("GET", "/api/campaigns/preview?tag=VIP")).status, 200, "réactivé : la campagne revient");
});

test("recherche des clientes : désactivé, ni recherche texte par étiquette ni filtre `tag` ; nom et carte trouvés comme avant", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  await catalogue(g);
  assert.equal((await r("POST", "/api/clients", { name: "Brenda Ngo", card: "LAMA0042" })).status, 201);
  const names = async (query: string) => ((await r("GET", `/api/clients?${query}`)).body.clients as { name: string }[]).map((c) => c.name).sort();
  assert.deepEqual(await names("search=vip"), ["Aïcha Mbida"]);
  assert.deepEqual(await names("tag=VIP"), ["Aïcha Mbida"]);
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: false })).status, 200);
  assert.deepEqual(await names("search=vip"), [], "l'étiquette invisible ne fait plus trouver la cliente");
  assert.deepEqual(await names("tag=VIP"), ["Aïcha Mbida", "Brenda Ngo"], "filtre ignoré : toutes les clientes");
  assert.deepEqual(await names("search=aicha"), ["Aïcha Mbida"]);
  assert.deepEqual(await names("search=LAMA0042"), ["Brenda Ngo"], "le numéro de carte reste trouvé");
  assert.equal((await g("PUT", "/api/settings/crm.active", { value: true })).status, 200);
  assert.deepEqual(await names("search=vip"), ["Aïcha Mbida"], "réactivé : la recherche par étiquette revient");
});
