import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "../migrations.ts";
import { definirDevise } from "../../shared/devise-active.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { issueDeposit, parseDepositRequest, parseSettleRequest, settleDeposit } from "./acompte.ts";
import { issueCreditNote, parseCreditRequest } from "./avoir.ts";
import { closeTill, closingRows, dayReport, parseClosingRequest, summarize } from "./cloture.ts";
import { issueSale, parseSaleRequest, SaleError, type SaleSettings } from "./vente.ts";

/**
 * Clôture de caisse (sous-projet 5 § 6.3) : totaux par moyen de paiement
 * (factures moins remboursements), nombre de factures et d'avoirs,
 * pourboires dus par praticienne, espèces comptées et écart ; une seconde
 * clôture le même jour ne couvre que ce qui suit la précédente ; une
 * clôture ne se modifie plus.
 */

const SETTINGS: SaleSettings = { vat: { active: true, rate: 19.25 }, discounts: true, discountCap: 10, tips: true, methods: ["cash", "card", "orange_money", "momo"] };
/** 28/09/2026 à Douala : 09:00, 11:00, 12:00, 18:00 (UTC+1). */
const AT = (hhmm: string) => Date.parse(`2026-09-28T${hhmm}:00+01:00`);

function base(t: { after: (fn: () => void) => void }) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  t.after(() => db.close());
  db.exec(`
    INSERT INTO staff (id, name) VALUES (1, 'Solange'), (2, 'Grace');
    INSERT INTO clients (id, name) VALUES (1, 'Aïcha Mbida');
    INSERT INTO services (id, name, duration, price) VALUES (1, 'Soin du visage éclat', 60, 25000);
    INSERT INTO products (id, name, price, stock) VALUES (1, 'Crème hydratante', 35000, 5);
    INSERT INTO accounts (id, display_name, login, role, password_hash, created_at) VALUES (1, 'Grâce', 'grace', 'manager', 'x', 0), (2, 'Ngozi', 'ngozi', 'reception', 'x', 0);
  `);
  const storage = sqliteStorage(db);
  const sale = (request_id: string, now: number, body: Record<string, unknown>) => storage.transaction!((d) => issueSale(d, parseSaleRequest({ request_id, ...body }), {
    now, lang: "fr", accountId: 2, fiscal: { tva_active: true, tva_taux: 19.25 }, settings: SETTINGS, approved: false, requestLang: "fr",
  }));
  const close = (body: Record<string, unknown>, now: number, accountId = 1) => storage.transaction!((d) => closeTill(d, parseClosingRequest(body), { now, accountId }));
  return { db, storage, sale, close };
}

/** Journée type : soin + pourboire en espèces et Orange Money, crème à la carte, puis avoir remboursé en espèces sur la crème. */
function busyMorning(ctx: ReturnType<typeof base>) {
  ctx.sale("vente-matin-001", AT("09:00"), {
    client_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], tip: { amount: 2000, staff_id: 1 },
    payments: [{ method: "cash", amount: 20000, cash_given: 20000 }, { method: "orange_money", amount: 7000, reference: "OM-1" }],
  });
  ctx.sale("vente-matin-002", AT("11:00"), { lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "card", amount: 35000 }] });
  ctx.storage.transaction!((d) => issueCreditNote(d, parseCreditRequest({
    request_id: "avoir-matin-01", invoice_id: 2, reason: "Produit défectueux", lines: [{ line_id: 2, quantity: 1, restock: true }], refunds: [{ method: "cash", amount: 35000 }],
  }), { now: AT("12:00"), accountId: 1, identity: {}, requestLang: "fr" }));
}

