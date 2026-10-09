import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { setupApp } from "../test-support.ts";
import { documents } from "../caisse/documents-essai.ts";
import { renderDocument } from "./pdf-document.ts";

/**
 * Ticket, avoir et reçu d'acompte envoyés par WhatsApp (sous-projet 7,
 * vague 2) : le PDF est produit au moment de l'envoi, jamais gardé dans la file.
 */


test("PDF produit au moment de l'envoi : facture, avoir, reçu d'acompte, nommés à leur numéro ; facture entièrement reprise : « annulée » ; mauvais type ou absent : rien", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const { kept, credited, note, deposit } = await documents(await ctx.as("manager"));
  initDB(ctx.env); // lecture hors d'une requête, comme le gestionnaire de la file
  const invoice = await renderDocument(ctx.env.STORAGE, { kind: "invoice", id: kept.id });
  assert.ok(invoice && invoice !== "annulee");
  assert.deepEqual([invoice.name, invoice.mime, invoice.data.subarray(0, 5).toString()], [`${kept.number}.pdf`, "application/pdf", "%PDF-"]);
  const credit = await renderDocument(ctx.env.STORAGE, { kind: "credit", id: note.id });
  assert.ok(credit && credit !== "annulee");
  assert.equal(credit.name, `${note.number}.pdf`);
  const receipt = await renderDocument(ctx.env.STORAGE, { kind: "deposit", id: deposit.id });
  assert.ok(receipt && receipt !== "annulee");
  assert.equal(receipt.name, `${deposit.number}.pdf`);
  assert.equal(await renderDocument(ctx.env.STORAGE, { kind: "invoice", id: credited.id }), "annulee");
  assert.equal(await renderDocument(ctx.env.STORAGE, { kind: "invoice", id: note.id }), null, "un avoir n'est pas une facture");
  assert.equal(await renderDocument(ctx.env.STORAGE, { kind: "credit", id: kept.id }), null);
  assert.equal(await renderDocument(ctx.env.STORAGE, { kind: "deposit", id: 999 }), null);
});

type Row = { dedupe_key: string; payload: string; created_by: number | null };
const rows = (ctx: Awaited<ReturnType<typeof setupApp>>) => ctx.db.prepare("SELECT dedupe_key, payload, created_by FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as Row[];

test("« Envoyer par WhatsApp » sur une facture, un avoir, un reçu : mis en file, un envoi demandé à chaque appui (clé numérotée), texte de la gérante, journal sans le texte", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/institut.nom", { value: "Institut Ébène" });
  const { client, kept, note, deposit } = await documents(g);
  ctx.db.exec("DELETE FROM outbox"); // confirmation du rendez-vous de l'acompte
  const r = await ctx.as("reception");
  assert.equal((await r("POST", "/api/whatsapp/documents", { kind: "invoice", id: kept.id })).status, 200);
  assert.equal((await r("POST", "/api/whatsapp/documents", { kind: "invoice", id: kept.id })).status, 200, "un second envoi demandé");
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "credit", id: note.id })).status, 200);
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "deposit", id: deposit.id })).status, 200);
  const all = rows(ctx);
  assert.deepEqual(all.map((row) => row.dedupe_key), [`wa:ticket:invoice:${kept.id}:1`, `wa:ticket:invoice:${kept.id}:2`, `wa:ticket:credit:${note.id}:1`, `wa:ticket:deposit:${deposit.id}:1`]);
  assert.deepEqual(JSON.parse(all[0].payload), {
    to: "237699123456", lang: "fr",
    text: `Bonjour Aïcha, voici votre ticket ${kept.number} de Institut Ébène. Merci de votre confiance\u00a0!`,
    document: { kind: "invoice", id: kept.id }, origin: { type: "ticket", clientId: client },
  });
  assert.match(JSON.parse(all[3].payload).text, new RegExp(`reçu d'acompte ${deposit.number}`));
  assert.ok(all.every((row) => row.created_by !== null));
  const audit = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'whatsapp.document' ORDER BY id").all().map((row) => (row as { target: string }).target);
  assert.deepEqual(audit, [kept.number, kept.number, note.number, deposit.number]);
});

