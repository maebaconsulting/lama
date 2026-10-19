import assert from "node:assert/strict";
import { test } from "node:test";
import { rdvAvecSupplements, salon } from "../supplements/essais-supplements.ts";
import { setupApp, type Caller } from "../test-support.ts";

/** Avoir sur une facture avec suppléments (spec du 18/10/2026 § 3.5). */

const FR = { "Accept-Language": "fr" };

async function venteAvecSupplements(g: Caller) {
  const s = await salon(g);
  const { apt, lines } = await rdvAvecSupplements(g, s);
  const inv = (await g("POST", "/api/sales", { request_id: "avoir-supp-0001", client_id: s.client, appointment_id: apt, lines, payments: [{ method: "cash", amount: 24000 }] })).body.invoice;
  const [tresses, meches, perles, libre] = (inv.lines as { id: number }[]).map((l) => l.id);
  return { s, apt, inv, tresses, meches, perles, libre };
}

test("avoir d'une prestation avec ses suppléments : rattachement gardé, produit remis en stock, facture annulée, suppléments de nouveau modifiables", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { s, apt, inv, tresses, meches, perles, libre } = await venteAvecSupplements(g);
  const note = await g("POST", "/api/credit-notes", {
    request_id: "avoir-supp-n001", invoice_id: inv.id, reason: "Erreur de saisie",
    lines: [{ line_id: tresses, quantity: 1 }, { line_id: meches, quantity: 1 }, { line_id: perles, quantity: 2, restock: true }, { line_id: libre, quantity: 1 }],
    refunds: [{ method: "cash", amount: 24000 }],
  });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  const lignes = note.body.credit_note.lines as { id: number; kind: string; ref_id: number | null; label_fr: string; parent_line_id: number | null; credited_line_id: number }[];
  const tete = lignes[0].id;
  assert.deepEqual(lignes.map((l) => [l.kind, l.label_fr, l.credited_line_id, l.parent_line_id]), [
    ["service", "Tresses", tresses, null],
    ["service", "Mèches", meches, tete],
    ["product", "Perles", perles, tete],
    ["libre", "Perles dorées", libre, tete],
  ]);
  assert.equal(lignes[3].ref_id, null);
  assert.equal(note.body.credit_note.total_ttc, 24000);
  assert.equal((await g("GET", `/api/products/${s.perles}`)).body.product.stock, 50, "les deux perles reviennent en stock");
  assert.equal((await g("GET", `/api/invoices/${inv.id}`)).body.invoice.cancelled, true);
  const row = (await g("GET", `/api/appointments/${apt}`)).body.appointment.appointment_services[0].id as number;
  assert.equal((await g("PUT", `/api/appointments/${apt}/supplements`, { supplements: [{ appointment_service_id: row, kind: "product", ref_id: s.perles }] })).status, 200,
    "facture entièrement reprise : le rendez-vous redevient modifiable");
});

test("avoir d'un supplément seul : aucun rattachement, stock rendu, facture toujours active ; un supplément libre ne se remet pas en stock", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { s, inv, perles, libre } = await venteAvecSupplements(g);
  const avoir = (request_id: string, lines: unknown[], amount: number) =>
    g("POST", "/api/credit-notes", { request_id, invoice_id: inv.id, reason: "Retour", lines, refunds: [{ method: "cash", amount }] }, FR);
  const produit = await avoir("avoir-supp-n101", [{ line_id: perles, quantity: 1, restock: true }], 500);
  assert.equal(produit.status, 201, JSON.stringify(produit.body));
  assert.deepEqual(produit.body.credit_note.lines.map((l: { kind: string; parent_line_id: number | null }) => [l.kind, l.parent_line_id]), [["product", null]]);
  assert.equal((await g("GET", `/api/products/${s.perles}`)).body.product.stock, 49);
  const stock = await avoir("avoir-supp-n102", [{ line_id: libre, quantity: 1, restock: true }], 3000);
  assert.equal(stock.status, 400, "remise en stock d'un supplément libre refusée");
  const seul = await avoir("avoir-supp-n103", [{ line_id: libre, quantity: 1 }], 3000);
  assert.equal(seul.status, 201, JSON.stringify(seul.body));
  assert.deepEqual(seul.body.credit_note.lines.map((l: { kind: string; ref_id: number | null; parent_line_id: number | null }) => [l.kind, l.ref_id, l.parent_line_id]), [["libre", null, null]]);
  assert.equal((await g("GET", `/api/invoices/${inv.id}`)).body.invoice.cancelled, false);
});