test("résumé : totaux par moyen (reçu, remboursé, net), nombres de factures et d'avoirs, pourboires dus par praticienne, espèces attendues", () => {
  const s = summarize({
    documents: [{ kind: "invoice", total_ttc: 25000 }, { kind: "invoice", total_ttc: 35000 }, { kind: "credit_note", total_ttc: 35000 }],
    payments: [{ method: "cash", amount: 20000 }, { method: "orange_money", amount: 7000 }, { method: "card", amount: 35000 }, { method: "cash", amount: -35000 }],
    tips: [{ staff_id: 1, staff_name: "Solange", amount: 2000 }, { staff_id: 2, staff_name: "Grace", amount: 500 }, { staff_id: 1, staff_name: "Solange", amount: 1000 }],
    deposits: [],
  });
  assert.deepEqual(s.methods, [
    { method: "cash", received: 20000, refunded: 35000, net: -15000 },
    { method: "card", received: 35000, refunded: 0, net: 35000 },
    { method: "orange_money", received: 7000, refunded: 0, net: 7000 },
    { method: "momo", received: 0, refunded: 0, net: 0 },
  ]);
  assert.deepEqual([s.invoices, s.credit_notes], [{ count: 2, total: 60000 }, { count: 1, total: 35000 }]);
  assert.deepEqual(s.tips, [{ staff_id: 2, staff_name: "Grace", amount: 500 }, { staff_id: 1, staff_name: "Solange", amount: 3000 }], "par praticienne, dans l'ordre alphabétique");
  assert.equal(s.cash_expected, -15000);
  assert.deepEqual(s.deposits, { received: { count: 0, total: 0 }, refunded: { count: 0, total: 0 } });
  const d = summarize({
    documents: [], payments: [], tips: [],
    deposits: [{ deposit_id: 1, method: "cash", amount: 4000 }, { deposit_id: 1, method: "momo", amount: 6000 }, { deposit_id: 2, method: "cash", amount: -5000 }],
  });
  assert.deepEqual(d.deposits, { received: { count: 1, total: 10000 }, refunded: { count: 1, total: 5000 } }, "acomptes comptés une fois, quel que soit le nombre de versements");
  assert.deepEqual([d.methods[0], d.methods[3], d.cash_expected], [{ method: "cash", received: 4000, refunded: 5000, net: -1000 }, { method: "momo", received: 6000, refunded: 0, net: 6000 }, -1000],
    "versements et remboursements d'acompte dans les totaux par moyen et les espèces attendues");
});

