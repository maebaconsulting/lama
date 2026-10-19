import assert from "node:assert/strict";
import { test } from "node:test";
import type { Service } from "../types.ts";
import { afterSaveError, bookingTotals, withoutDrafts } from "./supplements-rdv.ts";
import type { DraftSupplement } from "./supplements.ts";

const svc = (id: number, price: number, duration: number) => ({ id, price, duration }) as Service;
const mèche: DraftSupplement = { kind: "service", ref_id: 9, quantity: 1, label: "Mèches", price: 2000, minutes: 30 };
const perles: DraftSupplement = { kind: "libre", ref_id: null, quantity: 1, label: "Perles", price: 3000, minutes: 15 };
const gel: DraftSupplement = { kind: "product", ref_id: 4, quantity: 2, label: "Gel", price: 500, minutes: 0 };

test("total de la prise : prestations choisies plus suppléments (prix × quantité, minutes)", () => {
  const services = [svc(1, 10000, 60), svc(2, 5000, 30), svc(3, 7000, 45)];
  assert.deepEqual(bookingTotals(services, [1, 2], { 1: [mèche, gel], 2: [perles] }), { price: 10000 + 5000 + 2000 + 1000 + 3000, minutes: 60 + 30 + 30 + 15 });
  assert.deepEqual(bookingTotals(services, [1], {}), { price: 10000, minutes: 60 });
});

test("prestation décochée : ses suppléments disparaissent, ceux des autres restent", () => {
  const drafts = { 1: [mèche], 2: [perles] };
  assert.deepEqual(withoutDrafts(drafts, 1), { 2: [perles] });
  assert.deepEqual(drafts, { 1: [mèche], 2: [perles] });
  assert.deepEqual(bookingTotals([svc(1, 100, 10), svc(2, 100, 10)], [2], withoutDrafts(drafts, 1)), { price: 3100, minutes: 25 });
});

test("après un 409 : conflits proposés ; encaissé (sans conflits) message seul et relecture ; autre erreur message", () => {
  const c = [{ start_time: "11:00" }] as never;
  assert.deepEqual(afterSaveError(c, "x"), { conflicts: c, error: null, reload: false });
  assert.deepEqual(afterSaveError([], "Déjà encaissé"), { conflicts: null, error: "Déjà encaissé", reload: true });
  assert.deepEqual(afterSaveError(null, "Panne"), { conflicts: null, error: "Panne", reload: false });
});
