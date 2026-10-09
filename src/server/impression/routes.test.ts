import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { PNG_1PX } from "../institut/images-essai.ts";
import { documents } from "../caisse/documents-essai.ts";
import { decodeCp858 } from "./escpos.ts";
import { NO_PAPER, startFakePrinter, type FakePrinter } from "./fausse-imprimante.ts";

// La fausse imprimante écoute 127.0.0.1 : adresse refusée en service, permise aux essais seulement.
process.env.LAMA_IMPRESSION_ESSAI = "1";

/**
 * Impression directe (spec du 03/10/2026) : vente, avoir et reçu imprimés sur
 * une fausse imprimante (port local), duplicata, pannes, droits, journal.
 */
async function withPrinter(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  const fake = await startFakePrinter();
  t.after(() => fake.close());
  const g = await ctx.as("manager");
  return { ctx, fake, g };
}

/** Tickets reçus, en texte lisible (laisse le temps à la connexion de se fermer côté imprimante). */
async function received(fake: FakePrinter): Promise<string[]> {
  await new Promise((r) => setTimeout(r, 30));
  return fake.jobs.map((j) => decodeCp858(j));
}

test("sans imprimante réglée : indicateur faux, impression refusée avec un message, rien d'autre ne change", async (t) => {
  const { ctx, g } = await withPrinter(t);
  assert.equal((await g("GET", "/api/sales/settings")).body.printer, false);
  const { kept } = await documents(g);
  const res = await g("POST", "/api/print/documents", { kind: "invoice", id: kept.id }, { "Accept-Language": "fr" });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, "non_reglee");
  assert.equal(res.body.error, "Aucune imprimante réglée dans les réglages de la caisse.");
  assert.equal((await g("PUT", "/api/settings/caisse.imprimante", { value: "http://imprimante" })).status, 400);
  assert.equal((await g("PUT", "/api/settings/caisse.imprimante", { value: "8.8.8.8" })).status, 400, "hors du réseau local");
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM print_counts").get()!.n, 0);
});