test("acomptes dans la clôture : reçus le jour de leur encaissement, remboursés le jour du remboursement, déduits jamais comptés deux fois ; seconde clôture sur la suite seulement", (t) => {
  const ctx = base(t);
  ctx.db.exec(`
    INSERT INTO appointments (id, identifier, client_id, staff_id, status, scheduled_date) VALUES (1, 'APT-1', 1, 1, 'booked', '2026-09-28'), (2, 'APT-2', 1, 1, 'booked', '2026-10-02');
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 25000, 60), (2, 1, 25000, 60);
  `);
  const deposit = (request_id: string, appointment_id: number, now: number, method: "cash" | "card") => ctx.storage.transaction!((d) => issueDeposit(d, parseDepositRequest({
    request_id, appointment_id, amount: 10000, payments: [{ method, amount: 10000 }],
  }), { now, accountId: 2, lang: "fr", fiscal: {}, methods: SETTINGS.methods }));
  // La veille : acompte en espèces sur le rendez-vous 2 (il n'entre pas dans le 28).
  deposit("acompte-veille-1", 2, Date.parse("2026-09-27T17:00:00+01:00"), "cash");
  // Le 28 : acompte par carte sur le rendez-vous 1, puis ce rendez-vous est encaissé (15 000 en espèces, l'acompte déduit).
  deposit("acompte-jour-01", 1, AT("09:00"), "card");
  ctx.db.exec("UPDATE appointments SET status = 'in_progress' WHERE id = 1");
  ctx.sale("vente-acompte-01", AT("11:00"), { client_id: 1, appointment_id: 1, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }], payments: [{ method: "cash", amount: 15000, cash_given: 15000 }] });
  const morning = dayReport(ctx.db, "2026-09-28", AT("12:00"));
  assert.deepEqual([morning.open.count, morning.open.summary.deposits, morning.open.summary.invoices], [2, { received: { count: 1, total: 10000 }, refunded: { count: 0, total: 0 } }, { count: 1, total: 25000 }]);
  assert.deepEqual(morning.open.summary.methods.filter((m) => m.net !== 0).map((m) => [m.method, m.net]), [["cash", 15000], ["card", 10000]], "la carte de l'acompte, les espèces de la vente : 25 000 en tout, jamais 35 000");
  const first = ctx.close({ request_id: "cloture-acompte-1", day: "2026-09-28", cash_counted: 15000, note: "" }, AT("12:00"));
  // L'après-midi : le rendez-vous 2 est annulé, l'acompte de la veille est remboursé en espèces ; il entre dans le 28.
  ctx.db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 2");
  ctx.storage.transaction!((d) => settleDeposit(d, parseSettleRequest(1, { request_id: "rembourse-jour-1", action: "refund", refunds: [{ method: "cash", amount: 10000 }] }), { now: AT("18:00"), accountId: 1 }));
  const evening = dayReport(ctx.db, "2026-09-28", AT("18:30"));
  assert.deepEqual([evening.open.count, evening.open.summary.deposits.refunded, evening.open.summary.cash_expected], [1, { count: 1, total: 10000 }, -10000], "« Après clôture » : le remboursement seul");
  const second = ctx.close({ request_id: "cloture-acompte-2", day: "2026-09-28", cash_counted: 0, note: "" }, AT("18:30"));
  const report = dayReport(ctx.db, "2026-09-28", AT("19:00"));
  const [c1, c2] = report.closings;
  assert.deepEqual([c1.id, c2.id, c1.summary.deposits.received.count, c2.summary.deposits.received.count, c2.summary.deposits.refunded.total, c2.cash_expected, c2.difference], [first.id, second.id, 1, 0, 10000, -10000, 10000]);
  assert.equal(report.open.count, 0);
  assert.throws(() => ctx.close({ request_id: "cloture-acompte-3", day: "2026-09-28", cash_counted: 0, note: "" }, AT("19:00")), (e: unknown) => e instanceof SaleError && e.key === "cloture.rien");
  const veille = dayReport(ctx.db, "2026-09-27", AT("19:00"));
  assert.deepEqual(veille.open.summary.deposits.received, { count: 1, total: 10000 }, "l'acompte de la veille reste dans la veille");
  const text = (lang: "fr" | "en", c = c2) => closingRows(c, {}, lang).filter((r) => r.type === "pair").map((r) => `${(r as { left: string }).left} | ${(r as { right: string }).right}`);
  assert.ok(text("fr", c1).includes("1 acompte reçu | 10\u00a0000\u00a0FCFA"), JSON.stringify(text("fr", c1)));
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    assert.ok(text("fr", c1).includes("1 acompte reçu | 100,00\u00a0EUR"), JSON.stringify(text("fr", c1)));
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
  assert.ok(text("fr").includes("1 acompte remboursé | \u221210\u00a0000\u00a0FCFA"), JSON.stringify(text("fr")));
  assert.ok(text("en").includes("1 deposit refunded | \u221210\u00a0000\u00a0FCFA"));
  assert.ok(!text("fr").some((l) => l.includes("acompte reçu")), "pas de ligne vide d'acomptes reçus");
  // Report de la vague 3a : la seconde clôture ne prétend plus couvrir « De … à … » (une vente écrite en retard peut être plus ancienne).
  const header = (lang: "fr" | "en", c = c2) => closingRows(c, {}, lang).filter((r) => r.type === "text").map((r) => (r as { text: string }).text);
  assert.ok(header("fr").includes("Après la clôture n°\u00a01, jusqu'à 18:30"), JSON.stringify(header("fr")));
  assert.ok(header("en").includes("After closing no. 1, until 18:30"));
  assert.ok(header("fr", c1).includes("De 00:00 à 12:00"));
});

