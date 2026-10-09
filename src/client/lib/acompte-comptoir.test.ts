import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { chosenCounterDeposit, counterDepositEligible, counterOffer, depositShare, syncCounterDeposit } from "./acompte.ts";
import type { Deposit } from "./caisse-types.ts";
import { emptyTicket, saleBody, setClient, type Ticket } from "./ticket.ts";

/**
 * V1-78 à l'écran : la vente au comptoir de produits seuls propose de déduire
 * le plus ancien acompte utilisable de la cliente, coché par défaut ; la
 * caissière peut le décocher ; une prestation ou une autre cliente retire la
 * proposition.
 */

function deposit(over: Partial<Deposit> = {}): Deposit {
  return {
    id: 7, number: "AC-2026-000007", appointment_id: 4, client_id: 3, client_name: "Aïcha", amount: 5000, issued_at: 0, account_name: "Grâce", status: "held",
    applied_invoice_id: null, applied_invoice_number: null, settled_at: null, settled_by_name: null, settle_reason: "",
    appointment: { identifier: "APT-4", date: "2026-10-05", time: "09:00", status: "cancelled" }, payments: [{ method: "cash", amount: 5000, reference: "" }],
    ...over,
  };
}
const produits = (over: Partial<Ticket> = {}): Ticket => ({ ...emptyTicket("v-000000000000000000000001"), client_id: 3, lines: [{ kind: "product", ref_id: 2, quantity: 1, staff_id: null }], ...over });
const list = [deposit(), deposit({ id: 9, number: "AC-2026-000009", amount: 2000 })];

test("vente au comptoir proposable : gérante ou réception, sans rendez-vous, cliente choisie, au moins une ligne, que des produits", () => {
  assert.equal(counterDepositEligible("reception", produits()), true);
  assert.equal(counterDepositEligible("manager", produits()), true);
  assert.equal(counterDepositEligible("practitioner", produits()), false);
  assert.equal(counterDepositEligible("reception", produits({ appointment_id: 4 })), false);
  assert.equal(counterDepositEligible("reception", produits({ client_id: null })), false);
  assert.equal(counterDepositEligible("reception", produits({ lines: [] })), false);
  assert.equal(counterDepositEligible("reception", produits({ lines: [{ kind: "product", ref_id: 2, quantity: 1, staff_id: null }, { kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }] })), false);
});

test("proposition : le plus ancien coché par défaut, refus gardé, retirée par une prestation, refaite pour une autre cliente", () => {
  const first = syncCounterDeposit(produits(), "reception", list);
  assert.equal(first.deposit_id, 7, "le plus ancien, coché");
  assert.equal(syncCounterDeposit(first, "reception", list), first, "rien ne change : même objet, pas de boucle");
  // Point fixe en un pas (l'effet de vente.tsx ne met à jour que si l'objet change) : jamais de boucle.
  const none = produits();
  assert.equal(syncCounterDeposit(none, "reception", []), none, "aucun acompte : même objet");
  const counterSale = produits({ lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 1 }] });
  assert.equal(syncCounterDeposit(counterSale, "reception", list), counterSale, "vente non proposable sans acompte : même objet");
  const cleared = syncCounterDeposit({ ...first, client_id: null }, "reception", list);
  assert.equal(syncCounterDeposit(cleared, "reception", list), cleared, "proposition retirée : même objet au passage suivant");
  assert.equal(syncCounterDeposit(produits(), "reception", null).deposit_id, undefined, "liste pas encore chargée");
  const declined = { ...first, deposit_id: null };
  assert.equal(syncCounterDeposit(declined, "reception", list), declined, "la case décochée reste décochée");
  const withService = { ...first, lines: [...first.lines, { kind: "service" as const, ref_id: 1, quantity: 1, staff_id: 1 }] };
  assert.equal(syncCounterDeposit(withService, "reception", list).deposit_id, undefined, "une prestation retire la proposition");
  assert.equal(setClient(declined, 8).deposit_id, undefined, "autre cliente : nouvelle proposition");
  assert.equal(setClient(declined, 3).deposit_id, null, "même cliente : refus gardé");
  assert.equal(syncCounterDeposit({ ...first, deposit_id: 99 }, "reception", list).deposit_id, 7, "acompte disparu (déduit ailleurs) : le suivant");
  assert.equal(syncCounterDeposit(produits(), "reception", [deposit({ client_id: 8 })]).deposit_id, undefined, "liste d'une autre cliente (pas encore rechargée) : rien");
});

test("case et montant : l'offre, l'acompte choisi, le dû diminué ; la demande porte deposit_id seulement au comptoir", () => {
  const first = syncCounterDeposit(produits(), "reception", list);
  assert.equal(counterOffer(first, "reception", list)?.id, 7);
  assert.equal(counterOffer({ ...first, deposit_id: null }, "reception", list)?.id, 7, "décochée, la case reste proposée");
  assert.equal(counterOffer(produits({ client_id: null }), "reception", list), null);
  assert.equal(chosenCounterDeposit(first, list)?.number, "AC-2026-000007");
  assert.equal(chosenCounterDeposit({ ...first, deposit_id: null }, list), null);
  const totals = { subtotal: 6000, discount_amount: 0, total_ht: 6000, total_tva: 0, total_ttc: 6000, tip: 0, due: 6000 };
  assert.equal(depositShare(totals, 3, chosenCounterDeposit(first, list)).totals.due, 1000);
  assert.equal(saleBody(first).deposit_id, 7);
  assert.equal("deposit_id" in saleBody({ ...first, deposit_id: null }), false);
  assert.equal("deposit_id" in saleBody({ ...first, appointment_id: 4 }), false, "un rendez-vous déduit le sien, jamais celui choisi au comptoir");
});

test("écran de vente : liste du comptoir chargée par cliente, synchronisée hors paiement, case dans le ticket", () => {
  const vente = readFileSync(new URL("../components/caisse/vente.tsx", import.meta.url), "utf8");
  const ticket = readFileSync(new URL("../components/caisse/ticket-vente.tsx", import.meta.url), "utf8");
  assert.match(vente, /`\/api\/deposits\?client_id=\$\{counterClient\}`/);
  assert.match(vente, /if \(etape !== "ticket" \|\| pending \|\| issued\) return;/);
  assert.match(vente, /syncCounterDeposit\(ticket, account\.role, counter\.data\)/);
  assert.match(ticket, /<Case\s+id="caisse-acompte-comptoir"/);
  assert.match(ticket, /t\("caisse\.acompte_depasse_comptoir"/);
});
