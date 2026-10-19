import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { rdvAvecSupplements, salon } from "../supplements/essais-supplements.ts";
import { setupApp } from "../test-support.ts";

/** Vente avec suppléments (spec du 18/10/2026 § 3.4 et § 3.5). */

const FR = { "Accept-Language": "fr" };

test("encaisser un rendez-vous avec suppléments : lignes rattachées, praticienne de la prestation, stock déduit, prix relu par le serveur", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const s = await salon(g);
  const { apt, lines } = await rdvAvecSupplements(g, s);
  // Prix changé après la prise du rendez-vous : la caisse facture celui du moment, jamais celui envoyé par l'appareil.
  assert.equal((await g("PUT", `/api/services/${s.meches}`, { price: 6000 })).status, 200);
  const envoyees = lines.map((l) => (l.kind === "product" ? { ...l, unit_price: 1 } : l));
  const sale = await r("POST", "/api/sales", {
    request_id: "supplements-0001", client_id: s.client, appointment_id: apt, lines: envoyees, payments: [{ method: "cash", amount: 25000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const inv = sale.body.invoice;
  assert.equal(inv.total_ttc, 25000, "15 000 + 6 000 + 2 × 500 + 3 000");
  const premiere = inv.lines[0].id as number;
  assert.deepEqual(inv.lines.map((l: Record<string, unknown>) => [l.kind, l.ref_id, l.label_fr, l.quantity, l.unit_price, l.staff_id, l.parent_line_id]), [
    ["service", s.tresses, "Tresses", 1, 15000, s.staff, null],
    ["service", s.meches, "Mèches", 1, 6000, s.staff, premiere],
    ["product", s.perles, "Perles", 2, 500, s.staff, premiere],
    ["libre", null, "Perles dorées", 1, 3000, s.staff, premiere],
  ]);
  assert.equal((await g("GET", `/api/products/${s.perles}`)).body.product.stock, 48, "le produit en supplément sort du stock");
  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.status, "completed");
  const journal = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'supplement.libre' AND target LIKE 'FAC-%'").all().map((row) => (row as { target: string }).target);
  assert.deepEqual(journal, [`${inv.number} · 3\u202f000\u00a0FCFA · Perles dorées`]);
  // Même libellé au journal pour un rendez-vous et une facture.
  assert.deepEqual([auditAction("supplement.libre", "fr"), auditAction("supplement.libre", "en")], ["Supplément libre", "Custom add-on"]);

  const again = await r("POST", "/api/sales", { request_id: "supplements-0001", client_id: s.client, appointment_id: apt, lines: envoyees, payments: [{ method: "cash", amount: 25000 }] });
  assert.equal(again.status, 200);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'supplement.libre' AND target LIKE 'FAC-%'").get() as { n: number }).n, 1, "un rejeu n'écrit rien de plus");
});

test("refus : « supplément seulement » vendu seul, supplément sans sa prestation, supplément libre hors bornes ; aucune facture écrite", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const tresses = { kind: "service", ref_id: s.tresses, quantity: 1, staff_id: s.staff };
  const libre = { kind: "libre", label: "Perles dorées", unit_price: 3000, quantity: 1, parent: 0 };
  const refus: [unknown[], string][] = [
    [[{ kind: "service", ref_id: s.meches, quantity: 1, staff_id: s.staff }], "«\u00a0Mèches\u00a0» ne se vend qu'en supplément d'une prestation."],
    [[tresses, { ...libre, parent: undefined }], "Un supplément doit suivre sa prestation sur le ticket."],
    [[{ kind: "product", ref_id: s.perles, quantity: 1 }, libre], "Un supplément doit suivre sa prestation sur le ticket."],
    [[tresses, { kind: "product", ref_id: s.perles, quantity: 1, parent: 0 }, { ...libre, parent: 1 }], "Un supplément doit suivre sa prestation sur le ticket."],
    [[{ ...libre, parent: 1 }, tresses], "Ligne du ticket invalide."],
    [[tresses, { ...libre, label: "x".repeat(81) }], "Libellé du supplément libre obligatoire, 80 caractères au plus."],
    [[tresses, { ...libre, unit_price: -1 }], "Prix du supplément libre\u00a0: montant de 0 ou plus."],
    [[tresses, { ...libre, quantity: 2 }], "Ligne du ticket invalide."],
    [[tresses, { kind: "service", ref_id: s.meches, quantity: 2, parent: 0 }], "Ligne du ticket invalide."],
  ];
  for (const [lines, error] of refus) {
    const res = await g("POST", "/api/sales", { request_id: "refus-supplement-1", client_id: s.client, lines, payments: [{ method: "cash", amount: 18000 }] }, FR);
    assert.deepEqual([res.status, res.body.error], [400, error], JSON.stringify(lines).slice(0, 80));
  }
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
});

test("praticienne et supplément libre : celui de son rendez-vous s'encaisse, un autre est refusé", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  const s = await salon(g);
  const own = (ctx.db.prepare("SELECT staff_id FROM accounts WHERE login = 'practitioner'").get() as { staff_id: number }).staff_id;
  assert.equal((await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true })).status, 200);
  const premier = await rdvAvecSupplements(g, s, own, "10:00");
  const second = await rdvAvecSupplements(g, s, own, "14:00");
  for (const id of [premier.apt, second.apt]) await g("PUT", `/api/appointments/${id}`, { status: "in_progress" });
  const vente = (apt: number, lines: unknown[], request_id: string, amount: number) =>
    p("POST", "/api/sales", { request_id, client_id: s.client, appointment_id: apt, lines, payments: [{ method: "cash", amount }] }, FR);
  assert.equal((await vente(premier.apt, premier.lines, "praticienne-supp-1", 24000)).status, 201);
  const inventee = second.lines.map((l) => (l.kind === "libre" ? { ...l, unit_price: 1 } : l));
  const refus = await vente(second.apt, inventee, "praticienne-supp-2", 21001);
  assert.deepEqual([refus.status, refus.body.error], [403, "Une praticienne n'ajoute pas de supplément libre à la caisse\u00a0: seuls ceux du rendez-vous s'encaissent."]);
});

