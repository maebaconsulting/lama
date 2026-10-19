import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addRefund, canCredit, completesInvoice, creditBlocker, creditBody, creditPreview, draftRows, refundsOf, remainingOf, removeRefund, setQuantity, setReason, setRefund, setRestock, startCredit, supplementsLeft, takeAll, takeSupplements,
} from "./avoir.ts";
import type { Invoice } from "./caisse-types.ts";

/**
 * Formulaire « Émettre un avoir » (sous-projet 5 § 6.1), règles sans
 * navigateur : lignes et quantités reprises, remise en stock des produits,
 * montant calculé comme le serveur, remboursements qui doivent l'égaler.
 */

/** Facture de la maquette : soin 25 000 et crème 35 000, remise de 5 %, total 57 000, payée en espèces et Orange Money. */
function invoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 1, kind: "invoice", number: "FAC-2026-000001", issued_at: 0, lang: "fr", client_id: 1, client_name: "Aïcha", appointment_id: 1, appointment_identifier: "APT-1",
    account_name: "Grâce", subtotal: 60000, discount_amount: 3000, discount_kind: "percent", discount_value: 5, discount_reason: "fidelite",
    total_ttc: 57000, total_ht: 47799, total_tva: 9201, fiscal: { tva_active: true, tva_taux: 19.25 },
    lines: [
      { id: 11, kind: "service", ref_id: 1, label_fr: "Soin du visage éclat", label_en: "Radiance facial", quantity: 1, unit_price: 25000, line_total: 25000, staff_id: 1, staff_name: "Solange", credited: 0, credited_line_id: null, restock: 0 },
      { id: 12, kind: "product", ref_id: 1, label_fr: "Crème hydratante", label_en: "", quantity: 2, unit_price: 17500, line_total: 35000, staff_id: null, staff_name: null, credited: 0, credited_line_id: null, restock: 0 },
    ],
    payments: [{ method: "orange_money", amount: 57000, reference: "OM-1", cash_given: null, change_given: 0 }],
    tip: null, credited_invoice_id: null, credited_number: null, reason: "", credits: [], credited_total: 0, cancelled: false,
    ...over,
  };
}

test("droits : gérante toujours ; réception si la gérante l'autorise ; praticienne jamais", () => {
  assert.equal(canCredit("manager", { avoirs_reception: false }), true);
  assert.equal(canCredit("reception", { avoirs_reception: false }), false);
  assert.equal(canCredit("reception", { avoirs_reception: true }), true);
  assert.equal(canCredit("practitioner", { avoirs_reception: true }), false);
  assert.equal(canCredit("reception", null), false, "réglages pas encore lus : rien de montré");
});

test("formulaire vierge : lignes encore à reprendre, aucune prise, remise en stock décochée, remboursement par le premier moyen de la facture", () => {
  const inv = invoice({ lines: invoice().lines.map((l) => (l.id === 11 ? { ...l, credited: 1 } : l)) });
  assert.deepEqual([remainingOf(inv.lines[0]), remainingOf(inv.lines[1])], [0, 2]);
  const draft = startCredit(inv, "a-0123456789");
  assert.deepEqual(draft, { request_id: "a-0123456789", reason: "", lines: [{ line_id: 12, quantity: 0, restock: false }], refunds: [{ method: "orange_money", amount: 0, reference: "" }] });
  assert.equal(creditBlocker(inv, draft), "lignes");
});

test("quantités bornées au reste ; remise en stock pour un produit repris seulement ; « Tout reprendre »", () => {
  const inv = invoice();
  let d = startCredit(inv, "a-0123456789");
  d = setQuantity(inv, d, 12, 5);
  assert.equal(d.lines.find((l) => l.line_id === 12)!.quantity, 2, "jamais plus que le reste");
  d = setRestock(inv, d, 12, true);
  assert.equal(d.lines.find((l) => l.line_id === 12)!.restock, true);
  assert.equal(setRestock(inv, d, 11, true).lines.find((l) => l.line_id === 11)!.restock, false, "une prestation ne se remet pas en stock");
  d = setQuantity(inv, d, 12, 0);
  assert.deepEqual(d.lines.find((l) => l.line_id === 12), { line_id: 12, quantity: 0, restock: false }, "ligne rendue : case décochée");
  const all = takeAll(inv, startCredit(inv, "a-0123456789"));
  assert.deepEqual(all.lines.map((l) => l.quantity), [1, 2]);
});

