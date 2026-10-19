import assert from "node:assert/strict";
import { test } from "node:test";
import type { Invoice } from "./caisse-types.ts";
import type { Appointment, Product, Service } from "../types.ts";
import {
  addItem, addSupplement, defaultTipStaff, emptyTicket, fromAppointment, isEmpty, itemCount, keepIssued, keepPending, keepTicket, keptIssued, keptPending, keptTicket,
  needsClient, newRequestId, openFor, priceTicket, quantityOf, removeLine, removeSupplement, saleBody, setClient, setDiscount, setLineStaff, setQuantity, setSupplementQuantity, setTip,
} from "./ticket.ts";
import type { Ticket } from "./ticket.ts";

/** Ticket de l'écran « Vente » (sous-projet 5 § 4.1), vérifié en exécution. */

const service = (id: number, price: number, patch: Partial<Service> = {}): Service => ({
  id, name: `Soin ${id}`, description: "", duration: 60, price, color: "", category: "Visage", name_en: `Care ${id}`, description_en: "", category_en: "Face", active: 1, created_at: "", ...patch,
});
const product = (id: number, price: number, stock: number): Product => ({
  id, name: `Crème ${id}`, brand: "Maison", category: "Visage", sku: "", price, cost: 0, stock, low_stock_alert: 2, name_en: "", category_en: "", created_at: "", updated_at: "",
});
const CATALOG = { services: [service(1, 25000, { name: "Soin du visage éclat", name_en: "Radiance facial" })], products: [product(7, 35000, 2)] };
const VAT = { active: true, rate: 19.25 };

test("identifiant de vente : v- et 24 chiffres hexadécimaux, tiré au hasard, sans crypto.randomUUID (réseau local en http)", () => {
  assert.equal(newRequestId(new Uint8Array(12).fill(171)), `v-${"ab".repeat(12)}`);
  assert.match(newRequestId(), /^v-[0-9a-f]{24}$/);
  assert.notEqual(newRequestId(), newRequestId());
});

test("un toucher ajoute une unité ; un produit ne dépasse jamais son stock ; une prestation a sa ligne et sa praticienne", () => {
  let t = emptyTicket("v-essai-0001");
  t = addItem(t, { kind: "product", ref_id: 7, stock: 2 });
  t = addItem(t, { kind: "product", ref_id: 7, stock: 2 });
  t = addItem(t, { kind: "product", ref_id: 7, stock: 2 });
  assert.deepEqual(t.lines, [{ kind: "product", ref_id: 7, quantity: 2, staff_id: null }], "stock de 2 : la troisième unité est refusée");
  assert.equal(addItem(emptyTicket(), { kind: "product", ref_id: 8, stock: 0 }).lines.length, 0, "rupture refusée");
  t = addItem(t, { kind: "service", ref_id: 1, staff_id: 3 });
  t = addItem(t, { kind: "service", ref_id: 1, staff_id: 3 });
  assert.deepEqual([t.lines.length, itemCount(t), quantityOf(t, 7)], [3, 4, 2]);
  assert.equal(setQuantity(t, 0, 5, 2).lines[0].quantity, 2, "+ plafonné au stock");
  assert.equal(setQuantity(t, 0, 0).lines.length, 2, "− jusqu'à zéro : la ligne part");
  assert.equal(removeLine(t, 1).lines.length, 2);
  assert.equal(setLineStaff(t, 1, 4).lines[1].staff_id, 4);
  assert.equal(setLineStaff(t, 0, 4).lines[0].staff_id, null, "pas de praticienne sur un produit");
});

test("cliente obligatoire dès qu'une prestation est au ticket ; produits seuls sans cliente", () => {
  const produits = addItem(emptyTicket(), { kind: "product", ref_id: 7, stock: 2 });
  assert.equal(needsClient(produits), false);
  const soin = addItem(produits, { kind: "service", ref_id: 1 });
  assert.equal(needsClient(soin), true);
  assert.equal(needsClient(setClient(soin, 4)), false);
});