test("vente avec « Imprimer le ticket » : ticket imprimé à l'enregistrement, puis « DUPLICATA » à la réimpression, au journal", async (t) => {
  const { ctx, fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  assert.equal((await g("GET", "/api/sales/settings")).body.printer, true);
  const client = (await g("POST", "/api/clients", { name: "Pamela" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Manucure", name_en: "Manicure", duration: 30, price: 8000 })).body.service.id as number;
  const body = { request_id: "vente-imprimee-01", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 8000 }], print: true };
  const sale = await g("POST", "/api/sales", body);
  assert.equal(sale.status, 201);
  assert.equal(sale.body.invoice.printed, true);
  assert.equal((await g("POST", "/api/sales", body)).status, 200, "vente rejouée");
  let jobs = await received(fake);
  assert.equal(jobs.length, 1, "la vente rejouée n'imprime pas une seconde fois");
  assert.match(jobs[0], /FACTURE\n/);
  assert.doesNotMatch(jobs[0], /DUPLICATA/);
  const again = await g("POST", "/api/print/documents", { kind: "invoice", id: sale.body.invoice.id });
  assert.deepEqual(again.body, { ok: true, duplicate: true });
  jobs = await received(fake);
  assert.match(jobs[1], /FACTURE\nDUPLICATA\n/);
  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'impression.duplicata'").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [{ action: "impression.duplicata", target: sale.body.invoice.number }]);
});

test("plus de papier : la vente est enregistrée, la raison est rendue, rien n'est compté ; la réimpression suivante est l'original", async (t) => {
  const { ctx, fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  fake.status = { ...NO_PAPER };
  const service = (await g("POST", "/api/services", { name: "Pédicure", name_en: "Pedicure", duration: 30, price: 6000 })).body.service.id as number;
  const client = (await g("POST", "/api/clients", { name: "Chelsea" })).body.client.id as number;
  const sale = await g("POST", "/api/sales", { request_id: "vente-sans-papier", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 6000 }], print: true }, { "Accept-Language": "fr" });
  assert.equal(sale.status, 201);
  assert.equal(sale.body.invoice.print_error, "Plus de papier dans l'imprimante.");
  assert.equal(sale.body.invoice.printed, undefined);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM print_counts").get()!.n, 0);
  const res = await g("POST", "/api/print/documents", { kind: "invoice", id: sale.body.invoice.id });
  assert.equal(res.status, 409);
  assert.equal(res.body.reason, "papier");
  fake.status = { 1: 0x16, 2: 0x12, 4: 0x12 };
  assert.deepEqual((await g("POST", "/api/print/documents", { kind: "invoice", id: sale.body.invoice.id })).body, { ok: true, duplicate: false });
});

test("avoir et reçu d'acompte : imprimés à l'émission avec la case ; mauvais type ou absent : 404", async (t) => {
  const { fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  const { client, kept, note, deposit } = await documents(g);
  assert.deepEqual((await g("POST", "/api/print/documents", { kind: "credit", id: note.id })).body, { ok: true, duplicate: false });
  assert.deepEqual((await g("POST", "/api/print/documents", { kind: "deposit", id: deposit.id })).body, { ok: true, duplicate: false });
  const jobs = await received(fake);
  assert.match(jobs[0], /AVOIR\n/);
  assert.match(jobs[1], /REÇU D'ACOMPTE\n/);
  assert.equal((await g("POST", "/api/print/documents", { kind: "credit", id: kept.id })).status, 404, "une facture n'est pas un avoir");
  assert.equal((await g("POST", "/api/print/documents", { kind: "deposit", id: 999 })).status, 404);
  assert.equal((await g("POST", "/api/print/documents", { kind: "ticket", id: 1 })).status, 400);
  const service = (await g("POST", "/api/services", { name: "Tresses", name_en: "Braids", duration: 120, price: 30000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-06", start_time: "14:00", service_ids: [service] })).body.appointment.id as number;
  const dep = await g("POST", "/api/deposits", { request_id: "acompte-imprime-01", appointment_id: apt, amount: 5000, payments: [{ method: "cash", amount: 5000 }], print: true });
  assert.equal(dep.status, 201);
  assert.equal(dep.body.deposit.printed, true);
});

test("deux impressions simultanées du même document : un original et un duplicata", async (t) => {
  const { fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  const { kept } = await documents(g);
  const [a, b] = await Promise.all([1, 2].map(() => g("POST", "/api/print/documents", { kind: "invoice", id: kept.id })));
  assert.deepEqual([a.body.duplicate, b.body.duplicate].sort(), [false, true]);
});

test("tiroir : réception et gérante, au journal ; ticket de test : gérante seule ; praticienne : rien", async (t) => {
  const { ctx, fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  assert.deepEqual((await r("POST", "/api/print/drawer")).body, { ok: true });
  assert.equal((await p("POST", "/api/print/drawer")).status, 403);
  assert.equal((await r("POST", "/api/print/test")).status, 403);
  assert.deepEqual((await g("POST", "/api/print/test", undefined, { "Accept-Language": "fr" })).body, { ok: true });
  const jobs = await received(fake);
  assert.deepEqual([...fake.jobs[0]], [0x1b, 0x70, 0x00, 0x19, 0xfa]);
  assert.match(jobs[1], /lama\n[\s\S]*Ticket de test\n[\s\S]*Imprimante : 127\.0\.0\.1:\d+/);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tiroir.ouverture'").get()!.n, 1);
  const { kept } = await documents(g);
  assert.equal((await p("POST", "/api/print/documents", { kind: "invoice", id: kept.id })).status, 404, "praticienne, encaissement désactivé");
});

test("imprimante injoignable : la vente est enregistrée (201), le message est rendu, rien n'est compté", async (t) => {
  const { ctx, fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  await fake.close();
  const service = (await g("POST", "/api/services", { name: "Vernis", name_en: "Polish", duration: 30, price: 4000 })).body.service.id as number;
  const client = (await g("POST", "/api/clients", { name: "Nadège" })).body.client.id as number;
  const sale = await g("POST", "/api/sales", { request_id: "vente-injoignable", client_id: client, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 4000 }], print: true }, { "Accept-Language": "fr" });
  assert.equal(sale.status, 201);
  assert.equal(sale.body.invoice.print_error, "Imprimante injoignable\u00a0: vérifiez qu'elle est allumée et branchée au réseau, et son adresse dans les réglages de la caisse.");
  assert.equal(sale.body.invoice.printed, undefined);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM print_counts").get()!.n, 0);
});

test("praticienne avec l'encaissement actif : imprime la facture de son rendez-vous ; celle d'une autre et un avoir, 404", async (t) => {
  const { ctx, fake, g } = await withPrinter(t);
  await g("PUT", "/api/settings/caisse.imprimante", { value: fake.address });
  await g("PUT", "/api/settings/caisse.encaissement_praticienne", { value: true });
  const p = await ctx.as("practitioner");
  const own = (ctx.db.prepare("SELECT staff_id FROM accounts WHERE login = 'practitioner'").get() as { staff_id: number }).staff_id;
  const other = (await g("POST", "/api/staff", { name: "Grace" })).body.staff.id as number;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", duration: 60, price: 25000 })).body.service.id as number;
  const book = async (staff: number, time: string) =>
    (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-28", start_time: time, service_ids: [service] })).body.appointment.id as number;
  const mine = await book(own, "10:00");
  await g("PUT", `/api/appointments/${mine}`, { status: "in_progress" });
  const theirs = await book(other, "10:00");
  await g("PUT", `/api/appointments/${theirs}`, { status: "in_progress" });
  const sale = (apt: number, request_id: string) => ({ request_id, client_id: client, appointment_id: apt, lines: [{ kind: "service", ref_id: service, quantity: 1, staff_id: own }], payments: [{ method: "cash", amount: 25000 }] });
  const ownInvoice = (await p("POST", "/api/sales", sale(mine, "prat-impr-0001"))).body.invoice as { id: number; lines: { id: number }[] };
  const otherInvoice = (await g("POST", "/api/sales", sale(theirs, "gerante-impr-001"))).body.invoice as { id: number; lines: { id: number }[] };
  assert.ok(ownInvoice && otherInvoice);
  const note = (await g("POST", "/api/credit-notes", {
    request_id: "avoir-prat-0001", invoice_id: otherInvoice.id, reason: "Erreur de saisie", lines: [{ line_id: otherInvoice.lines[0].id, quantity: 1 }], refunds: [{ method: "cash", amount: 25000 }],
  })).body.credit_note as { id: number };
  const own200 = await p("POST", "/api/print/documents", { kind: "invoice", id: ownInvoice.id });
  assert.equal(own200.status, 200, JSON.stringify(own200.body));
  assert.deepEqual(own200.body, { ok: true, duplicate: false });
  assert.equal((await p("POST", "/api/print/documents", { kind: "invoice", id: otherInvoice.id })).status, 404, "facture d'une autre praticienne");
  assert.equal((await p("POST", "/api/print/documents", { kind: "credit", id: note.id })).status, 404, "avoir");
});

// Logo sur le ticket papier (vague B) : `GS v 0` dans les octets reçus.
const hasRaster = (job: Buffer) => job.indexOf(Buffer.from([0x1d, 0x76, 0x30])) >= 0;
const BIN = { "content-type": "application/octet-stream" };

async function withLogoPrinter(t: Parameters<typeof setupApp>[0], options: { logo: boolean; check: boolean }) {
  const r = await withPrinter(t);
  await r.g("PUT", "/api/settings/caisse.imprimante", { value: r.fake.address });
  if (options.logo) assert.equal((await r.g("PUT", "/api/institut/logos/clair", PNG_1PX, BIN)).status, 200);
  if (options.check) await r.g("PUT", "/api/settings/caisse.imprimer_logo", { value: true });
  return r;
}

test("logo papier : case décochée (défaut), aucune image même avec un logo déposé", async (t) => {
  const { fake, g } = await withLogoPrinter(t, { logo: true, check: false });
  const { kept } = await documents(g);
  assert.equal((await g("POST", "/api/print/documents", { kind: "invoice", id: kept.id })).status, 200);
  await received(fake);
  assert.equal(hasRaster(fake.jobs[0]), false);
});

test("logo papier : case cochée et logo déposé, image imprimée ; « Logo seul » : nom après le titre, avant les mentions", async (t) => {
  const { fake, g } = await withLogoPrinter(t, { logo: true, check: true });
  await g("PUT", "/api/settings/institut.nom", { value: "Institut Zeta" });
  await g("PUT", "/api/settings/marque.documents", { value: "logo" });
  await g("PUT", "/api/settings/caisse.mentions_fr", { value: "RCCM 12345" });
  const { kept } = await documents(g);
  assert.equal((await g("POST", "/api/print/documents", { kind: "invoice", id: kept.id })).status, 200);
  const jobs = await received(fake);
  assert.equal(hasRaster(fake.jobs[0]), true);
  const text = jobs[0];
  assert.ok(text.includes("Institut Zeta"), "nom présent");
  assert.ok(text.includes("RCCM 12345"), "mentions présentes");
  assert.ok(text.indexOf("Institut Zeta") > text.indexOf("FACTURE"), "nom après le titre");
  assert.ok(text.indexOf("Institut Zeta") < text.indexOf("RCCM 12345"), "nom avant les mentions légales");
});

test("logo papier : case cochée sans logo, la facture s'imprime sans image et garde son nom", async (t) => {
  const { fake, g } = await withLogoPrinter(t, { logo: false, check: true });
  await g("PUT", "/api/settings/institut.nom", { value: "Institut Zeta" });
  await g("PUT", "/api/settings/marque.documents", { value: "logo" });
  const { kept } = await documents(g);
  assert.equal((await g("POST", "/api/print/documents", { kind: "invoice", id: kept.id })).status, 200);
  const jobs = await received(fake);
  assert.equal(hasRaster(fake.jobs[0]), false);
  assert.ok(jobs[0].indexOf("Institut Zeta") < jobs[0].indexOf("FACTURE"), "nom en tête sans logo");
});

test("logo papier : ticket de test avec image si case cochée et logo, sans sinon", async (t) => {
  const on = await withLogoPrinter(t, { logo: true, check: true });
  assert.equal((await on.g("POST", "/api/print/test")).status, 200);
  await received(on.fake);
  assert.equal(hasRaster(on.fake.jobs[0]), true);
  const off = await withLogoPrinter(t, { logo: true, check: false });
  assert.equal((await off.g("POST", "/api/print/test")).status, 200);
  await received(off.fake);
  assert.equal(hasRaster(off.fake.jobs[0]), false);
});

test("logo papier : image d'impression corrompue en base, l'impression réussit sans image et garde le nom", async (t) => {
  const { ctx, fake, g } = await withLogoPrinter(t, { logo: true, check: true });
  await g("PUT", "/api/settings/institut.nom", { value: "Institut Zeta" });
  await g("PUT", "/api/settings/marque.documents", { value: "logo" });
  ctx.db.prepare("UPDATE institut_logos SET impression = x'00'").run();
  const { kept } = await documents(g);
  assert.equal((await g("POST", "/api/print/documents", { kind: "invoice", id: kept.id })).status, 200);
  const jobs = await received(fake);
  assert.equal(hasRaster(fake.jobs[0]), false);
  assert.ok(jobs[0].indexOf("Institut Zeta") < jobs[0].indexOf("FACTURE"));
});