test("clôture enregistrée avant la vague 3b : résumé sans acomptes lu comme zéro", (t) => {
  const ctx = base(t);
  ctx.db.prepare(`INSERT INTO cash_closings (day, seq, closed_at, period_start, last_invoice_id, account_id, expected, cash_expected, cash_counted, difference, request_id)
    VALUES ('2026-09-27', 1, 0, 0, 0, 1, ?, 0, 0, 0, 'cloture-ancienne')`).run(JSON.stringify({ methods: [], invoices: { count: 0, total: 0 }, credit_notes: { count: 0, total: 0 }, tips: [], cash_expected: 0 }));
  const old = dayReport(ctx.db, "2026-09-27", AT("19:00")).closings[0];
  assert.deepEqual([old.last_payment_id, old.summary.deposits], [0, { received: { count: 0, total: 0 }, refunded: { count: 0, total: 0 } }]);
});

test("caisse du jour : tout le jour tant qu'aucune clôture ; clôture : écart, personne, heure ; après clôture à part ; seconde clôture sur la suite seulement", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  const before = dayReport(ctx.db, "2026-09-28", AT("13:00"));
  assert.deepEqual([before.closings.length, before.open.count, before.open.summary.cash_expected, before.documents.length], [0, 3, -15000, 3]);

  const first = ctx.close({ request_id: "cloture-0001", day: "2026-09-28", cash_counted: 0, note: "Fond de caisse retiré" }, AT("13:00"));
  ctx.sale("vente-soir-0001", AT("18:00"), { lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 35000, cash_given: 40000 }] });
  const after = dayReport(ctx.db, "2026-09-28", AT("18:30"));
  assert.equal(after.closings.length, 1);
  const c1 = after.closings[0];
  assert.deepEqual([c1.id, c1.seq, c1.closed_at, c1.account_name, c1.cash_expected, c1.cash_counted, c1.difference, c1.note], [first.id, 1, AT("13:00"), "Grâce", -15000, 0, 15000, "Fond de caisse retiré"]);
  assert.deepEqual([c1.summary.invoices.count, c1.summary.credit_notes.count], [2, 1]);
  assert.deepEqual([after.open.count, after.open.summary.cash_expected, after.open.summary.invoices.total], [1, 35000, 35000], "après clôture : la vente de 18:00 seulement");
  assert.deepEqual(after.documents.map((d) => [d.number, d.closing_id]), [["FAC-2026-000001", first.id], ["FAC-2026-000002", first.id], ["AV-2026-000001", first.id], ["FAC-2026-000003", null]]);

  const second = ctx.close({ request_id: "cloture-0002", day: "2026-09-28", cash_counted: 34500, note: "" }, AT("19:00"), 2);
  const end = dayReport(ctx.db, "2026-09-28", AT("19:05"));
  assert.deepEqual(end.closings.map((c) => [c.seq, c.summary.invoices.count, c.cash_expected, c.difference, c.account_name]), [[1, 2, -15000, 15000, "Grâce"], [2, 1, 35000, -500, "Ngozi"]]);
  assert.equal(end.open.count, 0);
  assert.equal(end.documents.at(-1)!.closing_id, second.id);
});