test("encaisser un rendez-vous pré-remplit prestations, cliente et praticienne ; un autre ticket en cours n'est pas écrasé", () => {
  const apt = { id: 12, client_id: 4, staff_id: 3, appointment_services: [{ id: 1, appointment_id: 12, service_id: 1, price: 25000, duration: 60 }] } as unknown as Appointment;
  const t = fromAppointment(apt, "v-rdv-000012");
  assert.deepEqual(t, { request_id: "v-rdv-000012", appointment_id: 12, client_id: 4, lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 3 }], discount: null, tip: null });
  assert.equal(openFor(emptyTicket(), 12), "prefill");
  assert.equal(openFor(t, 12), "keep");
  assert.equal(openFor(t, null), "keep", "vente de comptoir : le ticket en cours reste");
  assert.equal(openFor(addItem(emptyTicket(), { kind: "product", ref_id: 7 }), 12), "conflict");
  assert.equal(defaultTipStaff(t, null), 3, "praticienne de la prestation");
  assert.equal(defaultTipStaff(t, 5), 5, "celle du rendez-vous d'abord");
  assert.equal(isEmpty(emptyTicket()), true);
});

test("prix du catalogue chargé et totaux comme le serveur : remise, TVA sur le total remisé, pourboire hors facture", () => {
  let t = addItem(setClient(emptyTicket(), 4), { kind: "service", ref_id: 1, staff_id: 3 });
  t = addItem(t, { kind: "product", ref_id: 7, stock: 2 });
  t = setTip(setDiscount(t, { kind: "percent", value: 5, reason: "fidelite", note: "" }), { amount: 2000, staff_id: 3 });
  const priced = priceTicket(t, CATALOG, VAT, "en");
  assert.deepEqual(priced.lines.map((l) => [l.label, l.detail, l.unit_price, l.line_total, l.stock]), [["Radiance facial", "60", 25000, 25000, null], ["Crème 7", "Maison", 35000, 35000, 2]]);
  assert.deepEqual(priced.totals, { subtotal: 60000, discount_amount: 3000, total_ttc: 57000, total_ht: 47799, total_tva: 9201, tip: 2000, due: 59000 });
  assert.equal(priceTicket(t, { services: [], products: CATALOG.products }, VAT, "fr").missing, true, "prestation retirée du catalogue");
  assert.equal(setTip(t, { amount: 0, staff_id: 3 }).tip, null);
  assert.deepEqual(saleBody(t), {
    request_id: t.request_id, client_id: 4, appointment_id: null,
    lines: [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 3 }, { kind: "product", ref_id: 7, quantity: 1, staff_id: null }],
    discount: { kind: "percent", value: 5, reason: "fidelite", note: "" }, tip: { amount: 2000, staff_id: 3 },
  });
});

test("ticket et envoi en attente gardés en mémoire d'un écran à l'autre, jusqu'à l'émission ou « Vider le ticket », rattachés au compte (relecture 2 de la tâche 6) : la même personne qui déverrouille retrouve les siens (décision 1)", () => {
  const first = keptTicket(501);
  assert.equal(keptTicket(501), first, "le même ticket retrouvé, pour le même compte");
  const next = addItem(first, { kind: "product", ref_id: 7 });
  keepTicket(next, 501);
  assert.equal(keptTicket(501), next, "toujours là au retour du même compte (verrouillage du poste, décision 1)");
  assert.equal(keptPending(501), false, "aucune demande en attente au départ");
  keepPending(true, 501);
  assert.equal(keptPending(501), true, "gardée pour un remontage de l'écran « Vente », toujours pour le même compte");
  keepPending(false, 501);
  assert.equal(keptPending(501), false, "levée dès qu'une facture ou un refus explicite arrive");

  keepTicket(null, 501);
  assert.notEqual(keptTicket(501).request_id, first.request_id, "nouveau ticket, nouvel identifiant de vente");
});