test("« Envoyer par WhatsApp » refusé : facture entièrement reprise, document inconnu, cliente sans numéro ou numéro impossible ; administrateur et praticienne exclus", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { client, credited, note } = await documents(g);
  ctx.db.exec("DELETE FROM outbox");
  const fr = { "Accept-Language": "fr" };
  const cancelled = await g("POST", "/api/whatsapp/documents", { kind: "invoice", id: credited.id }, fr);
  assert.deepEqual([cancelled.status, cancelled.body.error], [409, "Facture entièrement reprise par un avoir\u00a0: envoyez plutôt l'avoir."]);
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "invoice", id: note.id })).status, 404, "un avoir n'est pas une facture");
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "deposit", id: 999 })).status, 404);
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "devis", id: 1 })).status, 400);
  await g("PUT", `/api/clients/${client}`, { phone: "12" });
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "credit", id: note.id }, fr)).body.error, "Numéro de téléphone impossible à normaliser.");
  await g("PUT", `/api/clients/${client}`, { phone: "" });
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "credit", id: note.id }, fr)).body.error, "Cette cliente n'a pas de numéro de téléphone.");
  assert.equal((await (await ctx.as("admin"))("POST", "/api/whatsapp/documents", { kind: "credit", id: note.id })).status, 403);
  assert.equal((await (await ctx.as("practitioner"))("POST", "/api/whatsapp/documents", { kind: "credit", id: note.id })).status, 403);
  assert.equal(rows(ctx).length, 0);
});

test("case « Envoyer par WhatsApp » à l'encaissement : ticket mis en file dans la transaction de la vente, une seule fois même si la vente est rejouée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/institut.nom", { value: "Institut Ébène" });
  const client = (await g("POST", "/api/clients", { name: "Brenda Eyenga", phone: "677 00 00 00", channel: "none", language: "en" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Manucure", name_en: "Manicure", duration: 30, price: 8000 })).body.service.id as number;
  const body = { request_id: "vente-wa-0001", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 8000 }], whatsapp: true };
  const sale = await g("POST", "/api/sales", body);
  assert.equal(sale.status, 201);
  assert.equal(sale.body.invoice.whatsapp_queued, true, "case cochée par la réception : envoyé même sans l'accord aux envois automatiques");
  assert.equal((await g("POST", "/api/sales", body)).status, 200);
  const [row, ...rest] = rows(ctx);
  assert.equal(rest.length, 0, "vente rejouée : rien de plus");
  assert.equal(row.dedupe_key, `wa:ticket:invoice:${sale.body.invoice.id}:1`);
  assert.equal(JSON.parse(row.payload).text, `Hello Brenda, here is your receipt ${sale.body.invoice.number} from Institut Ébène. Thank you for your trust!`);
  const product = (await g("POST", "/api/products", { name: "Crème hydratante", price: 8000, stock: 3 })).body.product.id as number;
  const counter = await g("POST", "/api/sales", { ...body, request_id: "vente-wa-0002", client_id: null, lines: [{ kind: "product", ref_id: product, quantity: 1 }] });
  assert.equal(counter.body.invoice.whatsapp_queued, false, "vente au comptoir sans cliente : rien à envoyer");
  const without = await g("POST", "/api/sales", { ...body, request_id: "vente-wa-0003", whatsapp: false });
  assert.equal(without.body.invoice.whatsapp_queued, undefined);
  assert.equal(rows(ctx).length, 1);
  const journal = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'whatsapp.document'").all() as { target: string }[];
  assert.deepEqual(journal.map((l) => l.target), [sale.body.invoice.number], "case cochée : au journal comme le bouton, une fois");
});

test("case cochée, numéro impossible à normaliser : la vente passe, le ticket va dans « À envoyer à la main » avec de quoi télécharger le PDF", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const client = (await g("POST", "/api/clients", { name: "Carine", phone: "12" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Manucure", duration: 30, price: 8000 })).body.service.id as number;
  const sale = await g("POST", "/api/sales", { request_id: "vente-wa-0004", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 8000 }], whatsapp: true });
  assert.equal(sale.status, 201);
  assert.equal(JSON.parse(rows(ctx)[0].payload).to, "");
  ctx.db.exec("UPDATE outbox SET status = 'failed', last_error = '@whatsapp.numero_invalide'");
  const [item] = (await g("GET", "/api/whatsapp/manual")).body.items;
  assert.deepEqual([item.type, item.document], ["ticket", { kind: "invoice", id: sale.body.invoice.id, number: sale.body.invoice.number }]);
});

test("envoi d'un document : numéro suivant le plus grand déjà pris, même après la purge d'un envoi plus ancien (relecture, mineur 1)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const { kept } = await documents(g);
  ctx.db.exec("DELETE FROM outbox");
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "invoice", id: kept.id })).status, 200);
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "invoice", id: kept.id })).status, 200);
  ctx.db.prepare("DELETE FROM outbox WHERE dedupe_key = ?").run(`wa:ticket:invoice:${kept.id}:1`); // envoi parti, purgé après 90 jours
  assert.equal((await g("POST", "/api/whatsapp/documents", { kind: "invoice", id: kept.id })).status, 200);
  assert.deepEqual(rows(ctx).map((row) => row.dedupe_key), [`wa:ticket:invoice:${kept.id}:2`, `wa:ticket:invoice:${kept.id}:3`]);
});
