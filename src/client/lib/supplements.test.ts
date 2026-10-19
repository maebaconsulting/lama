import assert from "node:assert/strict";
import { test } from "node:test";
import type { Appointment, Product, Service } from "../types.ts";
import {
  addLibre, cardText, choicesFor, copyTargets, draftOf, draftTotals, isChosen, moveSupplement, pickable, quantityFromText, removeDraft, removeSupplement, sellableAlone, setDraftQuantity, supplementPayload, toggleChoice,
} from "./supplements.ts";

const service = (id: number, patch: Partial<Service> = {}): Service => ({
  id, name: `Prestation ${id}`, description: "", duration: 60, price: 15000, color: "", category: "Coiffure", name_en: "", description_en: "", category_en: "",
  active: 1, en_ligne: 0, created_at: "", supplement_seulement: 0, supplements: [], ...patch,
});
const product = (id: number, patch: Partial<Product> = {}): Product => ({
  id, name: `Produit ${id}`, brand: "", category: "", sku: "", price: 500, stock: 10, low_stock_alert: 2, name_en: "", category_en: "", created_at: "", updated_at: "", ...patch,
});
const TRESSES = service(1, { name: "Tresses", supplements: [{ kind: "service", ref_id: 2 }, { kind: "product", ref_id: 5 }, { kind: "service", ref_id: 3 }, { kind: "product", ref_id: 6 }] });
const CATALOG = {
  services: [TRESSES, service(2, { name: "Mèches", name_en: "Extensions", duration: 30, price: 5000, supplement_seulement: 1 }), service(3, { name: "Ancienne", active: 0 }), service(4, { name: "Soin", category: "Visage" })],
  products: [product(5, { name: "Perles" })],
};

test("suppléments proposés : la liste dans l'ordre réglé, sans article désactivé ni retiré du catalogue, prix et minutes de la fiche", () => {
  assert.deepEqual(choicesFor(1, CATALOG, "en"), [
    { kind: "service", ref_id: 2, label: "Extensions", price: 5000, minutes: 30 },
    { kind: "product", ref_id: 5, label: "Perles", price: 500, minutes: 0 },
  ]);
  assert.deepEqual(choicesFor(4, CATALOG, "fr"), []);
  assert.deepEqual(choicesFor(99, CATALOG, "fr"), []);
});

test("vendues seules : prestations actives qui ne sont pas « supplément seulement »", () => {
  assert.deepEqual(sellableAlone(CATALOG.services).map((s) => s.id), [1, 4]);
});

test("carte de l'agenda : chaque prestation suivie de ses suppléments", () => {
  const apt = { appointment_services: [
    { id: 10, appointment_id: 1, service_id: 1, service_name: "Tresses", price: 15000, duration: 60, supplements: [
      { id: 1, appointment_service_id: 10, kind: "service", ref_id: 2, label_fr: "Mèches", label_en: "Extensions", quantity: 1, minutes: 30, position: 0 },
      { id: 2, appointment_service_id: 10, kind: "libre", ref_id: null, label_fr: "Perles dorées", label_en: "", quantity: 1, minutes: 15, position: 1 },
    ] },
    { id: 11, appointment_id: 1, service_id: 4, service_name: "Soin", price: 15000, duration: 60 },
  ] } as unknown as Appointment;
  assert.equal(cardText(apt, "fr"), "Tresses + Mèches + Perles dorées, Soin");
  assert.equal(cardText(apt, "en"), "Tresses + Extensions + Perles dorées, Soin");
});

test("brouillon d'un rendez-vous : cocher, décocher, quantité d'un produit de 1 à 99, supplément libre, totaux et corps envoyé", () => {
  const [meches, perles] = choicesFor(1, CATALOG, "fr");
  let list = toggleChoice([], meches);
  list = toggleChoice(list, perles);
  assert.equal(isChosen(list, perles), true);
  list = setDraftQuantity(list, 1, 3);
  list = setDraftQuantity(list, 0, 4);
  assert.deepEqual(list.map((d) => d.quantity), [1, 3], "une prestation en supplément compte une fois");
  assert.equal(setDraftQuantity(list, 1, 150)[1].quantity, 99);
  list = addLibre(list, { label: "  Perles dorées ", price: 3000, minutes: 15 });
  assert.deepEqual(draftTotals(list), { minutes: 45, price: 5000 + 1500 + 3000 });
  assert.deepEqual(list.map(supplementPayload), [
    { kind: "service", ref_id: 2 },
    { kind: "product", ref_id: 5, quantity: 3 },
    { kind: "libre", label: "Perles dorées", price: 3000, minutes: 15 },
  ]);
  list = toggleChoice(list, meches);
  assert.equal(isChosen(list, meches), false);
  assert.deepEqual(removeDraft(list, 0).map((d) => d.kind), ["libre"]);
  const lu = draftOf({ id: 10, appointment_id: 1, service_id: 1, price: 15000, duration: 60, supplements: [
    { id: 1, appointment_service_id: 10, kind: "service", ref_id: 2, label_fr: "Mèches", label_en: "Extensions", quantity: 1, price: 5000, minutes: 30, position: 0 },
  ] }, "en");
  assert.deepEqual(lu, [{ kind: "service", ref_id: 2, quantity: 1, label: "Extensions", price: 5000, minutes: 30 }]);
});