test("facture émise gardée hors de React (spec § 7, relecture de la tâche 6), rattachée au compte et à la vente qui l'a produite (relecture 2) : montrée seulement là, jamais effacée par la lecture d'une autre vente (relecture 3)", () => {
  assert.equal(keptIssued(503, null), null, "aucune facture gardée au départ (vente de comptoir)");
  const comptoir = { id: 1, number: "F-000001", appointment_id: null } as unknown as Invoice;
  keepIssued(comptoir, 503);
  assert.equal(keptIssued(503, null), comptoir, "retrouvée après avoir quitté l'écran, pour la même vente de comptoir");
  assert.equal(keptIssued(503, 12), null, "jamais montrée sur la vente d'un autre rendez-vous : simplement cachée, pas effacée");
  assert.equal(keptIssued(503, null), comptoir, "toujours retrouvée pour le comptoir : la lire pour une autre vente ne l'a pas effacée");

  const rdv = { id: 2, number: "F-000002", appointment_id: 12 } as unknown as Invoice;
  keepIssued(rdv, 503);
  assert.equal(keptIssued(503, 12), rdv, "retrouvée sur le rendez-vous qui l'a produite");
  keepIssued(null, 503);
  assert.equal(keptIssued(503, 12), null, "effacée par « Nouvelle vente » ou un retour à l'accueil");
});

test("une autre personne sur un poste partagé ne retrouve jamais le ticket, l'envoi en attente ni la facture d'un compte précédent (relecture 2 de la tâche 6, écran vierge)", () => {
  keepTicket(addItem(keptTicket(505), { kind: "product", ref_id: 7 }), 505);
  keepPending(true, 505);
  keepIssued({ id: 3, number: "F-000003", appointment_id: null } as unknown as Invoice, 505);

  assert.equal(keptTicket(506).lines.length, 0, "ticket vierge pour l'autre compte");
  assert.equal(keptPending(506), false, "aucun envoi en attente pour l'autre compte");
  assert.equal(keptIssued(506, null), null, "aucune facture pour l'autre compte");
});

test("un enregistrement par compte (relecture 3 de la tâche 6, spec § 7) : la lecture par un autre compte ne détruit ni le ticket, ni l'envoi en attente, ni la facture d'un premier compte, qui les retrouve intacts sous le même request_id", () => {
  // Vente au comptoir de 507, réponse perdue : le ticket reste gelé sous son request_id (§ 7).
  const withProduct = addItem(keptTicket(507), { kind: "product", ref_id: 7 });
  keepTicket(withProduct, 507);
  keepPending(true, 507);
  keepIssued({ id: 4, number: "F-000004", appointment_id: null } as unknown as Invoice, 507);

  // 508 se connecte sur le même poste et ouvre l'écran : il garde le sien, sans toucher à celui de 507.
  assert.equal(keptTicket(508).lines.length, 0, "508 part d'un ticket vierge");
  assert.equal(keptPending(508), false, "aucun envoi en attente pour 508");
  assert.equal(keptIssued(508, null), null, "aucune facture pour 508");
  keepTicket(addItem(keptTicket(508), { kind: "service", ref_id: 1 }), 508);
  keepPending(true, 508);

  // 507 revient : son ticket, son request_id et son gel sont intacts, donc pas de vente ressaisie ni en double.
  assert.equal(keptTicket(507), withProduct, "ticket de 507 intact malgré la lecture, puis l'écriture, de 508");
  assert.equal(keptTicket(507).request_id, withProduct.request_id, "même request_id : le serveur peut toujours dédupliquer");
  assert.equal(keptPending(507), true, "gel de 507 intact");
  assert.equal(keptIssued(507, null)?.number, "F-000004", "facture de 507 intacte");

  // et 508 retrouve aussi le sien : chaque compte a son propre enregistrement.
  assert.equal(keptPending(508), true, "gel de 508 intact malgré la lecture de 507 juste avant");
});

const AVEC_SUPPLEMENTS = {
  services: [...CATALOG.services, service(2, 5000, { name: "Mèches", supplement_seulement: 1 })],
  products: CATALOG.products,
};

