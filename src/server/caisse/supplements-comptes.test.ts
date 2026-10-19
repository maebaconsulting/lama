import assert from "node:assert/strict";
import { test } from "node:test";
import { rdvAvecSupplements, salon } from "../supplements/essais-supplements.ts";
import { setupApp } from "../test-support.ts";

/**
 * Comptes (spec du 18/10/2026 § 3.5) : la clôture et le tableau de bord ne séparent pas prestations
 * et produits ; les suppléments y comptent par le total de la facture et le total prévu du rendez-vous.
 * La fiche cliente compte les produits en supplément parmi ses achats, jamais un supplément libre ;
 * chaque supplément porte la praticienne de sa prestation.
 */
test("une vente avec suppléments : clôture, tableau de bord, achats de la fiche cliente, ticket PDF", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const { apt, lines } = await rdvAvecSupplements(g, s);
  assert.equal((await g("GET", `/api/appointments/${apt}`)).body.appointment.total_price, 24000, "total prévu, suppléments compris");
  const day = (await g("GET", `/api/appointments/${apt}`)).body.appointment.scheduled_date as string;
  ctx.clock.now = Date.parse(`${day}T09:00:00Z`);
  const inv = (await g("POST", "/api/sales", { request_id: "comptes-supp-0001", client_id: s.client, appointment_id: apt, lines, payments: [{ method: "cash", amount: 24000 }] })).body.invoice;
  assert.equal(inv.total_ttc, 24000);

  const caisse = (await g("GET", `/api/cash/day?date=${day}`)).body;
  assert.equal(caisse.open.summary.invoices.total, 24000, "clôture : le total de la facture, suppléments compris");
  assert.equal((await g("GET", "/api/stats")).body.revenue, 24000, "tableau de bord : total prévu du rendez-vous terminé");

  const fiche = (await g("GET", `/api/clients/${s.client}`)).body.summary;
  assert.deepEqual(fiche.products.map((p: { label_fr: string; quantity: number }) => [p.label_fr, p.quantity]), [["Perles", 2]], "produit en supplément acheté ; supplément libre absent");
  assert.ok(inv.lines.every((l: { staff_id: number }) => l.staff_id === s.staff), "chaque ligne compte pour la praticienne de la prestation");

  const pdf = await g("GET", `/api/invoices/${inv.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("Content-Type"), "application/pdf");
});
