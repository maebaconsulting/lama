import assert from "node:assert/strict";
import { test } from "node:test";
import type { Invoice } from "./caisse-types.ts";
import type { Appointment, Product, Service } from "../types.ts";
import {
  addItem, defaultTipStaff, emptyTicket, fromAppointment, isEmpty, itemCount, keepIssued, keepPending, keepTicket, keptIssued, keptPending, keptTicket,
  needsClient, newRequestId, openFor, priceTicket, quantityOf, removeLine, saleBody, setClient, setDiscount, setLineStaff, setQuantity, setTip,
} from "./ticket.ts";

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
