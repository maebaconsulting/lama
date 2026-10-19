import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { resourceFor } from "../realtime.ts";
import { setupApp } from "../test-support.ts";
import { readDeposit } from "./acompte.ts";
import { depositTicket } from "./acompte-routes.ts";
import { ticketDate, ticketRows } from "./ticket.ts";

/**
 * API des acomptes (sous-projet 5 § 6.2) : fonction désactivée par défaut ;
 * activée, la gérante et la réception encaissent un acompte sur un rendez-vous
 * à venir (reçu AC en PDF, journal, rejeu) ; la gérante seule rembourse ou
 * garde l'acompte d'un rendez-vous annulé ; la praticienne n'y touche jamais ;
 * un rendez-vous qui a un acompte ne se supprime plus.
 */

const FR = { "Accept-Language": "fr" };

test("acompte par l'API : désactivé par défaut, encaissé, rejoué, reçu PDF, rembourse à l'annulation ; droits", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Soin du visage éclat", duration: 60, price: 25000 })).body.service.id as number;
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-09-30", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;
  const body = { request_id: "acompte-api-0001", appointment_id: apt, amount: 10000, payments: [{ method: "orange_money", amount: 10000, reference: "OM-123" }] };

  const off = await r("POST", "/api/deposits", body, FR);
  assert.deepEqual([off.status, off.body.error], [403, "Les acomptes ne sont pas activés dans les réglages de la caisse."]);
  assert.equal((await g("GET", "/api/sales/settings")).body.deposits, false);
  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: true })).status, 200);
  assert.equal((await r("GET", "/api/sales/settings")).body.deposits, true);

  const taken = await r("POST", "/api/deposits", body);
  assert.equal(taken.status, 201, JSON.stringify(taken.body));
  const dep = taken.body.deposit;
  assert.deepEqual([dep.number, dep.amount, dep.status, dep.client_name, dep.account_name, dep.appointment.date, dep.appointment.time], ["AC-2026-000001", 10000, "held", "Aïcha Mbida", "reception", "2026-09-30", "10:00"]);
  const again = await r("POST", "/api/deposits", body);
  assert.deepEqual([again.status, again.body.deposit.id], [200, dep.id], "même request_id : le reçu déjà émis");
  assert.deepEqual((await g("GET", `/api/deposits?appointment_id=${apt}`)).body.deposits.map((d: { number: string }) => d.number), ["AC-2026-000001"]);
  assert.equal((await g("GET", `/api/deposits/${dep.id}`)).body.deposit.number, "AC-2026-000001");
  assert.equal((await g("GET", "/api/deposits/999")).status, 404);
  assert.equal((await g("GET", "/api/deposits?appointment_id=abc")).status, 400);

  const pdf = await r("GET", `/api/deposits/${dep.id}/pdf?telecharger=1`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="AC-2026-000001.pdf"');
  assert.equal(String(pdf.body).slice(0, 5), "%PDF-");

  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'acompte.%' ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [{ action: "acompte.encaisse", target: "AC-2026-000001 (10\u202f000\u00a0FCFA)" }]);
  assert.deepEqual([auditAction("acompte.encaisse", "fr"), auditAction("acompte.rembourse", "en"), auditAction("acompte.garde", "fr")], ["Acompte encaissé", "Deposit refunded", "Acompte gardé"]);
  assert.equal(resourceFor("/api/deposits"), "invoices");

  // La praticienne ne lit ni n'encaisse aucun acompte ; un rendez-vous qui a un acompte ne se supprime plus.
  assert.equal((await p("GET", `/api/deposits?appointment_id=${apt}`)).status, 403);
  assert.equal((await p("POST", "/api/deposits", { ...body, request_id: "acompte-api-0002" })).status, 403);
  assert.equal((await p("GET", `/api/deposits/${dep.id}/pdf`)).status, 403);
  const removal = await g("DELETE", `/api/appointments/${apt}`, undefined, FR);
  assert.deepEqual([removal.status, removal.body.error], [409, "Un acompte a été encaissé pour ce rendez-vous\u00a0: il ne se supprime plus, il peut être annulé."]);

  // Rembourser : gérante seulement, rendez-vous annulé seulement.
  const refund = { request_id: "rembourse-api-01", action: "refund", refunds: [{ method: "cash", amount: 10000 }] };
  assert.equal((await r("POST", `/api/deposits/${dep.id}/settle`, refund)).status, 403);
  const active = await g("POST", `/api/deposits/${dep.id}/settle`, refund, FR);
  assert.deepEqual([active.status, active.body.error], [409, "Un acompte se rembourse ou se garde seulement si le rendez-vous est annulé ou la cliente absente."]);
  await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" });
  const refunded = await g("POST", `/api/deposits/${dep.id}/settle`, refund);
  assert.equal(refunded.status, 201, JSON.stringify(refunded.body));
  assert.deepEqual([refunded.body.deposit.status, refunded.body.deposit.settled_by_name, refunded.body.deposit.payments.map((x: { amount: number }) => x.amount)], ["refunded", "manager", [10000, -10000]]);
  assert.equal((await g("POST", `/api/deposits/${dep.id}/settle`, refund)).status, 200, "même envoi : rejeu");
  assert.equal(ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'acompte.rembourse'").all().length, 1);
});

