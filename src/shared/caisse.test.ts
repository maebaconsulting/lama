import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeBreakdown, creditTotals, dayBounds, discountAmount, documentNumber, exceedsCap, quickAmounts, saleTotals, settle, vatSplit, yearAt,
} from "./caisse.ts";
import { definirDevise } from "./devise-active.ts";
import { entierMineur } from "./montants.ts";

/** Calculs de la caisse (sous-projet 5 § 4.4), mêmes à l'écran et au serveur. */

const VAT = { active: true, rate: 19.25 };

test("TVA arrondie une seule fois, sur le total : HT plus TVA égale toujours TTC", () => {
  assert.deepEqual(vatSplit(57000, VAT), { ht: 47799, tva: 9201 }, "exemple de la maquette");
  assert.deepEqual(vatSplit(57000, { active: false, rate: 19.25 }), { ht: 57000, tva: 0 }, "TVA inactive");
  assert.deepEqual(vatSplit(0, VAT), { ht: 0, tva: 0 });
  for (let ttc = 1; ttc <= 20000; ttc += 7) {
    const { ht, tva } = vatSplit(ttc, VAT);
    assert.equal(ht + tva, ttc, `TTC ${ttc}`);
    assert.ok(Number.isInteger(ht) && Number.isInteger(tva) && tva >= 0, `TTC ${ttc}`);
    assert.equal(ht, Math.round(ttc / 1.1925), `un seul arrondi, TTC ${ttc}`);
  }
});

test("remise en pourcentage ou en montant, jamais au-delà du sous-total ; plafond en pour cent", () => {
  assert.equal(discountAmount(60000, { kind: "percent", value: 5 }), 3000);
  assert.equal(discountAmount(33333, { kind: "percent", value: 10 }), 3333, "arrondie au franc");
  assert.equal(discountAmount(60000, { kind: "amount", value: 2500 }), 2500);
  assert.equal(discountAmount(60000, { kind: "amount", value: 90000 }), 60000);
  assert.equal(discountAmount(60000, null), 0);
  assert.equal(exceedsCap(60000, 6000, 10), false, "10 % tout juste : pas de mot de passe");
  assert.equal(exceedsCap(60000, 6001, 10), true);
});

test("totaux d'une vente : TVA sur le total remisé, pourboire ajouté au montant à payer hors facture", () => {
  const totals = saleTotals({
    lines: [{ unit_price: 25000, quantity: 1 }, { unit_price: 35000, quantity: 1 }],
    discount: { kind: "percent", value: 5 },
    vat: VAT,
    tip: 2000,
  });
  assert.deepEqual(totals, { subtotal: 60000, discount_amount: 3000, total_ttc: 57000, total_ht: 47799, total_tva: 9201, tip: 2000, due: 59000 });
  assert.equal(entierMineur(12500.4), 12500, "prix du catalogue arrondi à l'entier");
  assert.equal(entierMineur(-3), 0);
});

test("montants rapides : exact puis les trois montants ronds au-dessus", () => {
  assert.deepEqual(quickAmounts(59000), [60000, 65000, 70000], "exemple de la maquette");
  assert.deepEqual(quickAmounts(57300), [58000, 60000, 65000]);
  assert.deepEqual(quickAmounts(12500), [13000, 14000, 15000]);
  assert.deepEqual(quickAmounts(0), []);
});

test("monnaie rendue : coupures suggérées, billets puis pièces, reste sous 10 francs", () => {
  assert.deepEqual(changeBreakdown(11000), { parts: [{ value: 10000, count: 1, kind: "billet" }, { value: 1000, count: 1, kind: "billet" }], rest: 0 });
  assert.deepEqual(changeBreakdown(3785).parts.map((p) => [p.value, p.count]), [[2000, 1], [1000, 1], [500, 1], [100, 2], [50, 1], [25, 1], [10, 1]]);
  assert.equal(changeBreakdown(3785).rest, 0);
  assert.equal(changeBreakdown(1003).rest, 3);
  assert.deepEqual(changeBreakdown(0), { parts: [], rest: 0 });
});

test("versements : somme égale au montant dû, monnaie exacte, carte jamais au-delà du reste", () => {
  const cash = settle(59000, [{ method: "cash", amount: 70000 }]);
  assert.deepEqual(cash.payments, [{ method: "cash", amount: 59000, reference: "", cash_given: 70000, change_given: 11000 }]);
  assert.deepEqual([cash.received, cash.remaining, cash.change, cash.invalid], [70000, 0, 11000, []]);

  const mixed = settle(59000, [{ method: "cash", amount: 20000 }, { method: "orange_money", amount: 39000, reference: " OM-4471 " }]);
  assert.equal(mixed.payments.reduce((s, p) => s + p.amount, 0), 59000);
  assert.deepEqual(mixed.payments[1], { method: "orange_money", amount: 39000, reference: "OM-4471", cash_given: null, change_given: 0 });
  assert.equal(mixed.remaining, 0);

  const partial = settle(59000, [{ method: "card", amount: 30000 }]);
  assert.equal(partial.remaining, 29000);
  assert.deepEqual(settle(59000, [{ method: "card", amount: 60000 }]).invalid, [0], "carte au-delà du reste");
  assert.deepEqual(settle(59000, [{ method: "card", amount: 59000 }, { method: "cash", amount: 1000 }]).invalid, [1], "versement en trop");
  assert.deepEqual(settle(59000, [{ method: "cash", amount: 0 }]).payments, [], "versement vide ignoré");
  // Retouche C (décision du 30/09/2026) : un dû nul (remise de 100 %, prestation offerte) est déjà réglé sans versement.
  assert.deepEqual(settle(0, []), { payments: [], received: 0, remaining: 0, change: 0, invalid: [] }, "dû nul : réglé sans aucun versement");
});

