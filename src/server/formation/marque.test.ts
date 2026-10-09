import assert from "node:assert/strict";
import { test } from "node:test";
import { avecFormation as enFormation, setupApp } from "../test-support.ts";
import { closingRows, summarize } from "../caisse/cloture.ts";
import { renderTicket } from "../caisse/ticket-pdf.ts";
import { ticketRows, type TicketDocument, type TicketRow } from "../caisse/ticket.ts";
import { decodeCp858, ticketBytes } from "../impression/escpos.ts";
import { startFakePrinter } from "../impression/fausse-imprimante.ts";
import { marquerFormation } from "./marque.ts";

/** Mention FORMATION (distribution D-17, D-18) : en tête et au pied de chaque ticket, papier ou PDF, en formation seulement. */

// La fausse imprimante écoute 127.0.0.1 : adresse refusée en service, permise aux essais seulement.
process.env.LAMA_IMPRESSION_ESSAI = "1";

const doc: TicketDocument = {
  kind: "invoice", number: "DEMO-2026-000007", issued_at: Date.parse("2026-09-28T08:00:00Z"), lang: "fr",
  fiscal: { tva_active: false, tva_taux: 19.25, niu: "", rccm: "", nom: "Institut Démo", adresse: "Douala", telephone: "", mentions_fr: "", mentions_en: "", marque_documents: "logo_nom" },
  client_name: "Aïcha Mbarga", account_name: "Gérante (formation)",
  lines: [{ label_fr: "Manucure", label_en: "Manicure", quantity: 1, unit_price: 8000, line_total: 8000, staff_name: "Mireille" }],
  subtotal: 8000, discount_amount: 0, discount_kind: null, discount_value: null, discount_reason: "",
  total_ttc: 8000, total_ht: 8000, total_tva: 0, payments: [{ method: "cash", amount: 8000, reference: "", cash_given: 8000, change_given: 0 }], tip: null,
};

const textes = (rows: TicketRow[]) => rows.filter((r) => r.type === "text").map((r) => (r as { text: string }).text);
const mention = (text: string): TicketRow => ({ type: "text", text, style: "total", align: "center" });

test("marquerFormation : rien hors formation ; en formation, FORMATION en tête et au pied, séparée par un filet ; TRAINING en anglais", async () => {
  const rows: TicketRow[] = [{ type: "text", text: "FACTURE", style: "titre", align: "center" }];
  assert.equal(await enFormation(false, () => marquerFormation(rows, "fr")), rows);
  assert.deepEqual(await enFormation(true, () => marquerFormation(rows, "fr")), [mention("FORMATION"), { type: "rule" }, ...rows, { type: "rule" }, mention("FORMATION")]);
  assert.deepEqual((await enFormation(true, () => marquerFormation(rows, "en")))[0], mention("TRAINING"));
});

test("facture, avoir et reçu d'acompte : FORMATION en première et dernière rangée ; rien hors formation", async () => {
  for (const kind of ["invoice", "credit_note", "deposit"] as const) {
    const rows = await enFormation(true, () => ticketRows({ ...doc, kind }, { logo: true }));
    assert.deepEqual([rows[0], rows[rows.length - 1]], [mention("FORMATION"), mention("FORMATION")], kind);
    assert.deepEqual(rows[2], { type: "logo" }, `${kind} : le logo suit la mention`);
    assert.ok(!textes(await enFormation(false, () => ticketRows({ ...doc, kind }))).includes("FORMATION"), kind);
  }
});

test("ticket de clôture : FORMATION en tête et au pied, dans la langue de l'écran", async () => {
  const summary = summarize({ documents: [], payments: [], tips: [], deposits: [] });
  const closing = {
    id: 1, day: "2026-09-28", seq: 1, closed_at: Date.parse("2026-09-28T18:00:00Z"), period_start: Date.parse("2026-09-28T07:00:00Z"),
    last_invoice_id: 0, last_payment_id: 0, account_id: 1, account_name: "Gérante (formation)", cash_expected: 0, cash_counted: 0, difference: 0, note: "", summary,
  };
  const rows = await enFormation(true, () => closingRows(closing, { nom: "Institut Démo" }, "en"));
  assert.deepEqual([rows[0], rows[rows.length - 1]], [mention("TRAINING"), mention("TRAINING")]);
});

test("papier : FORMATION en tête, « DUPLICATA » toujours sous le titre du document ; PDF plus long de la mention", async () => {
  const papier = decodeCp858(await enFormation(true, () => ticketBytes(ticketRows(doc), { duplicate: "DUPLICATA" })));
  assert.ok(papier.indexOf("FORMATION") < papier.indexOf("FACTURE"), "mention en tête");
  assert.match(papier, /FACTURE\nDUPLICATA\n/, "duplicata sous le titre, pas sous la mention");
  assert.ok(papier.lastIndexOf("FORMATION") > papier.indexOf("propulsé par lama"), "mention au pied");
  const hauteur = (pdf: Buffer) => Number(pdf.toString("latin1").match(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/)![1]);
  const avec = hauteur(await enFormation(true, () => renderTicket(doc)));
  const sans = hauteur(await enFormation(false, () => renderTicket(doc)));
  assert.ok(avec > sans + 40, `${avec} en formation, ${sans} hors formation`);
});

test("imprimante en formation : vente imprimée et ticket de test portent FORMATION (imprimante permise)", async (t) => {
  const avant = process.env.LAMA_FORMATION;
  t.after(() => { if (avant === undefined) delete process.env.LAMA_FORMATION; else process.env.LAMA_FORMATION = avant; });
  process.env.LAMA_FORMATION = "1";
  const ctx = await setupApp(t, { demo: false });
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  const client = (await g("POST", "/api/clients", { name: "Pamela" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Manucure", name_en: "Manicure", duration: 30, price: 8000 })).body.service.id as number;
  const sale = await g("POST", "/api/sales", { request_id: "vente-formation-01", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 8000 }], print: true });
  assert.equal(sale.body.invoice.printed, true);
  assert.equal((await g("POST", "/api/print/test", {}, { "accept-language": "fr" })).status, 200);
  await new Promise((r) => setTimeout(r, 30));
  const jobs = fake.jobs.map((j) => decodeCp858(j));
  assert.equal(jobs.length, 2);
  for (const job of jobs) assert.equal(job.match(/FORMATION/g)?.length, 2, job);
});
