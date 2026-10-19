import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { resourceFor } from "../realtime.ts";
import { setupApp, type Caller } from "../test-support.ts";

/**
 * API de la caisse, vague 1 (sous-projet 5 § 4.5) : vente de comptoir et
 * encaissement d'un rendez-vous, idempotence, remise au-delà du plafond,
 * réglages figés sur la facture, refus de suppression, droits.
 */

async function catalogue(g: Caller) {
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", name_en: "Radiance facial", duration: 60, price: 25000 })).body.service.id as number;
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 35000, stock: 3 })).body.product.id as number;
  return { staff, client, service, product };
}

const FR = { "Accept-Language": "fr" };

test("vente de comptoir sans rendez-vous : facture complète, stock déduit, journal, signal des factures", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { product } = await catalogue(g);
  const sale = await r("POST", "/api/sales", {
    request_id: "comptoir-0001",
    lines: [{ kind: "product", ref_id: product, quantity: 1 }],
    payments: [{ method: "cash", amount: 35000, cash_given: 40000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const inv = sale.body.invoice;
  assert.equal(inv.number, "FAC-2026-000001");
  assert.deepEqual([inv.subtotal, inv.total_ttc, inv.total_ht, inv.total_tva, inv.client_id, inv.account_name], [35000, 35000, 29350, 5650, null, "reception"]);
  assert.deepEqual(inv.lines.map((l: Record<string, unknown>) => [l.kind, l.label_fr, l.quantity, l.unit_price, l.line_total]), [["product", "Crème hydratante", 1, 35000, 35000]]);
  assert.deepEqual(inv.payments, [{ method: "cash", amount: 35000, reference: "", cash_given: 40000, change_given: 5000 }]);
  assert.equal(inv.fiscal.tva_taux, 19.25);
  assert.equal(inv.tip, null);
  assert.equal((await g("GET", `/api/products/${product}`)).body.product.stock, 2);
  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'facture.%'").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [{ action: "facture.emise", target: "FAC-2026-000001 (35\u202f000\u00a0FCFA)" }], "mineur 3 : montant groupé comme à l'écran");
  assert.equal(resourceFor("/api/sales"), "invoices");
});

test("même request_id envoyé deux fois : 200 et la même facture, jamais une seconde", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { product } = await catalogue(g);
  const body = { request_id: "reponse-perdue-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] };
  const first = await g("POST", "/api/sales", body);
  const again = await g("POST", "/api/sales", body);
  assert.deepEqual([first.status, again.status], [201, 200]);
  assert.equal(again.body.invoice.id, first.body.invoice.id);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 1);
  assert.equal((await g("GET", `/api/products/${product}`)).body.product.stock, 2, "stock déduit une seule fois");
  // Réponse perdue, puis ticket retouché avant le renvoi : la vente déjà émise revient telle quelle, jamais une seconde.
  const changed = await g("POST", "/api/sales", { ...body, lines: [{ kind: "product", ref_id: product, quantity: 2 }], payments: [{ method: "card", amount: 70000 }] });
  assert.deepEqual([changed.status, changed.body.invoice.id, changed.body.invoice.total_ttc], [200, first.body.invoice.id, 35000]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'facture.emise'").get() as { n: number }).n, 1, "un rejeu n'écrit pas une seconde facture émise au journal");
});

test("encaisser un rendez-vous : terminé et payé, pourboire hors facture ; suppression refusée ; la praticienne ne voit que « payé »", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { staff, client, service, product } = await catalogue(g);
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-28", start_time: "10:00", service_ids: [service] })).body.appointment.id;
  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.paid, 0);
  const sale = await g("POST", "/api/sales", {
    request_id: "rdv-encaisse-1", client_id: client, appointment_id: apt,
    lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }, { kind: "product", ref_id: product, quantity: 1 }],
    discount: { kind: "percent", value: 5, reason: "fidelite" },
    tip: { amount: 2000, staff_id: staff },
    payments: [{ method: "cash", amount: 20000, cash_given: 20000 }, { method: "orange_money", amount: 39000, reference: "OM-4471" }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const inv = sale.body.invoice;
  assert.deepEqual([inv.subtotal, inv.discount_amount, inv.total_ttc, inv.total_ht, inv.total_tva], [60000, 3000, 57000, 47799, 9201], "exemple de la maquette");
  assert.deepEqual(inv.tip, { staff_id: staff, amount: 2000, staff_name: "Solange" });
  assert.equal(inv.appointment_identifier, "APT-1");
  assert.equal(inv.lines[0].staff_name, "Solange");
  const seen = (await g("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.deepEqual([seen.status, seen.paid, seen.invoice_number, seen.invoice_total], ["completed", 1, "FAC-2026-000001", inv.total_ttc], "retouche R2 : total facturé sur la fiche");
  const calendar = (await g("GET", "/api/calendar?start=2026-09-28&end=2026-09-28")).body.appointments[0];
  assert.deepEqual([calendar.paid, calendar.invoice_id, calendar.invoice_total], [1, inv.id, inv.total_ttc]);

  const refused = await g("DELETE", `/api/appointments/${apt}`, undefined, FR);
  assert.equal(refused.status, 409);
  // Correctif final (point 8) : le refus dit qu'une facture a été émise, jamais « encaissé ».
  assert.match(refused.body.error, /facture a été émise/);
  assert.doesNotMatch(refused.body.error, /encaissé/);
  assert.equal((await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" })).status, 200, "l'annulation reste possible");

  const p = await ctx.as("practitioner");
  const forPractitioner = (await p("GET", `/api/appointments/${apt}`)).body.appointment;
  assert.equal(forPractitioner.paid, 1);
  assert.equal("invoice_number" in forPractitioner || "invoice_id" in forPractitioner || "total_price" in forPractitioner || "invoice_total" in forPractitioner, false);

  const twice = await g("POST", "/api/sales", { request_id: "rdv-encaisse-2", client_id: client, appointment_id: apt, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "card", amount: 25000 }] }, FR);
  assert.equal(twice.status, 409, "rendez-vous annulé");
});

test("cliente et praticienne facturées : leur fiche ne se supprime plus", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { staff, client, service } = await catalogue(g);
  const sale = await g("POST", "/api/sales", { request_id: "comptoir-soin-1", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }], payments: [{ method: "card", amount: 25000 }] });
  assert.equal(sale.status, 201);
  const c = await g("DELETE", `/api/clients/${client}`, undefined, FR);
  assert.deepEqual([c.status, c.body.error], [409, "Cette cliente a des factures\u00a0: sa fiche est gardée."]);
  const s = await g("DELETE", `/api/staff/${staff}`);
  assert.deepEqual([s.status, s.body.error], [409, "This staff member appears on invoices: deactivate the record instead."]);
});

test("remise au-delà du plafond : mot de passe d'une gérante demandé à la réception, confirmation pour la gérante, journal", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { client, service } = await catalogue(g);
  const body = { request_id: "remise-plafond-1", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], discount: { kind: "percent", value: 20, reason: "geste" }, payments: [{ method: "card", amount: 20000 }] };
  const asked = await r("POST", "/api/sales", body, FR);
  assert.deepEqual([asked.status, asked.body.code, asked.body.error], [403, "approbation", "Remise au-delà de 10\u00a0%\u00a0: le mot de passe d'une gérante est demandé."]);
  const wrong = await r("POST", "/api/sales", { ...body, approval: { login: "manager", password: "pas-le-bon-mot" } });
  assert.deepEqual([wrong.status, wrong.body.code, wrong.body.refused], [403, "approbation", true]);
  // Identifiant inconnu : rien de ce qui a été tapé ne finit au journal (le champ peut contenir un mot de passe).
  const unknown = await r("POST", "/api/sales", { ...body, approval: { login: "mot-de-passe-tape-ici", password: "peu-importe" } });
  assert.deepEqual([unknown.status, unknown.body.code, unknown.body.refused], [403, "approbation", true]);
  const targets = ctx.db.prepare("SELECT target FROM audit_log").all().map((row) => (row as { target: string }).target);
  assert.ok(targets.includes("(identifiant inconnu)"), "identifiant inconnu inscrit au journal");
  assert.ok(!targets.some((t) => t.includes("mot-de-passe-tape-ici")), "le texte tapé n'apparaît nulle part au journal");
  // Un administrateur a des identifiants valides, mais n'est pas une gérante : refusé.
  const admin = await ctx.seedAccount("admin");
  const asAdmin = await r("POST", "/api/sales", { ...body, approval: { login: admin.login, password: admin.password } });
  assert.deepEqual([asAdmin.status, asAdmin.body.code], [403, "approbation"], "un administrateur ne s'approuve pas non plus");
  // Gérante bloquée : refusée, notée « connexion.blocage » (jamais « connexion.echec »).
  const locked = await ctx.seedAccount("manager", "gerante-bloquee");
  ctx.db.prepare("UPDATE accounts SET locked_until = ? WHERE id = ?").run(ctx.clock.now + 3_600_000, locked.id);
  const lockedTry = await r("POST", "/api/sales", { ...body, approval: { login: locked.login, password: locked.password } });
  assert.deepEqual([lockedTry.status, lockedTry.body.code], [403, "approbation"]);
  assert.ok(ctx.db.prepare("SELECT 1 FROM audit_log WHERE action = 'connexion.blocage' AND target = ?").get(locked.login), "compte bloqué noté « connexion.blocage »");
  // Gérante désactivée : refusée aussi.
  const inactive = await ctx.seedAccount("manager", "gerante-inactive");
  ctx.db.prepare("UPDATE accounts SET active = 0 WHERE id = ?").run(inactive.id);
  const inactiveTry = await r("POST", "/api/sales", { ...body, approval: { login: inactive.login, password: inactive.password } });
  assert.deepEqual([inactiveTry.status, inactiveTry.body.code], [403, "approbation"]);
  const notManager = await r("POST", "/api/sales", { ...body, approval: { login: "reception", password: "mot-de-passe-test" } });
  assert.equal(notManager.status, 403, "la réception ne s'approuve pas elle-même");
  const ok = await r("POST", "/api/sales", { ...body, approval: { login: "manager", password: "mot-de-passe-test" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const managerId = (ctx.db.prepare("SELECT id FROM accounts WHERE login = 'manager'").get() as { id: number }).id;
  const plafond = ctx.db.prepare("SELECT account_id, target FROM audit_log WHERE action = 'facture.remise_plafond'").get();
  assert.deepEqual({ ...plafond }, { account_id: managerId, target: "FAC-2026-000001 (5\u202f000\u00a0FCFA)" }, "mineur 3 : montant groupé comme à l'écran");
  assert.deepEqual([auditAction("facture.remise_plafond", "fr"), auditAction("facture.emise", "en")], ["Remise au-delà du plafond approuvée", "Invoice issued"]);

  const own = await g("POST", "/api/sales", { ...body, request_id: "remise-plafond-2" });
  assert.deepEqual([own.status, own.body.code], [403, "confirmation"], "la gérante retape son propre mot de passe");
  await g("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await g("POST", "/api/sales", { ...body, request_id: "remise-plafond-2" })).status, 201);
});

/**
 * Retouche C (décision produit du 30/09/2026, M1 de la relecture
 * finale) : une remise de 100 %, comme toute remise au-delà du plafond,
 * demande l'approbation d'une gérante ; une fois approuvée, la vente à 0 F
 * s'émet sans aucun versement, journal compris. Un versement non nul sur
 * cette même vente à 0 F reste refusé.
 */
test("retouche C : remise de 100 % approuvée, vente à 0 F émise sans versement, journal à 0 F ; versement non nul toujours refusé", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { client, service } = await catalogue(g);
  const body = { request_id: "offerte-0001", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], discount: { kind: "percent", value: 100, reason: "geste" }, payments: [] };
  const asked = await r("POST", "/api/sales", body, FR);
  assert.deepEqual([asked.status, asked.body.code], [403, "approbation"], "remise de 100 % : au-delà du plafond, approbation demandée comme toute remise");
  const issued = await r("POST", "/api/sales", { ...body, approval: { login: "manager", password: "mot-de-passe-test" } });
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  assert.deepEqual(
    [issued.body.invoice.subtotal, issued.body.invoice.discount_amount, issued.body.invoice.total_ttc, issued.body.invoice.total_ht, issued.body.invoice.total_tva, issued.body.invoice.payments],
    [25000, 25000, 0, 0, 0, []],
    "facture à 0 F, aucun versement",
  );
  const journal = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'facture.emise'").all().map((row) => (row as { target: string }).target);
  assert.ok(journal.includes("FAC-2026-000001 (0\u00a0FCFA)"), "montant à 0 F au journal, groupé comme les autres (mineur 3)");

  // Un versement non nul sur cette même vente à 0 F reste refusé (versements différents du dû), comme aujourd'hui.
  const paye = await r("POST", "/api/sales", {
    request_id: "offerte-payee", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }],
    discount: { kind: "percent", value: 100, reason: "geste" }, payments: [{ method: "cash", amount: 500, cash_given: 500 }],
    approval: { login: "manager", password: "mot-de-passe-test" },
  });
  assert.deepEqual([paye.status, paye.body.code, paye.body.due], [409, "total", 0]);
});