test("montant calculé comme le serveur : prorata de la remise ; tout repris, le total exact de la facture", () => {
  const inv = invoice();
  const one = setQuantity(inv, startCredit(inv, "a-0123456789"), 12, 1);
  assert.deepEqual(creditPreview(inv, one), { subtotal: 17500, discount_amount: 875, total_ttc: 16625, total_ht: 13941, total_tva: 2684 });
  assert.equal(creditPreview(inv, takeAll(inv, one)).total_ttc, 57000);
  const rest = invoice({ credited_total: 16625, lines: inv.lines.map((l) => (l.id === 12 ? { ...l, credited: 1 } : l)) });
  assert.equal(creditPreview(rest, takeAll(rest, startCredit(rest, "a-0123456789"))).total_ttc, 40375, "le dernier avoir prend le reste");
});

test("montant calculé comme le serveur : prorata cumulé sur plusieurs avoirs successifs (avenant, correctif de la tâche 3)", () => {
  /** Facture de 5 lignes de 1 000 F, remise en montant de 3 F, total 4 997. */
  const base = invoice({
    subtotal: 5000, discount_amount: 3, discount_kind: "amount", discount_value: 3, total_ttc: 4997, total_ht: 4997, total_tva: 0,
    fiscal: { tva_active: false, tva_taux: 0 }, payments: [{ method: "cash", amount: 4997, reference: "", cash_given: 4997, change_given: 0 }],
    lines: [1, 2, 3, 4, 5].map((n) => ({
      id: n, kind: "product" as const, ref_id: n, label_fr: `Article ${n}`, label_en: `Item ${n}`, quantity: 1, unit_price: 1000, line_total: 1000,
      staff_id: null, staff_name: null, credited: 0, credited_line_id: null, restock: 0,
    })),
  });
  const amounts: number[] = [];
  let creditedTotal = 0;
  let inv = base;
  for (const id of [1, 2, 3, 4]) {
    const d = setQuantity(inv, startCredit(inv, "a-0123456789"), id, 1);
    const amount = creditPreview(inv, d).total_ttc;
    amounts.push(amount);
    creditedTotal += amount;
    inv = { ...inv, credited_total: creditedTotal, lines: inv.lines.map((l) => (l.id === id ? { ...l, credited: 1 } : l)) };
  }
  assert.deepEqual(amounts, [999, 1000, 999, 1000]);
  assert.equal(creditedTotal, 3998);
  const last = creditPreview(inv, takeAll(inv, startCredit(inv, "a-0123456789")));
  assert.equal(last.total_ttc, 999, "le reste exact (4 997 − 3 998)");
  assert.equal(creditedTotal + last.total_ttc, base.total_ttc, "la somme des avoirs égale le total de la facture");
});

test("remboursements : un seul moyen porte tout le montant ; plusieurs, leur somme doit l'égaler ; référence pour Orange Money et MoMo", () => {
  const inv = invoice();
  let d = setReason(takeAll(inv, startCredit(inv, "a-0123456789")), "Cliente mécontente");
  assert.deepEqual(refundsOf(d, 57000), [{ method: "orange_money", amount: 57000, reference: "" }]);
  assert.equal(creditBlocker(inv, d), "reference", "Orange Money sans référence");
  d = setRefund(d, 0, { reference: " OM-R-9 " });
  assert.equal(creditBlocker(inv, d), null);
  d = addRefund(d);
  assert.deepEqual(d.refunds.map((r) => r.method), ["orange_money", "cash"], "moyen suivant non encore pris");
  d = setRefund(setRefund(d, 0, { amount: 50000 }), 1, { amount: 5000 });
  assert.equal(creditBlocker(inv, d), "ecart");
  d = setRefund(d, 1, { amount: 7000 });
  assert.equal(creditBlocker(inv, d), null);
  assert.deepEqual(creditBody(inv, d), {
    request_id: "a-0123456789", invoice_id: 1, reason: "Cliente mécontente",
    lines: [{ line_id: 11, quantity: 1, restock: false }, { line_id: 12, quantity: 2, restock: false }],
    refunds: [{ method: "orange_money", amount: 50000, reference: "OM-R-9" }, { method: "cash", amount: 7000, reference: "" }],
  });
  assert.deepEqual(removeRefund(d, 1).refunds.map((r) => r.method), ["orange_money"]);
  assert.equal(creditBlocker(inv, setReason(d, "   ")), "motif");
});

