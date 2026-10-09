import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Caller } from "../test-support.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { ticketRows, type TicketDocument } from "./ticket.ts";
import { renderTicket } from "./ticket-pdf.ts";

/**
 * PDF d'une facture (sous-projet 5 § 5.1) : `GET /api/invoices/:id/pdf`,
 * affiché (« Imprimer ») ou téléchargé (« Télécharger »), refait à chaque
 * demande depuis les valeurs figées, gérante et réception seulement.
 */

async function sale(g: Caller): Promise<{ id: number; number: string }> {
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", name_en: "Radiance facial", duration: 60, price: 25000 })).body.service.id as number;
  const res = await g("POST", "/api/sales", {
    request_id: "ticket-pdf-0001", client_id: client,
    lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }],
    tip: { amount: 2000, staff_id: staff },
    payments: [{ method: "cash", amount: 27000, cash_given: 30000 }],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.invoice.id, number: res.body.invoice.number };
}

test("PDF d'une facture : affiché ou téléchargé sous son numéro, jamais gardé en cache", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { id, number } = await sale(g);
  const shown = await g("GET", `/api/invoices/${id}/pdf`);
  assert.equal(shown.status, 200);
  assert.equal(shown.headers.get("content-type"), "application/pdf");
  assert.equal(shown.headers.get("content-disposition"), `inline; filename="${number}.pdf"`);
  assert.equal(shown.headers.get("cache-control"), "private, no-store");
  assert.equal(String(shown.body).slice(0, 5), "%PDF-");
  const saved = await g("GET", `/api/invoices/${id}/pdf?telecharger=1`);
  assert.equal(saved.headers.get("content-disposition"), `attachment; filename="${number}.pdf"`);
  assert.equal(saved.body, shown.body, "même document, même PDF");
});

test("PDF refait depuis les valeurs figées : réglages changés après l'émission, langue de l'écran : même PDF", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { id } = await sale(g);
  const first = await g("GET", `/api/invoices/${id}/pdf`);
  assert.equal(first.status, 200);
  const before = first.body;
  for (const [key, value] of [["caisse.tva_active", false], ["institut.niu", "M999"], ["institut.nom", "Autre nom"], ["caisse.mentions_fr", "Nouvelle mention"]] as const) {
    assert.equal((await g("PUT", `/api/settings/${key}`, { value })).status, 200, key);
  }
  assert.equal((await g("GET", `/api/invoices/${id}/pdf`)).body, before, "réglages figés sur la facture");
  assert.equal((await g("GET", `/api/invoices/${id}/pdf`, undefined, { "Accept-Language": "en" })).body, before, "langue de la facture, pas celle de l'écran");
});

test("droits et adresses : réception oui ; praticienne et administrateur non ; facture inconnue ou numéro invalide : 404", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { id } = await sale(g);
  const r = await ctx.as("reception");
  assert.equal((await r("GET", `/api/invoices/${id}/pdf`)).status, 200);
  assert.equal((await (await ctx.as("admin"))("GET", `/api/invoices/${id}/pdf`)).status, 403, "admin");
  // Encaissement par la praticienne (vague 3) : elle n'a que les tickets de ses propres rendez-vous ; une autre facture lui est introuvable.
  assert.equal((await (await ctx.as("practitioner"))("GET", `/api/invoices/${id}/pdf`)).status, 404, "practitioner");
  assert.equal((await g("GET", "/api/invoices/999/pdf")).status, 404);
  assert.equal((await g("GET", "/api/invoices/abc/pdf")).status, 403, "adresse hors des règles : refusée avant la route");
  assert.equal((await ctx.anonymous()("GET", `/api/invoices/${id}/pdf`)).status, 401);
});

test("PDF impossible à fabriquer : message traduit en 500, jamais le corps brut de l'erreur", async (t) => {
  // Une facture est immuable dès son émission (§ 3.1) : rien à corrompre après coup pour éprouver ce filet.
  // Liaison de test, comme `CLOCK` (test-support.ts) : jamais posée hors des tests, rien ne l'active en production.
  const RENDER_TICKET = async () => { throw new Error("échec de fabrication simulé pour les tests"); };
  const ctx = await setupApp(t, { demo: false, bindings: { RENDER_TICKET } });
  const g = await ctx.as("manager");
  const { id } = await sale(g);
  const fr = await g("GET", `/api/invoices/${id}/pdf`, undefined, { "Accept-Language": "fr" });
  assert.equal(fr.status, 500);
  assert.equal(fr.body.error, "Le ticket n'a pas pu être fabriqué. Réessayez\u00a0; si cela persiste, prévenez l'administrateur.");
  const en = await g("GET", `/api/invoices/${id}/pdf`);
  assert.equal(en.status, 500);
  assert.equal(en.body.error, "The receipt could not be produced. Try again; if this continues, contact the administrator.", "anglais sans en-tête");
});

test("logo : image dans le PDF de la facture ; « Logo seul » réglé après l'émission ne change pas cette facture, mais s'applique à la suivante", async (t) => {
  const seen: { doc: TicketDocument; logo: unknown }[] = [];
  const RENDER_TICKET = async (doc: TicketDocument, options?: { logo?: Buffer | null }) => {
    seen.push({ doc, logo: options?.logo ?? null });
    return renderTicket(doc, { compress: false, logo: options?.logo });
  };
  const ctx = await setupApp(t, { demo: false, bindings: { RENDER_TICKET } });
  const g = await ctx.as("manager");
  const BIN = { "content-type": "application/octet-stream" };
  assert.equal((await g("PUT", "/api/institut/logos/clair", PNG_1PX, BIN)).status, 200);
  assert.equal((await g("PUT", "/api/settings/institut.nom", { value: "Institut Akwa" })).status, 200);
  const first = await sale(g);
  const pdf = await g("GET", `/api/invoices/${first.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(String(pdf.body), /\/Subtype \/Image/);
  assert.equal((await g("PUT", "/api/settings/marque.documents", { value: "logo" })).status, 200);
  await g("GET", `/api/invoices/${first.id}/pdf`);
  const head = (i: number) => ticketRows(seen[i].doc, { logo: true }).slice(0, 2);
  assert.deepEqual(head(1), head(0), "facture déjà émise : inchangée");
  assert.deepEqual(head(0)[1], { type: "text", text: "Institut Akwa", style: "nom", align: "center" });
  const staff = (await g("GET", "/api/staff")).body.staff[0].id as number;
  const client = (await g("GET", "/api/clients")).body.clients[0].id as number;
  const service = (await g("GET", "/api/services")).body.services[0].id as number;
  const next = await g("POST", "/api/sales", {
    request_id: "ticket-pdf-0002", client_id: client,
    lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: staff }],
    payments: [{ method: "cash", amount: 25000, cash_given: 25000 }],
  });
  assert.equal(next.status, 201, JSON.stringify(next.body));
  await g("GET", `/api/invoices/${next.body.invoice.id}/pdf`);
  const rows = ticketRows(seen[2].doc, { logo: true });
  assert.ok(!rows.some((r) => r.type === "text" && r.style === "nom"), "facture suivante : Logo seul");
});
