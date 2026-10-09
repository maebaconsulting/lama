import assert from "node:assert/strict";
import { test } from "node:test";
import type { Service } from "../types.ts";
import { discountLabel } from "./caisse-texte.ts";
import { correctionValue, entryText, nextTierText, rewardChoices, signedPoints } from "./fidelite.ts";
import { addItem, emptyTicket, priceTicket, rewardDiscount, saleBody, setClient, setDiscount } from "./ticket.ts";

/** Fidélité à l'écran (mini CRM § 2) : récompense à la caisse, ticket, libellés. */

const TIERS = [{ points: 100, montant: 5000 }, { points: 250, montant: 15000 }];
const service = (id: number, price: number): Service => ({
  id, name: `Soin ${id}`, description: "", duration: 60, price, color: "", category: "Visage", name_en: `Care ${id}`, description_en: "", category_en: "Face", active: 1, created_at: "",
});

test("récompense à la caisse : paliers atteints seulement ; remise ramenée au sous-total dite d'avance", () => {
  assert.deepEqual(rewardChoices(90, TIERS, 25000), []);
  assert.deepEqual(rewardChoices(140, TIERS, 25000), [{ points: 100, montant: 5000, applied: 5000, capped: false }]);
  assert.deepEqual(rewardChoices(300, TIERS, 12000), [
    { points: 100, montant: 5000, applied: 5000, capped: false },
    { points: 250, montant: 15000, applied: 12000, capped: true },
  ]);
  assert.deepEqual(rewardChoices(300, TIERS, 0)[0], { points: 100, montant: 5000, applied: 0, capped: true });
});

test("ticket : la récompense remplace la remise, part au serveur comme un palier, tombe si la cliente change", () => {
  let t = addItem(setClient(emptyTicket("v-essai-fid1"), 4), { kind: "service", ref_id: 1, staff_id: 3 });
  t = setDiscount(t, { kind: "percent", value: 5, reason: "geste", note: "" });
  t = setDiscount(t, rewardDiscount({ points: 100, montant: 5000 }));
  assert.deepEqual(saleBody(t).discount, { reward_points: 100 });
  const priced = priceTicket(t, { services: [service(1, 3000)], products: [] }, { active: false, rate: 0 }, "fr");
  assert.equal(priced.totals.discount_amount, 3000, "ramenée au sous-total, comme au serveur");
  assert.equal(setClient(t, 4).discount?.reward_points, 100, "même cliente : gardée");
  assert.equal(setClient(t, 5).discount, null, "autre cliente : retirée");
  assert.equal(setClient(t, null).discount, null);
  const manual = setClient(setDiscount(t, { kind: "amount", value: 1000, reason: "geste", note: "" }), 5);
  assert.deepEqual(manual.discount, { kind: "amount", value: 1000, reason: "geste", note: "" }, "une remise saisie reste");
  assert.deepEqual(saleBody(manual).discount, { kind: "amount", value: 1000, reason: "geste", note: "" });
});

test("libellé de la remise : « Récompense fidélité, 100 points »", () => {
  assert.equal(discountLabel(rewardDiscount({ points: 100, montant: 5000 }), "fr"), "Récompense fidélité, 100\u00a0points");
  assert.equal(discountLabel(rewardDiscount({ points: 1, montant: 500 }), "en"), "Loyalty reward, 1\u00a0point");
  assert.equal(discountLabel({ kind: "percent", value: 5, reason: "fidelite", note: "" }, "fr"), "Remise fidélité 5\u00a0%", "remise saisie inchangée");
});

test("fiche : écritures, points signés et prochain palier dans la langue de l'écran", () => {
  assert.equal(entryText({ kind: "gain", note: "", invoice_number: "FAC-2026-000012" }, "fr"), "Points gagnés, facture FAC-2026-000012");
  assert.equal(entryText({ kind: "recompense", note: "", invoice_number: "FAC-2026-000012" }, "en"), "Reward used, invoice FAC-2026-000012");
  assert.equal(entryText({ kind: "reprise", note: "", invoice_number: "AV-2026-000003" }, "fr"), "Points repris, avoir AV-2026-000003");
  assert.equal(entryText({ kind: "restitution", note: "", invoice_number: "AV-2026-000003" }, "fr"), "Récompense rendue, avoir AV-2026-000003");
  assert.equal(entryText({ kind: "correction", note: "Carte papier", invoice_number: null }, "fr"), "Correction\u00a0: Carte papier");
  assert.equal(signedPoints(12, "fr"), "+12");
  assert.equal(signedPoints(-12, "fr"), "−12");
  assert.equal(signedPoints(1500, "en"), "+1\u202f500");
  assert.equal(nextTierText({ points: 100, montant: 5000, missing: 30 }, "fr"), "Encore 30\u00a0points avant 5\u202f000\u00a0F de remise");
  assert.equal(nextTierText({ points: 100, montant: 5000, missing: 1 }, "en"), "1\u00a0point more before 5\u202f000\u00a0F off");
  assert.equal(nextTierText(null, "fr"), "Tous les paliers de récompense sont atteints.");
});

test("correction de la gérante : sens, nombre de 1 à 100 000, motif obligatoire", () => {
  assert.deepEqual(correctionValue("ajouter", "50", " Carte papier "), { points: 50, note: "Carte papier" });
  assert.deepEqual(correctionValue("retirer", "1 000", "Erreur"), { points: -1000, note: "Erreur" });
  assert.deepEqual(correctionValue("ajouter", "0", "Rien"), { error: "fidelite.erreur_points" });
  assert.deepEqual(correctionValue("ajouter", "100001", "Trop"), { error: "fidelite.erreur_points" });
  assert.deepEqual(correctionValue("ajouter", "dix", "Lettres"), { error: "fidelite.erreur_points" });
  assert.deepEqual(correctionValue("ajouter", "10", "  "), { error: "fidelite.erreur_motif" });
  assert.deepEqual(correctionValue("ajouter", "10", "x".repeat(201)), { error: "fidelite.erreur_motif" });
});
