import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDepositPayment, awaitsManager, canSettle, canTakeDeposit, depositBlocker, depositBody, depositPayments, depositShare, heldDeposit, removeDepositPayment, setDepositAmount, setDepositPayment,
  settleBlocker, settleBody, startDeposit, startSettle,
} from "./acompte.ts";
import type { Deposit } from "./caisse-types.ts";

/**
 * Acomptes dans la fiche d'un rendez-vous (sous-projet 5 § 6.2), règles sans
 * navigateur : qui encaisse, qui rembourse ou garde, formulaire d'acompte et
 * de son sort, mêmes refus que le serveur.
 */

function deposit(over: Partial<Deposit> = {}): Deposit {
  return {
    id: 1, number: "AC-2026-000001", appointment_id: 1, client_id: 3, client_name: "Aïcha", amount: 10000, issued_at: 0, account_name: "Grâce", status: "held",
    applied_invoice_id: null, applied_invoice_number: null, settled_at: null, settled_by_name: null, settle_reason: "",
    appointment: { identifier: "APT-1", date: "2026-10-03", time: "10:00", status: "booked" }, payments: [{ method: "orange_money", amount: 10000, reference: "OM-1" }],
    ...over,
  };
}
const ON = { practitioner_checkout: false, deposits: true };
const booked = { status: "booked", paid: 0, total_price: 25000 };

test("« Encaisser un acompte » : gérante et réception, fonction activée, rendez-vous à venir non payé, aucun acompte en attente", () => {
  assert.equal(canTakeDeposit("manager", ON, booked, []), true);
  assert.equal(canTakeDeposit("reception", ON, { ...booked, status: "confirmed" }, []), true);
  assert.equal(canTakeDeposit("practitioner", ON, booked, []), false, "la praticienne jamais");
  assert.equal(canTakeDeposit("manager", { ...ON, deposits: false }, booked, []), false, "fonction désactivée");
  assert.equal(canTakeDeposit("manager", null, booked, []), false, "réglages pas encore lus");
  assert.equal(canTakeDeposit("manager", ON, { ...booked, status: "in_progress" }, []), false, "rendez-vous commencé : on encaisse le rendez-vous");
  assert.equal(canTakeDeposit("manager", ON, { ...booked, paid: 1 }, []), false);
  assert.equal(canTakeDeposit("manager", ON, booked, [deposit()]), false, "un seul acompte en attente");
  assert.equal(canTakeDeposit("manager", ON, booked, [deposit({ status: "refunded" })]), true, "un acompte remboursé n'empêche pas d'en prendre un autre");
  assert.equal(heldDeposit([deposit({ id: 1, status: "applied" }), deposit({ id: 2 })])?.id, 2);
});

test("« Rembourser » et « Garder » : la gérante, acompte en attente, rendez-vous annulé ou cliente absente ; la réception le voit en attente", () => {
  assert.equal(canSettle("manager", { status: "cancelled" }, deposit()), true);
  assert.equal(canSettle("manager", { status: "no_show" }, deposit()), true);
  assert.equal(canSettle("manager", { status: "booked" }, deposit()), false);
  assert.equal(canSettle("reception", { status: "cancelled" }, deposit()), false);
  assert.equal(canSettle("manager", { status: "cancelled" }, deposit({ status: "kept" })), false);
  assert.equal(awaitsManager("reception", { status: "cancelled" }, deposit()), true);
  assert.equal(awaitsManager("manager", { status: "cancelled" }, deposit()), false);
});

test("formulaire d'acompte : un seul moyen porte tout le montant ; plusieurs doivent l'égaler ; plafond des prestations prévues ; référence", () => {
  let d = startDeposit(["cash", "orange_money"], "acompte-ecran-01");
  assert.deepEqual(d, { request_id: "acompte-ecran-01", amount: 0, payments: [{ method: "cash", amount: 0, reference: "" }] });
  assert.equal(depositBlocker(d, 25000), "montant");
  d = setDepositAmount(d, 30000);
  assert.equal(depositBlocker(d, 25000), "plafond");
  d = setDepositAmount(d, 10000);
  assert.equal(depositBlocker(d, 25000), null);
  assert.deepEqual(depositPayments(d), [{ method: "cash", amount: 10000, reference: "" }]);
  d = addDepositPayment(d, ["cash", "orange_money"]);
  assert.deepEqual(d.payments.map((p) => p.method), ["cash", "orange_money"]);
  assert.equal(addDepositPayment(d, ["cash", "orange_money"]), d, "pas plus de moyens que de moyens proposés");
  d = setDepositPayment(setDepositPayment(d, 0, { amount: 4000 }), 1, { amount: 5000 });
  assert.equal(depositBlocker(d, 25000), "ecart");
  d = setDepositPayment(d, 1, { amount: 6000 });
  assert.equal(depositBlocker(d, 25000), "reference");
  d = setDepositPayment(d, 1, { reference: "  OM-9  " });
  assert.equal(depositBlocker(d, 25000), null);
  assert.deepEqual(depositBody(7, d), {
    request_id: "acompte-ecran-01", appointment_id: 7, amount: 10000,
    payments: [{ method: "cash", amount: 4000, reference: "" }, { method: "orange_money", amount: 6000, reference: "OM-9" }],
  });
  assert.equal(removeDepositPayment(d, 1).payments.length, 1);
  assert.equal(removeDepositPayment(removeDepositPayment(d, 1), 0).payments.length, 1, "jamais moins d'un moyen");
});

