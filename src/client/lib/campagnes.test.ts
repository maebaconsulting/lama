import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignDrafts, campaignOffer, campaignProblem, campaignSms } from "./campagnes.ts";
import type { WhatsappText } from "./whatsapp.ts";

test("« Écrire à ces clientes » : la gérante seulement, une étiquette choisie (décisions 27 et 29)", () => {
  assert.equal(campaignOffer("manager", "VIP"), true);
  assert.equal(campaignOffer("manager", null), false);
  assert.equal(campaignOffer("manager", "  "), false);
  for (const role of ["admin", "reception", "practitioner"] as const) assert.equal(campaignOffer(role, "VIP"), false, role);
});

test("textes : français obligatoire, variables de la cliente seulement, 1000 caractères au plus", () => {
  assert.deepEqual(campaignProblem("  ", ""), { key: "campagne.probleme.texte_vide" });
  assert.equal(campaignProblem("Bonjour {prenom} de {institut}, {nom}, {telephone}", ""), null);
  assert.equal(campaignProblem("Bonjour", "Hello {prenom}"), null);
  assert.deepEqual(campaignProblem("Bonjour {date}", ""), { key: "campagne.probleme.variable", values: { variable: "{date}" } });
  assert.deepEqual(campaignProblem("Bonjour", "Hello {produit}"), { key: "campagne.probleme.variable", values: { variable: "{produit}" } });
  assert.deepEqual(campaignProblem("a".repeat(1001), ""), { key: "campagne.probleme.texte_long", values: { max: 1000 } });
});

test("coût en SMS : le plus long des deux textes, multiplié par le nombre de destinataires", () => {
  assert.deepEqual(campaignSms("Bonjour {prenom}.", "", 12), { perMessage: 1, total: 12 });
  assert.deepEqual(campaignSms("Bonjour {prenom}.", "a".repeat(200), 3), { perMessage: 2, total: 6 });
  assert.deepEqual(campaignSms("Bonjour", "", 0), { perMessage: 1, total: 0 });
});

test("textes de départ : français du modèle, anglais vide (le français part à toutes), modèle anglais proposé à la demande", () => {
  const text = (lang: "fr" | "en", value: string): WhatsappText => ({ key: `campagne.${lang}`, kind: "campagne", lang, value, default: value });
  const texts = [text("fr", "Bonjour {prenom}"), text("en", "Hello {prenom}"), { ...text("fr", "Joyeux anniversaire"), kind: "anniversaire" as const }];
  assert.deepEqual(campaignDrafts(texts), { fr: "Bonjour {prenom}", en: "", enModel: "Hello {prenom}" });
  assert.deepEqual(campaignDrafts([]), { fr: "", en: "", enModel: "" });
});