test("même request_id : une seule clôture ; rien de nouveau depuis la dernière clôture : refusée ; jour à venir ou illisible : refusé", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  const body = { request_id: "cloture-double", day: "2026-09-28", cash_counted: 0, note: "" };
  const first = ctx.close(body, AT("13:00"));
  const again = ctx.close(body, AT("13:01"));
  assert.deepEqual([first.replay, again.replay, again.id], [false, true, first.id]);
  assert.throws(() => ctx.close({ ...body, request_id: "cloture-vide-1" }, AT("14:00")), (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "cloture.rien");
  assert.throws(() => ctx.close({ ...body, request_id: "cloture-futur1", day: "2026-09-29" }, AT("14:00")), (e: unknown) => e instanceof SaleError && e.key === "cloture.jour");
  assert.throws(() => parseClosingRequest({ ...body, day: "2026-02-31" }), (e: unknown) => e instanceof SaleError && e.key === "cloture.jour");
  assert.throws(() => parseClosingRequest({ ...body, cash_counted: -1 }), (e: unknown) => e instanceof SaleError && e.key === "cloture.especes");
  assert.throws(() => parseClosingRequest({ ...body, note: "x".repeat(501) }), (e: unknown) => e instanceof SaleError && e.key === "cloture.note");
  const empty = ctx.close({ request_id: "cloture-veille1", day: "2026-09-27", cash_counted: 0, note: "" }, AT("14:00"));
  assert.equal(dayReport(ctx.db, "2026-09-27", AT("14:00")).closings[0].id, empty.id, "une journée sans vente se clôture une fois");
});

test("clôture immuable même en SQL direct ; numéro de clôture continu dans la journée", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  const { id } = ctx.close({ request_id: "cloture-sql-01", day: "2026-09-28", cash_counted: 0, note: "" }, AT("13:00"));
  assert.throws(() => ctx.db.prepare("UPDATE cash_closings SET cash_counted = 1000 WHERE id = ?").run(id), /Une clôture de caisse ne se modifie pas/);
  assert.throws(() => ctx.db.prepare("DELETE FROM cash_closings WHERE id = ?").run(id), /Une clôture de caisse ne se supprime pas/);
  assert.throws(() => ctx.db.prepare(
    "INSERT INTO cash_closings (day, seq, closed_at, period_start, last_invoice_id, account_id, expected, cash_expected, cash_counted, difference, request_id) VALUES ('2026-09-28', 3, 0, 0, 0, 1, '{}', 0, 0, 0, 'saut-00001')",
  ).run(), /Numéro de clôture hors de sa suite/);
  assert.throws(() => ctx.db.prepare(
    "INSERT INTO cash_closings (day, seq, closed_at, period_start, last_invoice_id, account_id, expected, cash_expected, cash_counted, difference, request_id) VALUES ('2026-09-28', 2, 0, 0, 0, 1, '{}', 100, 0, 0, 'ecart-faux1')",
  ).run(), /CHECK constraint failed/);
});

test("correctif : INSERT OR REPLACE ne remplace pas une clôture, ni par son request_id ni par son (jour, numéro)", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  const { id } = ctx.close({ request_id: "cloture-repl-01", day: "2026-09-28", cash_counted: 0, note: "" }, AT("13:00"));
  const sameRequestId = `INSERT OR REPLACE INTO cash_closings
    (day, seq, closed_at, period_start, last_invoice_id, account_id, expected, cash_expected, cash_counted, difference, note, request_id)
    VALUES ('2026-09-28', 99, 0, 0, 0, 1, '{}', 0, 999, 999, '', 'cloture-repl-01')`;
  const sameDaySeq = `INSERT OR REPLACE INTO cash_closings
    (day, seq, closed_at, period_start, last_invoice_id, account_id, expected, cash_expected, cash_counted, difference, note, request_id)
    VALUES ('2026-09-28', 1, 0, 0, 0, 1, '{}', 0, 999, 999, '', 'cloture-repl-02')`;
  assert.throws(() => ctx.db.prepare(sameRequestId).run(), /Une clôture de caisse ne se modifie pas/);
  assert.throws(() => ctx.db.prepare(sameDaySeq).run(), /Une clôture de caisse ne se modifie pas/);
  assert.equal((ctx.db.prepare("SELECT cash_counted FROM cash_closings WHERE id = ?").get(id) as { cash_counted: number }).cash_counted, 0, "la clôture d'origine n'a pas bougé");
});