test("reçu d'acompte : titre, numéro, rendez-vous cité, cliente, montant reçu, versements, en français et en anglais", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Tresses", duration: 120, price: 20000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-02", start_time: "14:30", service_ids: [service] })).body.appointment.id as number;
  const dep = (await g("POST", "/api/deposits", { request_id: "acompte-recu-01", appointment_id: apt, amount: 5000, payments: [{ method: "cash", amount: 5000 }] })).body.deposit;
  const record = ctx.env.STORAGE.transaction!((db) => readDeposit(db, dep.id))!;
  const texts = (lang: "fr" | "en") => ticketRows({ ...depositTicket(record), lang }).flatMap((row) => (row.type === "text" ? [row.text] : row.type === "pair" ? [`${row.left} | ${row.right}`] : []));
  const fr = texts("fr");
  for (const line of ["REÇU D'ACOMPTE", "AC-2026-000001", "Rendez-vous du 02/10/2026 à 14:30", "Cliente\u00a0: Aïcha Mbida", "Encaissé par manager", "Acompte reçu | 5\u00a0000\u00a0FCFA", "Espèces | 5\u00a0000\u00a0FCFA"]) {
    assert.ok(fr.includes(line), `${line} dans ${JSON.stringify(fr)}`);
  }
  const en = texts("en");
  for (const line of ["DEPOSIT RECEIPT", "Appointment on 02/10/2026 at 14:30", "Deposit received | 5\u00a0000\u00a0FCFA", "Cash | 5\u00a0000\u00a0FCFA"]) {
    assert.ok(en.includes(line), `${line} dans ${JSON.stringify(en)}`);
  }
});

/**
 * Correctif 1 de la tâche 2 (relecture) : la cliente d'un rendez-vous est
 * figée dès qu'un acompte en attente ou une facture active le cite, pour que
 * le reçu ou la facture gardent le bon nom ; sans l'un ou l'autre, elle se
 * change toujours.
 */
test("rendez-vous avec un acompte en attente ou une facture active : la cliente ne se change plus", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const aicha = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const fatou = (await g("POST", "/api/clients", { name: "Fatou Diop" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Massage", duration: 60, price: 15000 })).body.service.id as number;

  // Acompte en attente.
  const apt1 = (await g("POST", "/api/appointments", { client_id: aicha, scheduled_date: "2026-10-05", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  await g("POST", "/api/deposits", { request_id: "figee-acompte-01", appointment_id: apt1, amount: 5000, payments: [{ method: "cash", amount: 5000 }] });
  const blocked1 = await g("PUT", `/api/appointments/${apt1}`, { client_id: fatou }, FR);
  assert.deepEqual([blocked1.status, blocked1.body.error], [400, "Ce rendez-vous a un acompte en attente ou une facture active\u00a0: sa cliente ne se change plus."]);
  assert.equal((await g("GET", `/api/appointments/${apt1}`)).body.appointment.client_id, aicha, "la cliente n'a pas changé");

  // Facture active.
  const apt2 = (await g("POST", "/api/appointments", { client_id: aicha, scheduled_date: "2026-10-05", start_time: "10:00", service_ids: [service] })).body.appointment.id as number;
  await g("POST", "/api/sales", { request_id: "figee-facture-01", client_id: aicha, appointment_id: apt2, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 15000 }] });
  const blocked2 = await g("PUT", `/api/appointments/${apt2}`, { client_id: fatou }, FR);
  assert.equal(blocked2.status, 400);
  assert.equal((await g("GET", `/api/appointments/${apt2}`)).body.appointment.client_id, aicha, "la cliente n'a pas changé");

  // Sans acompte ni facture : la cliente se change toujours, les autres champs aussi.
  const apt3 = (await g("POST", "/api/appointments", { client_id: aicha, scheduled_date: "2026-10-05", start_time: "11:00", service_ids: [service] })).body.appointment.id as number;
  const allowed = await g("PUT", `/api/appointments/${apt3}`, { client_id: fatou, notes: "Changement de cliente" });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
  assert.equal((await g("GET", `/api/appointments/${apt3}`)).body.appointment.client_id, fatou);
});

/**
 * Correctif 2 : une réponse perdue reste retrouvable, même si la gérante a
 * désactivé les acomptes entre-temps (le reçu, lui, existe déjà).
 */
test("rejeu d'un acompte servi même après désactivation des acomptes", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Manucure", duration: 30, price: 8000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-06", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const body = { request_id: "rejeu-apres-off-01", appointment_id: apt, amount: 4000, payments: [{ method: "cash", amount: 4000 }] };
  const first = await r("POST", "/api/deposits", body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: false })).status, 200);
  const replay = await r("POST", "/api/deposits", body);
  assert.deepEqual([replay.status, replay.body.deposit.id], [200, first.body.deposit.id], "le rejeu est servi même désactivé");
});