/**
 * Correctif 1 de la tâche 3 (relecture) : le prorata et la TVA des avoirs se
 * cumulent sur l'ensemble de ce qui a déjà été repris (`credited_subtotal`),
 * pas avoir par avoir, pour que le dernier avoir prenne exactement le reste
 * même après plusieurs arrondis, TVA comprise.
 */
test("avoir : prorata cumulé, le dernier avoir prend exactement le reste (5 lignes à 1 000 F, remise de 3 F)", () => {
  const invoice = { subtotal: 5000, total_ttc: 4997 };
  const vat = { active: true, rate: 19.25 };
  let credited = 0;
  let creditedSubtotal = 0;
  const amounts: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const totals = creditTotals({
      invoice, credited, credited_subtotal: creditedSubtotal, lines: [{ unit_price: 1000, quantity: 1 }], completes: i === 4, vat,
    });
    amounts.push(totals.total_ttc);
    credited += totals.total_ttc;
    creditedSubtotal += totals.subtotal;
  }
  assert.deepEqual(amounts, [999, 1000, 999, 1000, 999], "avec l'ancien calcul avoir par avoir : 999, 999, 999, 999, 1000 (somme 4 996)");
  assert.equal(amounts.reduce((sum, a) => sum + a, 0), invoice.total_ttc, "somme des avoirs = total de la facture");
});

test("avoir : TVA cumulée égale la TVA de la facture, pas la somme des TVA arrondies avoir par avoir (3 avoirs de 1 250 F)", () => {
  const invoice = { subtotal: 3750, total_ttc: 3750 };
  const vat = { active: true, rate: 19.25 };
  let credited = 0;
  let creditedSubtotal = 0;
  let totalTva = 0;
  for (let i = 0; i < 3; i += 1) {
    const totals = creditTotals({
      invoice, credited, credited_subtotal: creditedSubtotal, lines: [{ unit_price: 1250, quantity: 1 }], completes: i === 2, vat,
    });
    totalTva += totals.total_tva;
    credited += totals.total_ttc;
    creditedSubtotal += totals.subtotal;
  }
  assert.equal(totalTva, vatSplit(invoice.total_ttc, vat).tva, "605, pas 606 (3 fois la TVA de 1 250 F arrondie isolément)");
});

test("année et jour de Douala ; numéro sur six chiffres", () => {
  assert.equal(yearAt(Date.parse("2026-12-31T22:59:59Z")), 2026);
  assert.equal(yearAt(Date.parse("2026-12-31T23:00:00Z")), 2027, "minuit à Douala : la suite de l'année nouvelle");
  assert.deepEqual(dayBounds("2026-09-30"), { start: Date.parse("2026-09-29T23:00:00Z"), end: Date.parse("2026-09-30T23:00:00Z") });
  assert.equal(documentNumber("FAC", 2026, 12), "FAC-2026-000012");
});

test("montants rapides et rendu de monnaie en euros", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    assert.deepEqual(quickAmounts(1250), [1500, 2000, 5000]);       // 12,50 € : 15, 20, 50
    assert.deepEqual(quickAmounts(4800), [5000, 6000, 7500]);       // 48 € : 50, 60, puis par 25 € (dernier palier ÷ 2)
    assert.deepEqual(changeBreakdown(3787), {                       // 37,87 €
      parts: [{ value: 2000, count: 1, kind: "billet" }, { value: 1000, count: 1, kind: "billet" }, { value: 500, count: 1, kind: "billet" },
        { value: 200, count: 1, kind: "piece" }, { value: 50, count: 1, kind: "piece" }, { value: 20, count: 1, kind: "piece" },
        { value: 10, count: 1, kind: "piece" }, { value: 5, count: 1, kind: "piece" }, { value: 2, count: 1, kind: "piece" }],
      rest: 0,
    });
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});

test("devise sans pièces : l'appoint est ce qui reste sous le plus petit billet", () => {
  definirDevise({ code: "GNF", position: null, symboleEcran: true });
  try {
    assert.deepEqual(changeBreakdown(1300), { parts: [{ value: 1000, count: 1, kind: "billet" }], rest: 300 });
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});

// Non-régression : `discountAmount` et `vatSplit` ne lisent pas la devise ; ce test passe déjà avant le changement.
test("non-régression : remise en pourcentage arrondie au centime ; TVA en centimes", () => {
  definirDevise({ code: "EUR", position: null, symboleEcran: true });
  try {
    assert.equal(discountAmount(1999, { kind: "percent", value: 15 }), 300); // 2,9985 € : 3,00 €
    assert.deepEqual(vatSplit(1999, { active: true, rate: 20 }), { ht: 1666, tva: 333 });
  } finally {
    definirDevise({ code: "XAF", position: null, symboleEcran: true });
  }
});
