import assert from "node:assert/strict";
import { test } from "node:test";
import { canClose, differenceOf, documentGroups, movedMethods, parseCounted, shiftDay, signedPrice } from "./caisse-jour.ts";
import type { CashDay, ClosingSummary } from "./caisse-types.ts";
import { closingSource, invoiceSource } from "./ticket-pdf.ts";

/**
 * « Caisse du jour » (sous-projet 5 § 6.3), règles sans navigateur : jours
 * voisins, espèces comptées saisies, écart, moyens montrés, documents
 * rangés par clôture, clôture possible ou non, ticket de clôture.
 */

const EMPTY: ClosingSummary = {
  methods: [
    { method: "cash", received: 0, refunded: 0, net: 0 }, { method: "card", received: 0, refunded: 0, net: 0 },
    { method: "orange_money", received: 0, refunded: 0, net: 0 }, { method: "momo", received: 0, refunded: 0, net: 0 },
  ],
  invoices: { count: 0, total: 0 }, credit_notes: { count: 0, total: 0 }, tips: [], cash_expected: 0,
  deposits: { received: { count: 0, total: 0 }, refunded: { count: 0, total: 0 } },
};

function report(over: Partial<CashDay> = {}): CashDay {
  return { day: "2026-09-28", closings: [], open: { period_start: 0, count: 0, summary: EMPTY }, documents: [], ...over };
}

const doc = (id: number, closing_id: number | null) => ({
  id, kind: "invoice" as const, number: `FAC-2026-00000${id}`, issued_at: id, total_ttc: 1000, client_name: null, account_name: "Grâce", credited_number: null, closing_id,
});

test("jours voisins, passage de mois et d'année compris", () => {
  assert.equal(shiftDay("2026-09-28", -1), "2026-09-27");
  assert.equal(shiftDay("2026-09-30", 1), "2026-10-01");
  assert.equal(shiftDay("2026-12-31", 1), "2027-01-01");
});

test("espèces comptées : vide, zéro, milliers séparés, texte illisible", () => {
  assert.equal(parseCounted(""), null);
  assert.equal(parseCounted("   "), null);
  assert.equal(parseCounted("0"), 0);
  assert.equal(parseCounted("34 500"), 34500);
  assert.equal(parseCounted("34.500"), 34500);
  assert.equal(parseCounted("abc"), null);
});

test("écart : juste, de plus, de moins", () => {
  assert.deepEqual(differenceOf(35000, 35000), { kind: "juste", amount: 0 });
  assert.deepEqual(differenceOf(35000, 36000), { kind: "plus", amount: 1000 });
  assert.deepEqual(differenceOf(35000, 34500), { kind: "moins", amount: 500 });
  assert.deepEqual(differenceOf(-15000, 0), { kind: "plus", amount: 15000 });
});

test("moyens montrés : les espèces toujours, les autres s'ils ont bougé", () => {
  const summary = { ...EMPTY, methods: EMPTY.methods.map((m) => (m.method === "momo" ? { ...m, received: 5000, net: 5000 } : m)) };
  assert.deepEqual(movedMethods(summary).map((m) => m.method), ["cash", "momo"]);
  assert.deepEqual(movedMethods(EMPTY).map((m) => m.method), ["cash"]);
});

test("documents rangés par clôture, puis ceux pas encore clôturés", () => {
  const closing = { id: 7, day: "2026-09-28", seq: 1, closed_at: 2, period_start: 0, account_id: 1, account_name: "Grâce", cash_expected: 0, cash_counted: 0, difference: 0, note: "", summary: EMPTY };
  const groups = documentGroups(report({ closings: [closing], documents: [doc(1, 7), doc(2, 7), doc(3, null)] }));
  assert.deepEqual(groups.map((g) => [g.closing?.id ?? null, g.documents.map((d) => d.id)]), [[7, [1, 2]], [null, [3]]]);
  assert.deepEqual(documentGroups(report({ documents: [doc(1, null)] })).map((g) => g.closing), [null]);
  assert.deepEqual(documentGroups(report()), []);
});

test("clôture possible : jour passé ou du jour, et quelque chose de nouveau depuis la précédente", () => {
  assert.equal(canClose(report(), "2026-09-28"), true, "première clôture, même d'une journée sans vente");
  assert.equal(canClose(report({ day: "2026-09-29" }), "2026-09-28"), false, "jour à venir");
  assert.equal(canClose(report({ day: "2026-08-29" }), "2026-09-28"), true, "30 jours plus tôt : encore permis");
  assert.equal(canClose(report({ day: "2026-08-28" }), "2026-09-28"), false, "au-delà de 30 jours : consultable seulement");
  const closed = report({ closings: [{ id: 7, day: "2026-09-28", seq: 1, closed_at: 2, period_start: 0, account_id: 1, account_name: null, cash_expected: 0, cash_counted: 0, difference: 0, note: "", summary: EMPTY }] });
  assert.equal(canClose(closed, "2026-09-28"), false, "rien depuis la dernière clôture");
  assert.equal(canClose({ ...closed, open: { ...closed.open, count: 1 } }, "2026-09-28"), true, "après clôture : seconde clôture");
});

test("tickets : facture et clôture, adresse et nom du fichier", () => {
  assert.deepEqual(invoiceSource({ id: 3, number: "FAC-2026-000003" }), { path: "/api/invoices/3/pdf", fileName: "FAC-2026-000003.pdf" });
  assert.deepEqual(closingSource({ id: 7, day: "2026-09-28", seq: 2 }), { path: "/api/cash/closings/7/pdf", fileName: "cloture-2026-09-28-2.pdf" });
});

test("montant signé : moins typographique, jamais le tiret du clavier", () => {
  assert.equal(signedPrice(-9750, "fr"), "\u22129\u202f750\u00a0F");
  assert.equal(signedPrice(35000, "en"), "35\u202f000\u00a0F");
});
