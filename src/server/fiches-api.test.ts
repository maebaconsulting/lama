import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

/**
 * Serveur de la vague 4 (sous-projet 4 § 6, décisions du 29/09/2026) :
 * dernière visite et nombre de visites des clientes, recherche insensible aux
 * accents (clientes et produits), fiche d'un produit, suppression refusée à
 * qui a un historique.
 */

test("clientes : dernière visite et nombre de visites, comptés sur les rendez-vous terminés seulement", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const aicha = (await g("POST", "/api/clients", { name: "Aïcha Mbarga" })).body.client.id;
  const brenda = (await g("POST", "/api/clients", { name: "Brenda Nkeng" })).body.client.id;
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id;
  const service = (await g("POST", "/api/services", { name: "Soin", duration: 60, price: 10000 })).body.service.id;
  const book = async (client: number, date: string, status: string) => {
    const id = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: date, start_time: "10:00", service_ids: [service], allow_conflict: true })).body.appointment.id;
    if (status !== "booked") assert.equal((await g("PUT", `/api/appointments/${id}`, { status })).status, 200);
  };
  await book(aicha, "2026-08-02", "completed");
  await book(aicha, "2026-09-10", "completed");
  await book(aicha, "2026-09-20", "no_show");
  await book(aicha, "2026-10-05", "booked");
  const list = (await g("GET", "/api/clients")).body.clients as { id: number; last_visit: string | null; visit_count: number; appointment_count: number }[];
  const a = list.find((c) => c.id === aicha)!;
  assert.equal(a.last_visit, "2026-09-10", "absente et à venir ne sont pas des visites");
  assert.equal(a.visit_count, 2);
  assert.equal(a.appointment_count, 4, "le compteur d'origine ne change pas");
  const b = list.find((c) => c.id === brenda)!;
  assert.equal(b.last_visit, null, "jamais venue");
  assert.equal(b.visit_count, 0);
  const fiche = (await g("GET", `/api/clients/${aicha}`)).body.client;
  assert.equal(fiche.last_visit, "2026-09-10");
  assert.equal(fiche.visit_count, 2);
});

test("recherche des clientes et des produits insensible aux accents et à la casse, dans les deux sens", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "+237 6 77 12 34 56" });
  await g("POST", "/api/clients", { name: "Hélène Ékambi" });
  for (const [search, count] of [["aicha", 1], ["AÏCHA", 1], ["helene", 1], ["ekambi", 1], ["Hélène", 1], ["6 77 12", 1], ["zoé", 0]] as const) {
    assert.equal((await g("GET", `/api/clients?search=${encodeURIComponent(search)}`)).body.total, count, search);
  }
  await g("POST", "/api/products", { name: "Crème éclat", name_en: "Glow cream", brand: "Kérastase", price: 5000 });
  for (const [search, count] of [["creme", 1], ["ÉCLAT", 1], ["glow", 1], ["kerastase", 1], ["argan", 0]] as const) {
    assert.equal((await g("GET", `/api/products?search=${encodeURIComponent(search)}`)).body.total, count, search);
  }
});

test("fiche d'un produit : lue par son identifiant, introuvable dite", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const id = (await g("POST", "/api/products", { name: "Beurre de karité", price: 5000, stock: 3 })).body.product.id;
  const res = await g("GET", `/api/products/${id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.product.name, "Beurre de karité");
  assert.equal(res.body.product.stock, 3);
  const praticienne = await ctx.as("practitioner");
  assert.equal((await praticienne("GET", `/api/products/${id}`)).status, 200, "lecture ouverte à l'équipe");
  assert.equal((await g("GET", "/api/products/999")).status, 404);
});

test("suppression refusée à qui a un historique : cliente, prestation, membre avec rendez-vous ou compte relié ; sans historique, supprimée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const client = (await g("POST", "/api/clients", { name: "Aïcha" })).body.client.id;
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id;
  const service = (await g("POST", "/api/services", { name: "Soin", duration: 60, price: 10000 })).body.service.id;
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-10", start_time: "10:00", service_ids: [service] })).body.appointment.id;

  const fr = { "Accept-Language": "fr" };
  const refusedClient = await g("DELETE", `/api/clients/${client}`, undefined, fr);
  assert.equal(refusedClient.status, 409);
  assert.equal(refusedClient.body.error, "Cette cliente a des rendez-vous\u00a0: sa fiche est gardée pour son historique.");
  assert.equal((await g("DELETE", `/api/services/${service}`, undefined, fr)).body.error, "Cette prestation figure dans des rendez-vous\u00a0: désactivez-la plutôt.");
  assert.equal((await g("DELETE", `/api/staff/${staff}`, undefined, fr)).body.error, "Ce membre de l'équipe a des rendez-vous\u00a0: désactivez sa fiche plutôt.");
  assert.equal((await g("DELETE", `/api/staff/${staff}`)).body.error, "This staff member has appointments: deactivate the record instead.", "anglais sans en-tête");
  assert.equal((await g("GET", `/api/appointments/${apt}`)).status, 200, "l'historique est intact");

  const alone = (await g("POST", "/api/staff", { name: "Awa" })).body.staff.id;
  await ctx.seedAccount("practitioner", "awa", { staff_id: alone });
  assert.equal((await g("DELETE", `/api/staff/${alone}`, undefined, fr)).body.error, "Un compte est relié à ce membre de l'équipe\u00a0: désactivez sa fiche plutôt.");

  const nouvelle = (await g("POST", "/api/clients", { name: "Brenda" })).body.client.id;
  const libre = (await g("POST", "/api/services", { name: "Libre", duration: 30, price: 5000 })).body.service.id;
  const vide = (await g("POST", "/api/staff", { name: "Mireille" })).body.staff.id;
  assert.equal((await g("DELETE", `/api/clients/${nouvelle}`)).status, 200);
  assert.equal((await g("DELETE", `/api/services/${libre}`)).status, 200);
  assert.equal((await g("DELETE", `/api/staff/${vide}`)).status, 200);
});

test("prestations : appointment_count par prestation (rendez-vous dans lesquels elle figure), pour ne pas proposer « Supprimer » sur une prestation utilisée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const client = (await g("POST", "/api/clients", { name: "Aïcha" })).body.client.id;
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id;
  const used = (await g("POST", "/api/services", { name: "Soin", duration: 60, price: 10000 })).body.service.id;
  const unused = (await g("POST", "/api/services", { name: "Massage", duration: 30, price: 5000 })).body.service.id;
  await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-10", start_time: "10:00", service_ids: [used] });
  const list = (await g("GET", "/api/services")).body.services as { id: number; appointment_count: number }[];
  assert.equal(list.find((s) => s.id === used)!.appointment_count, 1, "utilisée dans un rendez-vous");
  assert.equal(list.find((s) => s.id === unused)!.appointment_count, 0, "jamais utilisée");
});
