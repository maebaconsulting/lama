import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "./test-support.ts";

test("prestations : versions anglaises facultatives, créées, modifiées et renvoyées", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const soin = await g("POST", "/api/services", {
    name: "Soin du visage", name_en: "Facial", description: "Nettoyage de peau", description_en: "Skin cleansing",
    category: "Visage", category_en: "Face", duration: 60, price: 15000,
  });
  assert.equal(soin.status, 201);
  assert.equal(soin.body.service.name_en, "Facial");
  const epilation = await g("POST", "/api/services", { name: "Épilation", duration: 30, price: 5000 });
  assert.equal(epilation.body.service.name_en, "", "sans version anglaise : texte vide");
  assert.equal((await g("PUT", `/api/services/${epilation.body.service.id}`, { category_en: "Waxing" })).status, 200);
  const list = await g("GET", "/api/services");
  const byName = Object.fromEntries(list.body.services.map((s: { name: string }) => [s.name, s]));
  assert.equal(byName["Soin du visage"].description_en, "Skin cleansing");
  assert.equal(byName["Épilation"].category_en, "Waxing");
  assert.equal(byName["Épilation"].name_en, "");
});

test("produits : versions anglaises et recherche par le nom français ou anglais (spec § 5.2)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const created = await g("POST", "/api/products", { name: "Beurre de karité", name_en: "Shea butter", category: "Corps", category_en: "Body", price: 5000 });
  assert.equal(created.status, 201);
  assert.equal(created.body.product.category_en, "Body");
  for (const search of ["karité", "Shea", "shea butter"]) {
    assert.equal((await g("GET", `/api/products?search=${encodeURIComponent(search)}`)).body.total, 1, search);
  }
  assert.equal((await g("GET", "/api/products?search=argan")).body.total, 0);
});

test("la réception ne modifie toujours que le stock d'un produit", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const id = (await g("POST", "/api/products", { name: "Beurre de karité", price: 5000, stock: 2 })).body.product.id;
  const reception = await ctx.as("reception");
  assert.equal((await reception("PUT", `/api/products/${id}`, { name_en: "Shea", stock: 5 })).status, 200);
  assert.deepEqual({ ...(ctx.db.prepare("SELECT name_en, stock FROM products WHERE id = ?").get(id) as object) }, { name_en: "", stock: 5 });
});

test("équipe : fonction en anglais facultative", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const created = await g("POST", "/api/staff", { name: "Aïcha", title: "Esthéticienne", title_en: "Beautician" });
  assert.equal(created.body.staff.title_en, "Beautician");
  assert.equal((await g("PUT", `/api/staff/${created.body.staff.id}`, { title_en: "Senior beautician" })).status, 200);
  assert.equal((await g("GET", "/api/staff")).body.staff[0].title_en, "Senior beautician");
});

test("rendez-vous : nom anglais des prestations, brut dans l'agenda et la fiche, avec repli dans l'historique de la cliente", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const soin = (await g("POST", "/api/services", { name: "Soin du visage", name_en: "Facial", duration: 60, price: 15000 })).body.service.id;
  const epil = (await g("POST", "/api/services", { name: "Épilation", duration: 30, price: 5000 })).body.service.id;
  const client = (await g("POST", "/api/clients", { name: "Brenda Nkeng" })).body.client.id;
  const created = await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-09-28", start_time: "10:00", service_ids: [soin, epil] });
  assert.equal(created.status, 201);
  const id = created.body.appointment.id;
  const detail = (await g("GET", `/api/appointments/${id}`)).body.appointment;
  assert.deepEqual(detail.appointment_services.map((s: { service_name: string; service_name_en: string }) => [s.service_name, s.service_name_en]),
    [["Soin du visage", "Facial"], ["Épilation", ""]]);
  const calendar = (await g("GET", "/api/calendar?start=2026-09-28&end=2026-09-28")).body.appointments[0];
  assert.equal(calendar.appointment_services[0].service_name_en, "Facial");
  const history = (await g("GET", `/api/clients/${client}`)).body.appointments[0];
  assert.equal(history.service_names, "Soin du visage, Épilation");
  assert.equal(history.service_names_en, "Facial, Épilation");
});