test("correctif : les périodes se délimitent par l'identifiant des documents, pas par issued_at", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  const first = ctx.close({ request_id: "cloture-race-01", day: "2026-09-28", cash_counted: 0, note: "" }, AT("13:00"));
  // `now` figé avant des `await` (réglages, approbation, instantanés) : la vente s'écrit après la clôture avec un issued_at antérieur à closed_at.
  // 30 s avant le dernier document de la matinée (12:00) : dans la minute que tolère la garde de l'heure (distribution D-13).
  ctx.sale("vente-retard-001", AT("12:00") - 30_000, { lines: [{ kind: "product", ref_id: 1, quantity: 1 }], payments: [{ method: "cash", amount: 35000, cash_given: 35000 }] });
  const before = dayReport(ctx.db, "2026-09-28", AT("13:30"));
  const late = before.documents.find((d) => d.number === "FAC-2026-000003")!;
  assert.ok(late.issued_at < AT("13:00"), "la vente a bien un issued_at antérieur à closed_at");
  assert.deepEqual([late.closing_id, before.open.count], [null, 1], "après clôture malgré un issued_at avant closed_at");
  assert.ok(before.documents.filter((d) => d.closing_id === first.id).length === 3, "les 3 documents de la matinée restent dans la première clôture");
  const second = ctx.close({ request_id: "cloture-race-02", day: "2026-09-28", cash_counted: 35000, note: "" }, AT("14:00"));
  const after = dayReport(ctx.db, "2026-09-28", AT("14:30"));
  assert.equal(after.documents.find((d) => d.number === "FAC-2026-000003")!.closing_id, second.id, "une seconde clôture la couvre");
});

test("correctif : request_id déjà utilisé pour un autre jour, refusé (409)", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  ctx.close({ request_id: "cloture-jour-x", day: "2026-09-28", cash_counted: 0, note: "" }, AT("13:00"));
  assert.throws(
    () => ctx.close({ request_id: "cloture-jour-x", day: "2026-09-27", cash_counted: 0, note: "" }, AT("13:01")),
    (e: unknown) => e instanceof SaleError && e.status === 409 && e.key === "cloture.requete_jour",
  );
});

test("correctif : heure réelle de clôture sur le ticket, quand elle tombe après la fin du jour clôturé", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  ctx.close({ request_id: "cloture-retard-01", day: "2026-09-28", cash_counted: 0, note: "" }, Date.parse("2026-09-29T09:00:00+01:00"));
  const closing = dayReport(ctx.db, "2026-09-28", Date.parse("2026-09-29T09:00:00+01:00")).closings[0];
  const asLines = (lang: "fr" | "en") => closingRows(closing, {}, lang).filter((r) => r.type === "text").map((r) => (r as { text: string }).text);
  assert.ok(asLines("fr").includes("Clôturée le 29/09/2026 à 09:00"), "date et heure réelles de la clôture, pas celles du jour clôturé");
  assert.ok(asLines("en").includes("Closed on 29/09/2026 at 09:00"));
});

