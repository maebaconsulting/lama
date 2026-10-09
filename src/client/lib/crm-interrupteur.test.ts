import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { clientPayload, crmActiveOf, crmTags, ficheCrm, listTagFilter } from "./crm.ts";
import { fideliteChanges, fideliteForm, savedMessage } from "./reglages-fidelite.ts";
import { dropStaleReward, emptyTicket, rewardDiscount, setDiscount } from "./ticket.ts";
import { translate } from "../i18n/translate.ts";
import type { ClientSummary } from "../types.ts";

/**
 * Interrupteur général du mini CRM à l'écran (spec du 04/10/2026,
 * « Interrupteur général ») : lu dans l'état de session pour tous les rôles ;
 * désactivé, la fiche, la liste et le formulaire reviennent à ce qu'ils
 * étaient avant le chantier, sans rien effacer.
 */

const SUMMARY: ClientSummary = {
  visits: 3, last_visit: "2026-09-01", days_since: 33, next_appointment: null, usual_services: [], favorite_staff: null, products: [],
  total_spent: 75000, average_basket: 25000, invoice_count: 3, loyalty: { balance: 40, next_tier: null },
};

test("interrupteur lu dans l'état de session : activé par défaut (absent, ancien serveur), désactivé seulement sur `false`", () => {
  assert.equal(crmActiveOf(null), true);
  assert.equal(crmActiveOf({ crm: null }), true);
  assert.equal(crmActiveOf({}), true);
  assert.equal(crmActiveOf({ crm: { active: true } }), true);
  assert.equal(crmActiveOf({ crm: { active: false } }), false);
});

test("fiche : activé, synthèse, étiquettes, anniversaire, préférences et fidélité ; désactivé, la ligne des visites d'avant le chantier", () => {
  assert.deepEqual(ficheCrm(true, SUMMARY), { summary: true, visitLine: false, tags: true, birthday: true, preferences: true, loyalty: true });
  assert.deepEqual(ficheCrm(true, { ...SUMMARY, loyalty: null }).loyalty, false, "fidélité inactive");
  assert.deepEqual(ficheCrm(true, null), { summary: false, visitLine: true, tags: true, birthday: true, preferences: true, loyalty: false }, "synthèse pas encore lue");
  assert.deepEqual(ficheCrm(false, SUMMARY), { summary: false, visitLine: true, tags: false, birthday: false, preferences: false, loyalty: false }, "synthèse périmée ignorée");
  assert.deepEqual(ficheCrm(false, null), { summary: false, visitLine: true, tags: false, birthday: false, preferences: false, loyalty: false });
});

test("liste : désactivé, filtre ?etiquette= ignoré et lignes sans étiquettes", () => {
  assert.equal(listTagFilter("VIP", true), "VIP");
  assert.equal(listTagFilter("VIP", false), "");
  assert.deepEqual(crmTags(["VIP", "Mariée"], true), ["VIP", "Mariée"]);
  assert.deepEqual(crmTags(["VIP", "Mariée"], false), []);
});

test("formulaire : désactivé, ni anniversaire ni étiquettes ni préférences envoyés (le serveur garde les valeurs)", () => {
  const data = { name: "Aïcha", email: "", phone: "699123456", notes: "", preferences: "Thé", birthday: "10-04", tags: ["VIP"], card: "A123" };
  assert.deepEqual(clientPayload(data, true), data);
  assert.deepEqual(clientPayload(data, false), { name: "Aïcha", email: "", phone: "699123456", notes: "", card: "A123" });
});