test("réglages de la caisse : défauts de la spec, lus à l'émission et figés sur la facture ; valeurs contrôlées", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const { product } = await catalogue(g);
  assert.deepEqual((await r("GET", "/api/sales/settings")).body, { vat_active: true, vat_rate: 19.25, discounts: true, discount_cap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"], practitioner_checkout: false, avoirs_reception: false, deposits: false, printer: false, loyalty: { active: false, tiers: [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }] } });
  const first = (await r("POST", "/api/sales", { request_id: "tva-active-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] })).body.invoice;
  assert.equal((await g("PUT", "/api/settings/caisse.tva_active", { value: false })).status, 200);
  assert.equal((await g("PUT", "/api/settings/caisse.moyens", { value: ["cash"] })).status, 200);
  const second = await r("POST", "/api/sales", { request_id: "tva-inactive-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "cash", amount: 35000 }] });
  assert.deepEqual([second.body.invoice.total_ht, second.body.invoice.total_tva, second.body.invoice.fiscal.tva_active], [35000, 0, false]);
  assert.equal((await g("GET", `/api/invoices/${first.id}`)).body.invoice.fiscal.tva_active, true, "la facture garde les réglages de son émission");
  const card = await r("POST", "/api/sales", { request_id: "carte-retiree-1", lines: [{ kind: "product", ref_id: product, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] }, FR);
  assert.deepEqual([card.status, card.body.error], [400, "Moyen de paiement non proposé\u00a0: carte."]);
  for (const [key, value] of [["caisse.tva_taux", 19.255], ["caisse.tva_taux", 120], ["caisse.remise_plafond", 12.5], ["caisse.moyens", []], ["caisse.moyens", ["cheque"]], ["caisse.pourboires", "oui"]] as const) {
    assert.equal((await g("PUT", `/api/settings/${key}`, { value })).status, 400, `${key} = ${JSON.stringify(value)}`);
  }
  assert.equal((await g("PUT", "/api/settings/caisse.tva_taux", { value: 19.1 })).status, 200);
});

test("factures du jour et fiche d'une facture ; droits : ni la praticienne ni l'administrateur ne vendent", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { product } = await catalogue(g);
  const id = (await g("POST", "/api/sales", { request_id: "du-jour-0001", lines: [{ kind: "product", ref_id: product, quantity: 2 }], payments: [{ method: "momo", amount: 70000, reference: "MP-99" }] })).body.invoice.id;
  const list = (await g("GET", "/api/invoices?date=2026-09-28")).body.invoices;
  assert.deepEqual(list.map((i: Record<string, unknown>) => [i.number, i.total_ttc]), [["FAC-2026-000001", 70000]]);
  assert.deepEqual((await g("GET", "/api/invoices")).body.invoices.length, 1, "aujourd'hui à Douala par défaut");
  assert.deepEqual((await g("GET", "/api/invoices?date=2026-09-29")).body.invoices, []);
  assert.equal((await g("GET", "/api/invoices?date=hier")).status, 400);
  assert.equal((await g("GET", "/api/invoices?date=2026-02-31")).status, 400, "31 février : date impossible, pas un repli au 3 mars");
  assert.equal((await g("GET", `/api/invoices/${id}`)).body.invoice.payments[0].reference, "MP-99");
  assert.equal((await g("GET", "/api/invoices/999")).status, 404);
  // Produit retiré du catalogue après la vente : la facture garde sa désignation copiée.
  assert.equal((await g("DELETE", `/api/products/${product}`)).status, 200);
  assert.equal((await g("GET", `/api/invoices/${id}`)).body.invoice.lines[0].label_fr, "Crème hydratante");
  for (const role of ["practitioner", "admin"] as const) {
    const who = await ctx.as(role);
    assert.equal((await who("POST", "/api/sales", {})).status, 403, role);
    assert.equal((await who("GET", "/api/invoices")).status, 403, role);
    // Encaissement par la praticienne (vague 3) : elle lit les réglages de la vente pour savoir s'il est activé.
    assert.equal((await who("GET", "/api/sales/settings")).status, role === "practitioner" ? 200 : 403, role);
  }
});