test("ticket depuis un rendez-vous : chaque supplément sous sa prestation, le libre avec son libellé et son prix", () => {
  const apt = {
    id: 9, client_id: 4, staff_id: 3,
    appointment_services: [{ id: 20, appointment_id: 9, service_id: 1, price: 25000, duration: 60, supplements: [
      { id: 1, appointment_service_id: 20, kind: "service", ref_id: 2, label_fr: "Mèches", label_en: "", quantity: 1, price: 5000, minutes: 30, position: 0 },
      { id: 2, appointment_service_id: 20, kind: "product", ref_id: 7, label_fr: "Crème", label_en: "", quantity: 2, price: 35000, minutes: 0, position: 1 },
      { id: 3, appointment_service_id: 20, kind: "libre", ref_id: null, label_fr: "Perles dorées", label_en: "", quantity: 1, price: 3000, minutes: 15, position: 2 },
    ] }],
  } as unknown as Appointment;
  const t = fromAppointment(apt, "v-essai-supp");
  assert.deepEqual(t.lines, [{ kind: "service", ref_id: 1, quantity: 1, staff_id: 3, supplements: [
    { kind: "service", ref_id: 2, quantity: 1 },
    { kind: "product", ref_id: 7, quantity: 2 },
    { kind: "libre", ref_id: null, quantity: 1, label: "Perles dorées", price: 3000 },
  ] }]);
  assert.equal(itemCount(t), 5);
  assert.equal(quantityOf(t, 7), 2, "un produit en supplément compte dans le stock pris");
  const priced = priceTicket(t, AVEC_SUPPLEMENTS, VAT, "fr");
  assert.equal(priced.totals.subtotal, 25000 + 5000 + 70000 + 3000, "prix du catalogue chargé, le libre au prix saisi");
  assert.deepEqual(priced.lines[0].supplements.map((s) => [s.label, s.line_total]), [["Mèches", 5000], ["Crème 7", 70000], ["Perles dorées", 3000]]);
  assert.deepEqual(saleBody(t).lines, [
    { kind: "service", ref_id: 1, quantity: 1, staff_id: 3 },
    { kind: "service", ref_id: 2, quantity: 1, staff_id: 3, parent: 0 },
    { kind: "product", ref_id: 7, quantity: 2, staff_id: 3, parent: 0 },
    { kind: "libre", label: "Perles dorées", unit_price: 3000, quantity: 1, staff_id: 3, parent: 0 },
  ]);
});

test("produit retiré du catalogue : le supplément est « manquant » et bloque l'encaissement jusqu'à ce qu'on l'enlève", () => {
  let t = addItem(emptyTicket("v-essai-supp2"), { kind: "service", ref_id: 1, staff_id: 3 });
  t = addSupplement(t, 0, { kind: "product", ref_id: 99, quantity: 1 });
  assert.equal(priceTicket(t, AVEC_SUPPLEMENTS, VAT, "fr").missing, true);
  t = removeSupplement(t, 0, 0);
  assert.equal(priceTicket(t, AVEC_SUPPLEMENTS, VAT, "fr").missing, false);
});

test("« + Supplément » : une prestation une fois, un produit qui s'additionne sans dépasser le stock ; retirer la prestation retire ses suppléments", () => {
  let t = addItem(emptyTicket("v-essai-supp3"), { kind: "service", ref_id: 1, staff_id: 3 });
  t = addItem(t, { kind: "product", ref_id: 7, stock: 2 });
  t = addSupplement(t, 0, { kind: "service", ref_id: 2, quantity: 1 });
  t = addSupplement(t, 0, { kind: "service", ref_id: 2, quantity: 1 });
  t = addSupplement(t, 0, { kind: "product", ref_id: 7, quantity: 1 }, 2);
  t = addSupplement(t, 0, { kind: "product", ref_id: 7, quantity: 1 }, 2);
  assert.deepEqual(t.lines[0].supplements, [{ kind: "service", ref_id: 2, quantity: 1 }, { kind: "product", ref_id: 7, quantity: 1 }], "stock de 2 : une au ticket, une en supplément");
  assert.equal(addSupplement(t, 1, { kind: "libre", ref_id: null, quantity: 1, label: "Perles", price: 0 }), t, "jamais sous un produit");
  assert.equal(setSupplementQuantity(t, 0, 1, 5, 2).lines[0].supplements![1].quantity, 1, "plafonné au stock restant");
  assert.equal(setSupplementQuantity(t, 0, 1, 0).lines[0].supplements!.length, 1, "à zéro, le supplément part");
  assert.deepEqual(removeLine(t, 0).lines.map((l) => l.kind), ["product"]);
});