test("supplément repris sans sa prestation : chaque supplément repris se rattache à sa propre prestation, sinon à aucune", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const inv = (await g("POST", "/api/sales", {
    request_id: "avoir-supp-0002", client_id: s.client,
    lines: [
      { kind: "service", ref_id: s.tresses, quantity: 1, staff_id: s.staff },
      { kind: "product", ref_id: s.perles, quantity: 1, staff_id: null, parent: 0 },
      { kind: "service", ref_id: s.soin, quantity: 1, staff_id: s.staff },
      { kind: "service", ref_id: s.masque, quantity: 1, staff_id: null, parent: 2 },
    ],
    payments: [{ method: "cash", amount: 39500 }],
  })).body.invoice;
  const [tresses, perles, soin, masque] = (inv.lines as { id: number }[]).map((l) => l.id);
  const avoir = (request_id: string, lines: unknown[], amount: number) =>
    g("POST", "/api/credit-notes", { request_id, invoice_id: inv.id, reason: "Retour", lines, refunds: [{ method: "cash", amount }] }, FR);
  // Le masque est repris avec la première prestation seulement : il ne s'y rattache pas, il n'a pas la sienne dans l'avoir.
  const premier = await avoir("avoir-supp-n201", [{ line_id: tresses, quantity: 1 }, { line_id: masque, quantity: 1 }, { line_id: perles, quantity: 1 }], 19500);
  assert.equal(premier.status, 201, JSON.stringify(premier.body));
  const l1 = premier.body.credit_note.lines as { id: number; label_fr: string; parent_line_id: number | null }[];
  assert.deepEqual(l1.map((l) => [l.label_fr, l.parent_line_id]), [["Tresses", null], ["Perles", l1[0].id], ["Masque", null]],
    "ordre de la facture, rattachement à la prestation d'origine seulement");
  const second = await avoir("avoir-supp-n202", [{ line_id: soin, quantity: 1 }], 20000);
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.deepEqual(second.body.credit_note.lines.map((l: { parent_line_id: number | null }) => l.parent_line_id), [null]);
});

test("plafond d'un supplément sur plusieurs avoirs : 1 perle, puis 2 refusées, puis la restante ; le stock remonte de 2", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { s, inv, perles } = await venteAvecSupplements(g);
  assert.equal((await g("GET", `/api/products/${s.perles}`)).body.product.stock, 48, "deux perles vendues");
  const avoir = (request_id: string, quantity: number, amount: number) =>
    g("POST", "/api/credit-notes", { request_id, invoice_id: inv.id, reason: "Retour", lines: [{ line_id: perles, quantity, restock: true }], refunds: [{ method: "cash", amount }] }, FR);
  assert.equal((await avoir("avoir-supp-n301", 1, 500)).status, 201);
  const trop = await avoir("avoir-supp-n302", 2, 1000);
  assert.equal(trop.status, 409, JSON.stringify(trop.body));
  assert.equal((await g("GET", `/api/products/${s.perles}`)).body.product.stock, 49, "le refus ne touche pas au stock");
  assert.equal((await avoir("avoir-supp-n303", 1, 500)).status, 201);
  assert.equal((await g("GET", `/api/products/${s.perles}`)).body.product.stock, 50);
});

test("facture remisée avec supplément : avoir du supplément seul puis du reste, somme des avoirs égale au total, facture annulée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const sale = await g("POST", "/api/sales", {
    request_id: "avoir-supp-0003", client_id: s.client,
    lines: [{ kind: "service", ref_id: s.tresses, quantity: 1, staff_id: s.staff }, { kind: "service", ref_id: s.meches, quantity: 1, staff_id: null, parent: 0 }],
    discount: { kind: "percent", value: 10, reason: "geste" }, payments: [{ method: "cash", amount: 18000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const inv = sale.body.invoice;
  assert.equal(inv.total_ttc, 18000, "20 000 moins 10 %");
  const [tresses, meches] = (inv.lines as { id: number }[]).map((l) => l.id);
  /** Émet l'avoir en remboursant exactement ce que le serveur annonce comme dû. */
  const avoir = async (request_id: string, lines: unknown[]) => {
    const essai = await g("POST", "/api/credit-notes", { request_id, invoice_id: inv.id, reason: "Retour", lines, refunds: [] }, FR);
    assert.equal(essai.status, 409, JSON.stringify(essai.body));
    const du = Number(essai.body.due);
    const note = await g("POST", "/api/credit-notes", { request_id, invoice_id: inv.id, reason: "Retour", lines, refunds: [{ method: "cash", amount: du }] }, FR);
    assert.equal(note.status, 201, JSON.stringify(note.body));
    return note.body.credit_note;
  };
  const supplement = await avoir("avoir-supp-n401", [{ line_id: meches, quantity: 1 }]);
  assert.equal((await g("GET", `/api/invoices/${inv.id}`)).body.invoice.cancelled, false);
  const reste = await avoir("avoir-supp-n402", [{ line_id: tresses, quantity: 1 }]);
  assert.equal(supplement.total_ttc + reste.total_ttc, inv.total_ttc);
  assert.equal((await g("GET", `/api/invoices/${inv.id}`)).body.invoice.cancelled, true);
});
