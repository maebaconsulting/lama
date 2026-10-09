import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { daysSince } from "./synthese.ts";

/**
 * Synthèse de la fiche cliente (mini CRM § 1, décisions 5 à 9) : visites
 * (rendez-vous terminés), absence en jours de Douala, prochain rendez-vous,
 * habitudes, achats nets des avoirs, total dépensé et panier moyen ; montants
 * retirés pour la praticienne.
 */

const cash = (amount: number) => [{ method: "cash", amount }];

test("absence en jours entiers de Douala : à 00:30 à Douala, le jour suivant compte déjà ; jamais négative", () => {
  assert.equal(daysSince("2026-09-10", Date.parse("2026-09-28T08:00:00Z")), 18);
  assert.equal(daysSince("2026-09-10", Date.parse("2026-09-28T22:59:00Z")), 18, "23:59 à Douala");
  assert.equal(daysSince("2026-09-10", Date.parse("2026-09-28T23:30:00Z")), 19, "00:30 à Douala");
  assert.equal(daysSince("2026-09-30", Date.parse("2026-09-28T08:00:00Z")), 0);
});

test("synthèse : visites, habitudes, achats et montants nets des avoirs ; la praticienne sans aucun montant", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const solange = (await g("POST", "/api/staff", { name: "Solange Ekambi", color: "#4A5D73" })).body.staff.id as number;
  const grace = (await g("POST", "/api/staff", { name: "Grace Nkeng" })).body.staff.id as number;
  const soin = (await g("POST", "/api/services", { name: "Soin du visage", name_en: "Facial", duration: 60, price: 25000 })).body.service.id as number;
  const massage = (await g("POST", "/api/services", { name: "Massage", duration: 30, price: 15000 })).body.service.id as number;
  const brushing = (await g("POST", "/api/services", { name: "Brushing", duration: 45, price: 7000 })).body.service.id as number;
  const creme = (await g("POST", "/api/products", { name: "Crème éclat", name_en: "Glow cream", price: 35000, stock: 5 })).body.product.id as number;
  const huile = (await g("POST", "/api/products", { name: "Huile de coco", price: 4000, stock: 10 })).body.product.id as number;
  const aicha = (await g("POST", "/api/clients", { name: "Aïcha Mbarga" })).body.client.id as number;

  const book = async (date: string, staff: number, services: number[], status?: string) => {
    const res = await g("POST", "/api/appointments", { client_id: aicha, staff_id: staff, scheduled_date: date, start_time: "10:00", service_ids: services, allow_conflict: true });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    if (status) assert.equal((await g("PUT", `/api/appointments/${res.body.appointment.id}`, { status })).status, 200);
    return res.body.appointment.id as number;
  };
  const sell = async (requestId: string, body: Record<string, unknown>) => {
    const res = await g("POST", "/api/sales", { request_id: requestId, client_id: aicha, ...body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ctx.clock.now += 60_000;
    return res.body.invoice as { id: number; issued_at: number; lines: { id: number }[] };
  };
  const credit = async (requestId: string, invoice: { id: number; lines: { id: number }[] }, amount: number) => {
    const res = await g("POST", "/api/credit-notes", {
      request_id: requestId, invoice_id: invoice.id, reason: "Produit rendu",
      lines: [{ line_id: invoice.lines[0].id, quantity: 1, restock: true }], refunds: cash(amount),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  };

  const apt1 = await book("2026-07-10", solange, [soin]);
  await book("2026-08-01", solange, [soin, brushing], "completed");
  await book("2026-08-20", grace, [massage], "completed");
  const apt4 = await book("2026-09-10", solange, [soin]);
  await book("2026-09-20", solange, [soin], "no_show");
  const next = await book("2026-10-05", grace, [massage]);
  await sell("synthese-0001", { appointment_id: apt1, lines: [{ kind: "service", ref_id: soin, quantity: 1, staff_id: solange }], payments: cash(25000) });
  const withCream = await sell("synthese-0002", {
    appointment_id: apt4,
    lines: [{ kind: "service", ref_id: soin, quantity: 1, staff_id: solange }, { kind: "product", ref_id: creme, quantity: 2 }],
    payments: cash(95000),
  });
  const oil = await sell("synthese-0003", { lines: [{ kind: "product", ref_id: huile, quantity: 3 }], payments: cash(12000) });
  const cancelled = await sell("synthese-0004", { lines: [{ kind: "product", ref_id: huile, quantity: 1 }], payments: cash(4000) });
  await credit("synthese-av-0001", oil, 4000);
  await credit("synthese-av-0002", cancelled, 4000);

  const res = await g("GET", `/api/clients/${aicha}`);
  assert.equal(res.status, 200);
  const s = res.body.summary;
  assert.equal(s.visits, 4, "terminés seulement : ni l'absence ni le rendez-vous à venir");
  assert.equal(s.last_visit, "2026-09-10");
  assert.equal(s.days_since, 18);
  assert.deepEqual(s.next_appointment, { id: next, date: "2026-10-05", time: "10:00" });
  assert.deepEqual(s.usual_services, [
    { name: "Soin du visage", name_en: "Facial", count: 3 },
    { name: "Brushing", name_en: "", count: 1 },
    { name: "Massage", name_en: "", count: 1 },
  ]);
  assert.deepEqual(s.favorite_staff, { id: solange, name: "Solange Ekambi", color: "#4A5D73", count: 3 });
  assert.deepEqual(s.products, [
    { label_fr: "Huile de coco", label_en: "", quantity: 2, last: oil.issued_at },
    { label_fr: "Crème éclat", label_en: "Glow cream", quantity: 2, last: withCream.issued_at },
  ], "quantités nettes des avoirs ; la facture entièrement reprise n'est pas le dernier achat");
  assert.equal(s.total_spent, 25000 + 95000 + 12000 - 4000, "factures moins avoirs");
  assert.equal(s.invoice_count, 3, "la facture entièrement reprise n'est pas comptée");
  assert.equal(s.average_basket, Math.round(128000 / 3));
  assert.equal(s.loyalty, null);

  const praticienne = await ctx.as("practitioner");
  const vue = (await praticienne("GET", `/api/clients/${aicha}`)).body.summary;
  assert.equal(vue.visits, 4);
  assert.deepEqual(vue.usual_services.map((x: { name: string }) => x.name), ["Soin du visage", "Brushing", "Massage"]);
  for (const key of ["total_spent", "average_basket", "invoice_count"]) assert.ok(!(key in vue), `${key} retiré pour la praticienne`);
  assert.equal(vue.loyalty, null);
});

test("synthèse d'une cliente jamais venue, et praticienne préférée seulement à partir de deux visites", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const staff = (await g("POST", "/api/staff", { name: "Grace" })).body.staff.id as number;
  const service = (await g("POST", "/api/services", { name: "Massage", duration: 30, price: 15000 })).body.service.id as number;
  const nouvelle = (await g("POST", "/api/clients", { name: "Florence" })).body.client.id as number;
  assert.deepEqual((await g("GET", `/api/clients/${nouvelle}`)).body.summary, {
    visits: 0, last_visit: null, days_since: null, next_appointment: null, usual_services: [], favorite_staff: null, products: [],
    total_spent: 0, average_basket: 0, invoice_count: 0, loyalty: null,
  });
  const brenda = (await g("POST", "/api/clients", { name: "Brenda" })).body.client.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: brenda, staff_id: staff, scheduled_date: "2026-09-01", start_time: "10:00", service_ids: [service] })).body.appointment.id;
  await g("PUT", `/api/appointments/${apt}`, { status: "completed" });
  const s = (await g("GET", `/api/clients/${brenda}`)).body.summary;
  assert.equal(s.visits, 1);
  assert.equal(s.favorite_staff, null, "une seule visite avec elle");
  assert.equal((await g("GET", "/api/clients/999")).status, 404);
});