test("un produit à la fois ligne seule et supplément : le + de la ligne compte les deux dans le plafond du stock", () => {
  let t = addItem(emptyTicket("v-essai-supp4"), { kind: "service", ref_id: 1, staff_id: 3 });
  t = addItem(t, { kind: "product", ref_id: 7, stock: 3 });
  t = addSupplement(t, 0, { kind: "product", ref_id: 7, quantity: 2 }, 3);
  assert.equal(quantityOf(t, 7), 3);
  assert.equal(setQuantity(t, 1, 2, 3).lines[1].quantity, 1, "stock de 3, 2 en supplément : la ligne seule reste à 1");
  assert.equal(setQuantity(t, 1, 0, 3).lines.length, 1, "à zéro, la ligne part");
});

test("plafond du stock : ajout d'un supplément plafonné, rien d'ajouté sans stock, quantité jamais forcée à 1 au-delà du stock", () => {
  let t = addItem(emptyTicket("v-essai-supp5"), { kind: "service", ref_id: 1, staff_id: 3 });
  t = addItem(t, { kind: "product", ref_id: 7, stock: 3 });
  const plein = addSupplement(t, 0, { kind: "product", ref_id: 7, quantity: 9 }, 3);
  assert.equal(plein.lines[0].supplements![0].quantity, 2, "9 demandés, 2 disponibles : plafonné à 2");
  assert.deepEqual(addSupplement(plein, 0, { kind: "product", ref_id: 7, quantity: 1 }, 3), plein, "plus rien de disponible : rien n'est ajouté");
  const base = (line: number, supp: number): Ticket => ({
    ...emptyTicket("v-essai-supp6"),
    lines: [
      { kind: "service", ref_id: 1, quantity: 1, staff_id: 3, supplements: [{ kind: "product", ref_id: 7, quantity: supp }] },
      { kind: "product", ref_id: 7, quantity: line, staff_id: null },
    ],
  });
  const a = base(1, 2);
  assert.equal(setQuantity(a, 1, 2, 2), a, "stock de 2 pris par le supplément et la ligne seule : la ligne n'est pas forcée à 1 de plus");
  const b = base(2, 1);
  assert.equal(setSupplementQuantity(b, 0, 0, 3, 2), b, "stock de 2 pris par la ligne seule et le supplément : le supplément ne bouge pas");
});

test("supplément libre : le prix arrondi et borné est le même à l'écran et dans la vente envoyée", () => {
  const t = addSupplement(addItem(emptyTicket("v-essai-supp7"), { kind: "service", ref_id: 1, staff_id: 3 }), 0, { kind: "libre", ref_id: null, quantity: 1, label: "Perles", price: 1500.6 });
  const priced = priceTicket(t, CATALOG, { active: false, rate: 0 }, "fr");
  const sent = saleBody(t).lines[1] as { unit_price: number };
  assert.equal(priced.lines[0].supplements[0].unit_price, 1501);
  assert.equal(sent.unit_price, 1501);
  const neg = addSupplement(addItem(emptyTicket("v-essai-supp8"), { kind: "service", ref_id: 1 }), 0, { kind: "libre", ref_id: null, quantity: 1, label: "X", price: -5 });
  assert.equal((saleBody(neg).lines[1] as { unit_price: number }).unit_price, 0);
});

test("une réduction passe toujours, même stock baissé sous la quantité ; un prix libre NaN vaut 0", () => {
  const t: Ticket = {
    ...emptyTicket("v-essai-supp9"),
    lines: [
      { kind: "service", ref_id: 1, quantity: 1, staff_id: 3, supplements: [{ kind: "product", ref_id: 7, quantity: 3 }] },
      { kind: "product", ref_id: 7, quantity: 4, staff_id: null },
    ],
  };
  assert.equal(setQuantity(t, 1, 3, 2).lines[1].quantity, 3, "stock baissé à 2 : le − de la ligne seule fonctionne");
  assert.equal(setSupplementQuantity(t, 0, 0, 2, 2).lines[0].supplements![0].quantity, 2, "idem pour le supplément");
  const nan = addSupplement(addItem(emptyTicket("v-essai-supp10"), { kind: "service", ref_id: 1 }), 0, { kind: "libre", ref_id: null, quantity: 1, label: "X", price: NaN });
  assert.equal((saleBody(nan).lines[1] as { unit_price: number }).unit_price, 0);
  assert.equal(priceTicket(nan, CATALOG, { active: false, rate: 0 }, "fr").lines[0].supplements[0].unit_price, 0);
});