/** « Garder » : motif obligatoire, statut `kept`, journal (couverture demandée par la relecture). */
test("« Garder » un acompte : motif obligatoire, statut kept, journal", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Pose de vernis", duration: 45, price: 6000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-07", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const dep = (await g("POST", "/api/deposits", { request_id: "garde-api-01", appointment_id: apt, amount: 3000, payments: [{ method: "cash", amount: 3000 }] })).body.deposit;
  await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" });
  const noReason = await g("POST", `/api/deposits/${dep.id}/settle`, { request_id: "garde-sans-motif-01", action: "keep", reason: "" }, FR);
  assert.equal(noReason.status, 400);
  const kept = await g("POST", `/api/deposits/${dep.id}/settle`, { request_id: "garde-api-02", action: "keep", reason: "Annulation tardive" });
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  assert.deepEqual([kept.body.deposit.status, kept.body.deposit.settle_reason], ["kept", "Annulation tardive"]);
  assert.deepEqual(ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'acompte.garde'").all().map((row) => ({ ...row })), [{ action: "acompte.garde", target: `${dep.number} (3\u202f000\u00a0FCFA)` }]);
});

/** Le sort (ici « Rembourser ») se règle aussi quand la cliente a été marquée absente. */
test("sort réglé sur un rendez-vous où la cliente est absente", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Coiffure", duration: 60, price: 12000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-08", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const dep = (await g("POST", "/api/deposits", { request_id: "absente-api-01", appointment_id: apt, amount: 4000, payments: [{ method: "cash", amount: 4000 }] })).body.deposit;
  await g("PUT", `/api/appointments/${apt}`, { status: "no_show" });
  const refunded = await g("POST", `/api/deposits/${dep.id}/settle`, { request_id: "absente-api-02", action: "refund", refunds: [{ method: "cash", amount: 4000 }] });
  assert.equal(refunded.status, 201, JSON.stringify(refunded.body));
  assert.equal(refunded.body.deposit.status, "refunded");
});

/** Décision 9 : le sort d'un acompte déjà en attente se règle même si la gérante désactive ensuite les acomptes. */
test("sort réglé même après désactivation des acomptes (décision 9)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Pédicure", duration: 45, price: 9000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-09", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const dep = (await g("POST", "/api/deposits", { request_id: "decision9-01", appointment_id: apt, amount: 3000, payments: [{ method: "cash", amount: 3000 }] })).body.deposit;
  await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" });
  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: false })).status, 200);
  const refunded = await g("POST", `/api/deposits/${dep.id}/settle`, { request_id: "decision9-02", action: "refund", refunds: [{ method: "cash", amount: 3000 }] });
  assert.equal(refunded.status, 201, JSON.stringify(refunded.body));
});