test("avoir à 0 F (prestation offerte) : aucun remboursement envoyé, rien ne bloque", () => {
  const free = invoice({ subtotal: 0, discount_amount: 0, total_ttc: 0, total_ht: 0, total_tva: 0, payments: [],
    lines: [{ ...invoice().lines[0], unit_price: 0, line_total: 0 }] });
  const d = setReason(takeAll(free, startCredit(free, "a-0123456789")), "Offert par erreur");
  assert.deepEqual(d.refunds, [{ method: "cash", amount: 0, reference: "" }]);
  assert.deepEqual(refundsOf(d, 0), []);
  assert.equal(creditBlocker(free, d), null);
});

// Mineur 4 (relecture finale) : l'acompte ne se rappelle qu'une fois toute la facture reprise.
test("completesInvoice : vrai seulement quand chaque ligne est reprise à son reste (« Tout reprendre »)", () => {
  const inv = invoice();
  assert.equal(completesInvoice(inv, startCredit(inv, "a-0123456789")), false, "rien de pris");
  const partial = setQuantity(inv, startCredit(inv, "a-0123456789"), 11, 1);
  assert.equal(completesInvoice(inv, partial), false, "la crème n'est pas reprise");
  assert.equal(completesInvoice(inv, takeAll(inv, startCredit(inv, "a-0123456789"))), true);
  const already = invoice({ lines: invoice().lines.map((l) => (l.id === 11 ? { ...l, credited: 1 } : l)) });
  assert.equal(completesInvoice(already, takeAll(already, startCredit(already, "a-0123456789"))), true, "déjà repris ailleurs, compté comme le serveur (credited + pris)");
});

/** Facture avec suppléments : Tresses (11), puis Crème (12), puis Mèches et deux Perles rattachées à Tresses. */
function avecSupplements(): Invoice {
  const base = invoice();
  return invoice({
    lines: [
      { ...base.lines[0], id: 11, label_fr: "Tresses", parent_line_id: null },
      { ...base.lines[1], id: 12, parent_line_id: null },
      { ...base.lines[0], id: 13, label_fr: "Mèches", unit_price: 5000, line_total: 5000, parent_line_id: 11 },
      { ...base.lines[1], id: 14, label_fr: "Perles", quantity: 2, unit_price: 500, line_total: 1000, parent_line_id: 11 },
    ],
  });
}

test("avoir avec suppléments : chaque supplément sous sa prestation ; « Reprendre aussi ses suppléments » les met à leur reste", () => {
  const inv = avecSupplements();
  let draft = startCredit(inv, "a-essai-supp");
  assert.deepEqual(draftRows(inv, draft).map((r) => [r.line.id, r.supplement]), [[11, false], [13, true], [14, true], [12, false]]);
  draft = setQuantity(inv, draft, 11, 1);
  assert.equal(supplementsLeft(inv, draft, 11), true);
  draft = takeSupplements(inv, draft, 11);
  assert.deepEqual(draft.lines.map((d) => [d.line_id, d.quantity]), [[11, 1], [12, 0], [13, 1], [14, 2]]);
  assert.equal(supplementsLeft(inv, draft, 11), false);
  assert.equal(supplementsLeft(inv, draft, 12), false, "un produit seul n'a pas de suppléments");
});

test("takeSupplements : un supplément déjà en partie repris monte à son reste sans le dépasser", () => {
  const base = avecSupplements();
  const inv = { ...base, lines: base.lines.map((l) => (l.id === 14 ? { ...l, credited: 1 } : l)) };
  const draft = takeSupplements(inv, startCredit(inv, "a-essai-reste"), 11);
  assert.deepEqual(draft.lines.map((d) => [d.line_id, d.quantity]), [[11, 0], [12, 0], [13, 1], [14, 1]]);
});

test("draftRows : un supplément repris seul (prestation déjà reprise) n'est pas mis en retrait", () => {
  const base = avecSupplements();
  const inv = { ...base, lines: base.lines.map((l) => (l.id === 11 ? { ...l, credited: 1 } : l)) };
  const rows = draftRows(inv, startCredit(inv, "a-essai-seul"));
  assert.deepEqual(rows.map((r) => [r.line.id, r.supplement]), [[12, false], [13, false], [14, false]]);
});