test("ticket de clôture : période, personne, factures et avoirs, net par moyen, espèces attendues, comptées, écart, pourboires dus ; en anglais aussi", (t) => {
  const ctx = base(t);
  busyMorning(ctx);
  ctx.close({ request_id: "cloture-ticket1", day: "2026-09-28", cash_counted: 0, note: "Fond retiré" }, AT("13:00"));
  const closing = dayReport(ctx.db, "2026-09-28", AT("13:00")).closings[0];
  const nb = "\u00a0";
  const text = (lang: "fr" | "en") => closingRows(closing, { nom: "Institut Akwa", adresse: "Bonapriso, Douala" }, lang)
    .map((r) => (r.type === "pair" ? `${r.left} | ${r.right}` : r.type === "text" ? r.text : r.type));
  const fr = text("fr");
  for (const expected of [
    "Institut Akwa", "CLÔTURE DE CAISSE", `28/09/2026 · n°${nb}1`, "De 00:00 à 13:00", "Clôturée par Grâce",
    `2 factures | 60${nb}000${nb}FCFA`, `1 avoir | −35${nb}000${nb}FCFA`,
    `Espèces | −15${nb}000${nb}FCFA`, `Reçu 20${nb}000${nb}FCFA, remboursé 35${nb}000${nb}FCFA`, `Carte | 35${nb}000${nb}FCFA`, `Orange Money | 7${nb}000${nb}FCFA`,
    `Espèces attendues | −15${nb}000${nb}FCFA`, `Espèces comptées | 0${nb}FCFA`, `Écart | +15${nb}000${nb}FCFA`, `Note${nb}: Fond retiré`,
    "Pourboires dus", `Solange | 2${nb}000${nb}FCFA`,
  ]) assert.ok(fr.includes(expected), expected);
  assert.ok(!fr.some((l) => l.startsWith("MoMo")), "un moyen sans mouvement n'est pas imprimé");
  const en = text("en");
  for (const expected of ["TILL CLOSING", `28/09/2026 · no.${nb}1`, "From 00:00 to 13:00", "Closed by Grâce", `2 invoices | 60${nb}000${nb}FCFA`, "Tips owed", `Difference | +15${nb}000${nb}FCFA`]) {
    assert.ok(en.includes(expected), expected);
  }
  // Renommage lama : plus de cygne, « propulsé par lama » en pied, nom vide omis.
  assert.ok(!fr.includes("logo"), "aucune rangée de logo");
  assert.equal(fr.at(-1), "propulsé par lama");
  assert.equal(en.at(-1), "powered by lama");
  const sansNom = closingRows(closing, { nom: "", adresse: "" }, "fr");
  assert.ok(!sansNom.some((r) => r.type === "text" && r.style === "nom"), "nom vide : pas de ligne de nom");
});

test("borne basse (report de la vague 3a) : un jour se clôture dans les 30 jours qui le suivent, au-delà il reste consultable", (t) => {
  const ctx = base(t);
  assert.throws(() => ctx.close({ request_id: "cloture-vieille-1", day: "2026-08-28", cash_counted: 0, note: "" }, AT("13:00")),
    (e: unknown) => e instanceof SaleError && e.status === 400 && e.key === "cloture.trop_ancien");
  assert.equal(ctx.close({ request_id: "cloture-limite-1", day: "2026-08-29", cash_counted: 0, note: "" }, AT("13:00")).replay, false, "30 jours pile : permis");
  assert.equal(dayReport(ctx.db, "2026-08-01", AT("13:00")).day, "2026-08-01", "toujours consultable");
});

test("ticket de clôture : logo en tête ; « Logo seul » : nom en petit avant la signature ; sans logo, nom en tête", () => {
  const summary = summarize({ documents: [], payments: [], tips: [], deposits: [] });
  const closing = {
    id: 1, day: "2026-09-28", seq: 1, closed_at: Date.parse("2026-09-28T18:00:00Z"), period_start: Date.parse("2026-09-28T07:00:00Z"),
    last_invoice_id: 0, last_payment_id: 0, account_id: 1, account_name: "Grâce", cash_expected: 0, cash_counted: 0, difference: 0, note: "", summary,
  };
  const nom = { type: "text", text: "Institut Akwa", style: "nom", align: "center" };
  const petit = { type: "text", text: "Institut Akwa", style: "mention", align: "center" };
  const both = closingRows(closing, { nom: "Institut Akwa", marque_documents: "logo_nom" }, "fr", { logo: true });
  assert.deepEqual(both.slice(0, 2), [{ type: "logo" }, nom]);
  const alone = closingRows(closing, { nom: "Institut Akwa", marque_documents: "logo" }, "fr", { logo: true });
  assert.deepEqual(alone[0], { type: "logo" });
  assert.ok(!alone.some((r) => r.type === "text" && r.style === "nom"));
  assert.deepEqual(alone[alone.length - 2], petit);
  const noLogo = closingRows(closing, { nom: "Institut Akwa", marque_documents: "logo" }, "fr");
  assert.deepEqual(noLogo[0], nom);
  assert.ok(!noLogo.some((r) => r.type === "logo"));
});