/** La praticienne ne lit jamais un reçu d'acompte et ne règle jamais son sort (décision 18 de la vague 3a). */
test("praticienne refusée sur la lecture d'un reçu et sur le sort", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Épilation", duration: 30, price: 7000 })).body.service.id as number;
  const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-10", start_time: "09:00", service_ids: [service] })).body.appointment.id as number;
  const dep = (await g("POST", "/api/deposits", { request_id: "praticienne-refus-01", appointment_id: apt, amount: 3500, payments: [{ method: "cash", amount: 3500 }] })).body.deposit;
  assert.equal((await p("GET", `/api/deposits/${dep.id}`)).status, 403);
  await g("PUT", `/api/appointments/${apt}`, { status: "cancelled" });
  assert.equal((await p("POST", `/api/deposits/${dep.id}/settle`, { request_id: "praticienne-refus-02", action: "refund", refunds: [{ method: "cash", amount: 3500 }] })).status, 403);
});

test("V1-79 : reçu d'acompte relu ou réimprimé après son sort ; le premier reçu reste celui de l'encaissement", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/caisse.acomptes", { value: true });
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbida" })).body.client.id as number;
  const service = (await g("POST", "/api/services", { name: "Tresses", duration: 120, price: 20000 })).body.service.id as number;
  const take = async (requestId: string, start: string) => {
    const apt = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-12", start_time: start, service_ids: [service] })).body.appointment.id as number;
    const dep = (await g("POST", "/api/deposits", { request_id: requestId, appointment_id: apt, amount: 5000, payments: [{ method: "cash", amount: 5000 }] })).body.deposit;
    return { apt, id: dep.id as number };
  };
  const record = (id: number) => ctx.env.STORAGE.transaction!((db) => readDeposit(db, id))!;
  const texts = (id: number, lang: "fr" | "en" = "fr") => ticketRows({ ...depositTicket(record(id)), lang }).flatMap((row) => (row.type === "text" ? [row.text] : row.type === "pair" ? [`${row.left} | ${row.right}`] : []));

  // Déduit : encaissement du rendez-vous.
  const a = await take("sort-deduit-01", "09:00");
  const first = ticketRows(depositTicket(record(a.id)));
  assert.equal(depositTicket(record(a.id)).fate, null, "en attente : aucun sort");
  assert.ok(!texts(a.id).some((l) => /^(Déduit|Remboursé|Gardé)/.test(l)));
  const sale = await g("POST", "/api/sales", { request_id: "sort-deduit-vente", client_id: client, appointment_id: a.apt, lines: [{ kind: "service", ref_id: service, quantity: 1 }], payments: [{ method: "cash", amount: 15000 }] });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const applied = record(a.id);
  assert.ok(texts(a.id).includes(`Déduit de la facture ${sale.body.invoice.number} le ${ticketDate(applied.settled_at!)}`));
  assert.ok(texts(a.id, "en").includes(`Deducted from invoice ${sale.body.invoice.number} on ${ticketDate(applied.settled_at!)}`));
  const again = ticketRows(depositTicket(applied));
  const i = again.findIndex((r) => r.type === "pair" && r.left === "Acompte reçu");
  assert.deepEqual([...again.slice(0, i + 1), ...again.slice(i + 3)], first, "le reste du reçu est celui de l'encaissement");

  // Remboursé, puis gardé.
  const b = await take("sort-rembourse-01", "12:00");
  await g("PUT", `/api/appointments/${b.apt}`, { status: "cancelled" });
  await g("POST", `/api/deposits/${b.id}/settle`, { request_id: "sort-rembourse-02", action: "refund", refunds: [{ method: "cash", amount: 5000 }] });
  assert.ok(texts(b.id).includes(`Remboursé le ${ticketDate(record(b.id).settled_at!)}`));
  assert.ok(!texts(b.id).some((l) => l.includes("-5")), "le remboursement ne devient pas un versement du reçu");
  const c = await take("sort-garde-01", "15:00");
  await g("PUT", `/api/appointments/${c.apt}`, { status: "no_show" });
  await g("POST", `/api/deposits/${c.id}/settle`, { request_id: "sort-garde-02", action: "keep", reason: "Absente sans prévenir" });
  assert.ok(texts(c.id).includes(`Gardé le ${ticketDate(record(c.id).settled_at!)}`));
  assert.ok(!texts(c.id).some((l) => l.includes("Absente")), "le motif reste interne");

  // PDF relu et impression directe : même document.
  const pdf = await g("GET", `/api/deposits/${b.id}/pdf`);
  assert.equal(pdf.status, 200);
  const impression = readFileSync(new URL("../impression/documents.ts", import.meta.url), "utf8");
  assert.match(impression, /ticket: depositTicket\(deposit\)/);
});