test("« Recopier vers… » et liste de suppléments : jamais la prestation elle-même ni une prestation déjà supplément ou qui a sa liste", () => {
  const { candidates, preselected } = copyTargets(CATALOG.services, TRESSES);
  assert.deepEqual(candidates.map((s) => s.id), [4], "Mèches est un supplément, Ancienne est désactivée");
  assert.deepEqual(preselected, [], "Soin n'est pas du même univers");
  const avecNattes = [...CATALOG.services, service(7, { name: "Nattes" })];
  assert.deepEqual(copyTargets(avecNattes, TRESSES).preselected, [7], "même univers cochée d'avance");
  const avecFrange = [...avecNattes, service(8, { name: "Frange", supplement_seulement: 1 })];
  assert.ok(!copyTargets(avecFrange, TRESSES).candidates.some((s) => s.id === 8), "jamais une prestation « supplément seulement »");
  const choix = pickable(avecNattes, CATALOG.products, 4, [{ kind: "service", ref_id: 2 }]);
  assert.deepEqual(choix.services.map((s) => s.id), [7], "ni Tresses (elle a sa liste), ni Mèches (déjà choisie), ni Soin elle-même");
  assert.deepEqual(choix.products.map((p) => p.id), [5]);
});

test("liste d'une prestation : monter et descendre échangent deux voisins, hors bornes rien ne change", () => {
  const liste = [{ kind: "service" as const, ref_id: 1 }, { kind: "product" as const, ref_id: 2 }, { kind: "service" as const, ref_id: 3 }];
  assert.deepEqual(moveSupplement(liste, 1, -1).map((r) => r.ref_id), [2, 1, 3]);
  assert.deepEqual(moveSupplement(liste, 1, 1).map((r) => r.ref_id), [1, 3, 2]);
  assert.deepEqual(moveSupplement(liste, 0, -1), liste);
  assert.deepEqual(moveSupplement(liste, 2, 1), liste);
  assert.deepEqual(liste.map((r) => r.ref_id), [1, 2, 3], "la liste d'origine n'est pas modifiée");
});

test("liste d'une prestation : retirer rend la liste et la ligne qui reçoit le focus (suivante, sinon précédente, sinon aucune)", () => {
  const liste = [{ kind: "service" as const, ref_id: 1 }, { kind: "product" as const, ref_id: 2 }, { kind: "service" as const, ref_id: 3 }];
  assert.deepEqual(removeSupplement(liste, 0), { items: [liste[1], liste[2]], focus: 0 });
  assert.deepEqual(removeSupplement(liste, 1), { items: [liste[0], liste[2]], focus: 1 });
  assert.deepEqual(removeSupplement(liste, 2), { items: [liste[0], liste[1]], focus: 1 });
  assert.deepEqual(removeSupplement([liste[0]], 0), { items: [], focus: null });
});

test("quantité saisie : vidable pendant la frappe, bornée de 1 à 99 en quittant le champ", () => {
  assert.equal(quantityFromText("", 3, false), null, "champ vidé : rien n'est encore pris");
  assert.equal(quantityFromText("0", 3, false), null);
  assert.equal(quantityFromText("12", 3, false), 12);
  assert.equal(quantityFromText("150", 3, false), null);
  assert.equal(quantityFromText("", 3, true), 3, "champ laissé vide : la quantité d'avant revient");
  assert.equal(quantityFromText("abc", 3, true), 3);
  assert.equal(quantityFromText("0", 3, true), 1);
  assert.equal(quantityFromText("150", 3, true), 99);
  assert.equal(quantityFromText(" 7 ", 3, true), 7);
});