test("sort d'un acompte : rembourser tout le montant par le moyen choisi, référence pour Orange Money et MoMo ; garder avec un motif", () => {
  const refund = startSettle(deposit(), "refund", "rembourse-ecran-1");
  assert.deepEqual([refund.method, settleBlocker(refund)], ["orange_money", "reference"], "proposé : le premier moyen de l'acompte");
  assert.deepEqual(settleBody(deposit(), { ...refund, reference: "OM-R-1" }), {
    request_id: "rembourse-ecran-1", action: "refund", reason: "", refunds: [{ method: "orange_money", amount: 10000, reference: "OM-R-1" }],
  });
  assert.equal(settleBlocker({ ...refund, method: "cash" }), null);
  const keep = startSettle(deposit(), "keep", "garde-ecran-01");
  assert.equal(settleBlocker(keep), "motif");
  assert.deepEqual(settleBody(deposit(), { ...keep, reason: " Annulée la veille " }), { request_id: "garde-ecran-01", action: "keep", reason: "Annulée la veille" });
});

test("acompte au ticket : déduit du montant à payer (pourboire compris), jamais en dessous de zéro, dépassement signalé", () => {
  const totals = { subtotal: 25000, discount_amount: 0, total_ttc: 25000, total_ht: 20964, total_tva: 4036, tip: 1000, due: 26000 };
  assert.deepEqual(depositShare(totals, 3, null), { totals, deposit: null, exceeds: false, otherClient: false });
  assert.deepEqual(depositShare(totals, 3, deposit()), { totals: { ...totals, due: 16000 }, deposit: { number: "AC-2026-000001", amount: 10000 }, exceeds: false, otherClient: false });
  assert.deepEqual(depositShare({ ...totals, due: 26000 }, 3, deposit({ amount: 26000 })).totals.due, 0, "acompte égal au dû : rien à payer, vente émise sans versement");
  const over = depositShare({ ...totals, total_ttc: 8000, due: 8000 }, 3, deposit());
  assert.deepEqual([over.totals.due, over.exceeds], [0, true]);
});

// Correctif tâche 6 (relecture) : le serveur (server/caisse/vente.ts, refus acompte.depasse) compare
// l'acompte au total TTC seul, jamais au dû augmenté du pourboire ; l'écran doit refuser au même seuil.
test("acompte au ticket : dépassement comparé au total TTC seul, jamais au dû augmenté du pourboire", () => {
  const totals = { subtotal: 25000, discount_amount: 0, total_ttc: 25000, total_ht: 20964, total_tva: 4036, tip: 1000, due: 26000 };
  const between = depositShare(totals, 3, deposit({ amount: 25500 }));
  assert.deepEqual([between.totals.due, between.exceeds], [500, true], "25 500 dépasse le total TTC (25 000) bien qu'il reste sous le dû (26 000) : le serveur refuserait");
});

// Mineur 3 (relecture finale) : la cliente du ticket a changé après l'acompte (ChoixCliente, « Changer »),
// l'acompte reste celui de l'autre cliente ; rien n'est déduit, comme le refus acompte.autre_cliente du serveur.
test("acompte au ticket : cliente du ticket différente de celle de l'acompte, rien n'est déduit", () => {
  const totals = { subtotal: 25000, discount_amount: 0, total_ttc: 25000, total_ht: 20964, total_tva: 4036, tip: 1000, due: 26000 };
  const other = depositShare(totals, 9, deposit({ client_id: 3 }));
  assert.deepEqual(other, { totals, deposit: { number: "AC-2026-000001", amount: 10000 }, exceeds: false, otherClient: true });
  assert.deepEqual(depositShare(totals, null, deposit({ client_id: 3 })).otherClient, true, "ticket sans cliente choisie : pas celle de l'acompte non plus");
});