test("rubrique « Clientes et fidélité » : la case du mini CRM en tête, activée par défaut, enregistrée avant la fidélité", () => {
  assert.equal(translate("fr", "reglages.rubrique.fidelite"), "Clientes et fidélité");
  assert.equal(translate("en", "reglages.rubrique.fidelite"), "Clients and loyalty");
  assert.equal(fideliteForm([]).crm, true);
  const base = fideliteForm([{ key: "crm.active", secret: false, value: false, set: true }]);
  assert.equal(base.crm, false);
  assert.deepEqual(fideliteChanges(base, { ...base, crm: true, active: true }), { changes: [{ key: "crm.active", value: true }, { key: "fidelite.active", value: true }] });
  assert.deepEqual(fideliteChanges(base, base), { changes: [] });
});

test("écrans branchés sur l'interrupteur : fiche, liste, formulaire, caisse, Messages, rubrique ; état relu sur le signal « settings »", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(read("../components/auth/porte.tsx"), /crm: crmActiveOf\(state\)/);
  assert.match(read("../hooks/use-auth.ts"), /useRefresh\(\["settings"\], reload\)/);
  assert.match(read("../components/fiches/fiche-cliente.tsx"), /ficheCrm\(crm, summary\)/);
  assert.match(read("../components/client-list.tsx"), /crmTags\(c\.tags, crm\)/);
  assert.match(read("../components/create-client.tsx"), /clientPayload\(/);
  assert.match(read("../components/caisse/ticket-vente.tsx"), /useCrm\(\)/);
  const messages = read("../components/reglages/whatsapp.tsx");
  assert.match(messages, /crm \? <Relances \/> : /);
  assert.match(messages, /crm \? <Campagnes \/> : /);
  assert.match(read("../components/reglages/fidelite.tsx"), /disabled=\{!form\.crm\}/);
});

test("caisse : une récompense posée est retirée d'office quand la fidélité n'est plus active à l'écran, avec sa cause", () => {
  const base = { ...emptyTicket(), client_id: 7 };
  const withReward = setDiscount(base, rewardDiscount({ points: 100, montant: 5000 }));
  assert.equal(dropStaleReward(withReward, { crm: true, loyaltyActive: true }), null, "fidélité active : gardée");
  assert.deepEqual(dropStaleReward(withReward, { crm: false, loyaltyActive: false }), { ticket: { ...withReward, discount: null }, cause: "crm" });
  assert.deepEqual(dropStaleReward(withReward, { crm: true, loyaltyActive: false }), { ticket: { ...withReward, discount: null }, cause: "fidelite" });
  const manual = setDiscount(base, { kind: "amount", value: 1000, reason: "fidelite", note: "" });
  assert.equal(dropStaleReward(manual, { crm: false, loyaltyActive: false }), null, "une remise saisie au motif « Fidélité » n'est pas une récompense : gardée");
  assert.equal(dropStaleReward(base, { crm: false, loyaltyActive: false }), null);
  assert.equal(translate("fr", "caisse.recompense_retiree_crm"), "Récompense retirée\u00a0: le mini CRM est désactivé.");
  assert.equal(translate("fr", "caisse.recompense_retiree_fidelite"), "Récompense retirée\u00a0: la fidélité est désactivée.");
  const vente = readFileSync(new URL("../components/caisse/ticket-vente.tsx", import.meta.url), "utf8");
  assert.match(vente, /dropStaleReward\(ticket, \{ crm, loyaltyActive: /);
  assert.match(vente, /role="status"/);
});

test("rubrique : message de succès selon ce qui a été enregistré", () => {
  assert.equal(savedMessage([{ key: "crm.active", value: false }]), "reglages_crm.enregistre");
  assert.equal(savedMessage([{ key: "fidelite.points", value: 2 }]), "reglages_fidelite.enregistres");
  assert.equal(savedMessage([{ key: "crm.active", value: true }, { key: "fidelite.active", value: true }]), "reglages_crm.enregistres_tous");
  assert.equal(translate("fr", "reglages_crm.enregistre"), "Réglage du mini CRM enregistré.");
  assert.match(readFileSync(new URL("../components/reglages/fidelite.tsx", import.meta.url), "utf8"), /setOk\(t\(savedMessage\(result\.changes\)\)\)/);
});