test("rendez-vous pris avant le passage de sa prestation en « supplément seulement » : il s'encaisse ; la prestation seule sans rendez-vous reste refusée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const frange = (await g("POST", "/api/services", { name: "Frange", duration: 30, price: 4000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: s.client, staff_id: s.staff, scheduled_date: "2026-10-05", start_time: "10:00", service_ids: [frange] })).body.appointment.id as number;
  assert.equal((await g("PUT", `/api/services/${frange}`, { supplement_seulement: 1 })).status, 200);
  const lines = [{ kind: "service", ref_id: frange, quantity: 1, staff_id: s.staff }];
  const seule = await g("POST", "/api/sales", { request_id: "frange-seule-01", client_id: s.client, lines, payments: [{ method: "cash", amount: 4000 }] }, FR);
  assert.deepEqual([seule.status, seule.body.error], [400, "«\u00a0Frange\u00a0» ne se vend qu'en supplément d'une prestation."]);
  const autre = (await g("POST", "/api/appointments", { client_id: s.client, staff_id: s.staff, scheduled_date: "2026-10-05", start_time: "14:00", service_ids: [s.tresses] })).body.appointment.id as number;
  const ailleurs = await g("POST", "/api/sales", { request_id: "frange-autre-01", client_id: s.client, appointment_id: autre, lines, payments: [{ method: "cash", amount: 4000 }] }, FR);
  assert.equal(ailleurs.status, 400, "un rendez-vous qui ne la porte pas ne l'ouvre pas");
  const voisine = (ctx.db.prepare("INSERT INTO clients (name, phone) VALUES ('Cliente voisine', '+237690000999')").run().lastInsertRowid) as number;
  const autreCliente = await g("POST", "/api/sales", { request_id: "frange-voisine-01", client_id: Number(voisine), appointment_id: apt, lines, payments: [{ method: "cash", amount: 4000 }] }, FR);
  assert.equal(autreCliente.status, 400, "le rendez-vous d'une autre cliente ne l'ouvre pas");
  const vente = await g("POST", "/api/sales", { request_id: "frange-rdv-0001", client_id: s.client, appointment_id: apt, lines, payments: [{ method: "cash", amount: 4000 }] }, FR);
  assert.equal(vente.status, 201, JSON.stringify(vente.body));
});

test("supplément de type prestation : jamais elle-même sous elle-même, jamais une prestation qui a sa propre liste (sauf portée par le rendez-vous)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const sous = (ref: number, parent: number) => [{ kind: "service", ref_id: parent, quantity: 1, staff_id: s.staff }, { kind: "service", ref_id: ref, quantity: 1, parent: 0 }];
  const vendre = (lines: unknown[], request_id: string, appointment_id: number | null = null, amount = 30000) =>
    g("POST", "/api/sales", { request_id, client_id: s.client, appointment_id, lines, payments: [{ method: "cash", amount }] }, FR);
  const lui = await vendre(sous(s.tresses, s.tresses), "lui-meme-0001");
  assert.deepEqual([lui.status, lui.body.error], [400, "Une prestation ne peut pas être son propre supplément."]);
  const liste = await vendre(sous(s.soin, s.tresses), "a-une-liste-01");
  assert.equal(liste.status, 400);
  assert.match(liste.body.error, /Soin du visage/);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM invoices").get() as { n: number }).n, 0);
  // Rendez-vous pris quand Frange n'avait pas encore sa liste : il reste encaissable.
  const frange = (await g("POST", "/api/services", { name: "Frange", duration: 30, price: 4000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", {
    client_id: s.client, staff_id: s.staff, scheduled_date: "2026-10-05", start_time: "10:00", service_ids: [s.tresses],
    supplements: [{ service_index: 0, kind: "service", ref_id: frange }],
  })).body.appointment.id as number;
  assert.equal((await g("PUT", `/api/services/${frange}/supplements`, { items: [{ kind: "product", ref_id: s.perles }] })).status, 200);
  const vente = await vendre(sous(frange, s.tresses), "frange-liste-01", apt, 19000);
  assert.equal(vente.status, 201, JSON.stringify(vente.body));
  assert.equal((await vendre(sous(frange, s.tresses), "frange-liste-02", null, 19000)).status, 400, "sans le rendez-vous, refusée");
});
