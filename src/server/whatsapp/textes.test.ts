import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_TEXTS, TEMPLATE_KINDS, documentLabel, firstName, formatDay, renderTemplate, templateProblem, variablesOf } from "./textes.ts";
import { SAMPLE_LENGTHS, estimateTemplate } from "../../shared/sms.ts";
import { placeholders } from "../../client/i18n/typography.ts";
import { decode } from "../messages.ts";
import { frenchFaults, englishFaults } from "../../client/i18n/typography.ts";
import { setupApp } from "../test-support.ts";

const VALUES = { prenom: "Aïcha", nom: "Aïcha Mbarga", date: "vendredi 2 octobre", heure: "10:00", prestation: "Tresses", institut: "Institut Ébène", telephone: "699 00 00 00" };

test("texte par défaut du rappel (spec § 3), variables remplacées", () => {
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.rappel.fr, VALUES),
    "Bonjour Aïcha, nous vous rappelons votre rendez-vous Tresses le vendredi 2 octobre à 10:00 chez Institut Ébène. À bientôt\u00a0!",
  );
});

test("une variable vide ne laisse pas de double espace", () => {
  assert.equal(renderTemplate("Votre rendez-vous {prestation} le {date}.", { ...VALUES, prestation: "" }), "Votre rendez-vous le vendredi 2 octobre.");
});

test("variable qui n'existe que sur Object.prototype (« toString ») : laissée telle quelle, pas la fonction héritée", () => {
  assert.equal(renderTemplate("Bonjour {toString} !", VALUES), "Bonjour {toString} !");
});

test("textes par défaut : typographie de chaque langue, variables connues seulement", () => {
  for (const kind of ["confirmation", "rappel"] as const) {
    assert.deepEqual(frenchFaults(DEFAULT_TEXTS[kind].fr), [], kind);
    assert.deepEqual(englishFaults(DEFAULT_TEXTS[kind].en), [], kind);
    assert.equal(templateProblem(DEFAULT_TEXTS[kind].fr), null);
    assert.equal(templateProblem(DEFAULT_TEXTS[kind].en), null);
  }
});

test("enregistrement d'un texte : variable inconnue, texte vide ou trop long refusés", () => {
  assert.equal(decode("fr", templateProblem("Bonjour {prénom}")!), "Variable inconnue\u00a0: {prénom}. Variables permises\u00a0: {prenom}, {nom}, {date}, {heure}, {prestation}, {institut}, {telephone}.");
  assert.equal(decode("fr", templateProblem("Bonjour {client}")!), "Variable inconnue\u00a0: {client}. Variables permises\u00a0: {prenom}, {nom}, {date}, {heure}, {prestation}, {institut}, {telephone}.");
  assert.equal(decode("fr", templateProblem("   ")!), "Le texte du message est vide.");
  assert.equal(decode("fr", templateProblem("a".repeat(1001))!), "Texte de 1000 caractères au plus attendu.");
  assert.equal(templateProblem(42), templateProblem("   "));
});

test("prénom : premier mot du nom ; date en toutes lettres dans la langue du message", () => {
  assert.equal(firstName("  Aïcha Mbarga "), "Aïcha");
  assert.equal(formatDay("2026-10-02", "fr"), "vendredi 2 octobre");
  assert.equal(formatDay("2026-10-02", "en"), "Friday 2 October");
});

test("réglages des textes : à la gérante seulement, variable inconnue refusée, défaut rendu tant qu'elle n'a rien changé", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const keys = (await gerante("GET", "/api/settings")).body.settings.map((s: { key: string }) => s.key);
  for (const k of ["whatsapp.texte.confirmation.fr", "whatsapp.texte.confirmation.en", "whatsapp.texte.rappel.fr", "whatsapp.texte.rappel.en", "whatsapp.rappel_heures", "whatsapp.silence_debut", "whatsapp.silence_fin"]) {
    assert.ok(keys.includes(k), k);
  }
  const bad = await gerante("PUT", "/api/settings/whatsapp.texte.rappel.fr", { value: "Bonjour {client}" }, { "Accept-Language": "fr" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Variable inconnue\u00a0: \{client\}/);
  assert.equal((await gerante("PUT", "/api/settings/whatsapp.texte.rappel.fr", { value: "Rappel {prenom}" })).status, 200);
  assert.equal((await gerante("PUT", "/api/settings/whatsapp.rappel_heures", { value: 0 })).status, 400);
  assert.equal((await gerante("PUT", "/api/settings/whatsapp.silence_debut", { value: "25:00" })).status, 400);
  const admin = await ctx.as("admin");
  const adminKeys = (await admin("GET", "/api/settings")).body.settings.map((s: { key: string }) => s.key);
  assert.ok(!adminKeys.some((k: string) => k.startsWith("whatsapp.texte.")), "jamais le texte des messages à l'administrateur");
  for (const k of ["whatsapp.fournisseur", "waha.adresse", "waha.cle", "waha.session", "whatsapp.indicatif"]) assert.ok(adminKeys.includes(k), k);
  assert.ok(!keys.includes("waha.cle") && !keys.includes("whatsapp.fournisseur"), "réglages du fournisseur : administrateur seulement");
});

test("réglages du fournisseur : valeurs contrôlées", async (t) => {
  const ctx = await setupApp(t);
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await admin("PUT", "/api/settings/whatsapp.fournisseur", { value: "meta" })).status, 400, "API Meta : vague 3");
  assert.equal((await admin("PUT", "/api/settings/whatsapp.fournisseur", { value: "waha" })).status, 200);
  assert.equal((await admin("PUT", "/api/settings/waha.adresse", { value: "ftp://x" })).status, 400);
  assert.equal((await admin("PUT", "/api/settings/waha.adresse", { value: "http://127.0.0.1:3000" })).status, 200);
  assert.equal((await admin("PUT", "/api/settings/waha.session", { value: "../x" })).status, 400);
  assert.equal((await admin("PUT", "/api/settings/whatsapp.indicatif", { value: "+237" })).status, 400);
  assert.equal((await admin("PUT", "/api/settings/whatsapp.indicatif", { value: "237" })).status, 200);
});

test("texte d'accompagnement d'un ticket, d'un avoir ou d'un reçu (vague 2) : typographie, variables propres à chaque type de message", () => {
  assert.deepEqual(frenchFaults(DEFAULT_TEXTS.ticket.fr), []);
  assert.deepEqual(englishFaults(DEFAULT_TEXTS.ticket.en), []);
  assert.equal(templateProblem(DEFAULT_TEXTS.ticket.fr, "ticket"), null);
  assert.equal(templateProblem(DEFAULT_TEXTS.ticket.en, "ticket"), null);
  assert.equal(decode("fr", templateProblem("Votre {document} du {date}", "ticket")!), "Variable inconnue\u00a0: {date}. Variables permises\u00a0: {prenom}, {nom}, {document}, {institut}, {telephone}.");
  assert.match(decode("fr", templateProblem("Votre {document}", "rappel")!), /^Variable inconnue\u00a0: \{document\}\./);
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.ticket.fr, { prenom: "Aïcha", nom: "Aïcha Mbarga", document: documentLabel("invoice", "F-2026-000012", "fr"), institut: "Institut Ébène", telephone: "" }),
    "Bonjour Aïcha, voici votre ticket F-2026-000012 de Institut Ébène. Merci de votre confiance\u00a0!",
  );
  assert.deepEqual(
    [documentLabel("credit", "AV-2026-000001", "fr"), documentLabel("deposit", "AC-2026-000001", "fr"), documentLabel("invoice", "F-1", "en"), documentLabel("credit", "AV-1", "en"), documentLabel("deposit", "AC-1", "en")],
    ["avoir AV-2026-000001", "reçu d'acompte AC-2026-000001", "receipt F-1", "credit note AV-1", "deposit receipt AC-1"],
  );
});

test("texte d'un produit recommandé (images des produits) : défaut de la spec, typographie, variables propres", () => {
  assert.deepEqual(TEMPLATE_KINDS.slice(0, 4), ["confirmation", "rappel", "ticket", "produit"]);
  assert.equal(DEFAULT_TEXTS.produit.fr, "{prenom}, voici {produit} ({prix}) que nous vous recommandons chez {institut}.");
  assert.equal(DEFAULT_TEXTS.produit.en, "{prenom}, here is {produit} ({prix}), which we recommend at {institut}.");
  assert.deepEqual(frenchFaults(DEFAULT_TEXTS.produit.fr), []);
  assert.deepEqual(englishFaults(DEFAULT_TEXTS.produit.en), []);
  assert.equal(templateProblem(DEFAULT_TEXTS.produit.fr, "produit"), null);
  assert.equal(templateProblem(DEFAULT_TEXTS.produit.en, "produit"), null);
  assert.equal(templateProblem("Pour {nom}, {produit}, {prix}, {telephone}", "produit"), null);
  assert.equal(decode("fr", templateProblem("{produit} le {date}", "produit")!), "Variable inconnue\u00a0: {date}. Variables permises\u00a0: {prenom}, {nom}, {produit}, {prix}, {institut}, {telephone}.");
  assert.match(decode("fr", templateProblem("Votre {produit}", "rappel")!), /^Variable inconnue\u00a0: \{produit\}\./);
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.produit.fr, { prenom: "Aïcha", produit: "Sérum Karité", prix: "12\u202f000\u00a0FCFA", institut: "Institut Ébène" }),
    "Aïcha, voici Sérum Karité (12\u202f000\u00a0FCFA) que nous vous recommandons chez Institut Ébène.",
  );
});

test("modèles du mini CRM : anniversaire, absence et campagne, variables de la cliente seulement, un SMS chacun", () => {
  assert.deepEqual(TEMPLATE_KINDS, ["confirmation", "rappel", "ticket", "produit", "anniversaire", "absence", "campagne", "transfert"]);
  for (const kind of ["anniversaire", "absence", "campagne"] as const) {
    assert.deepEqual(variablesOf(kind), ["prenom", "nom", "institut", "telephone"], kind);
    for (const lang of ["fr", "en"] as const) {
      const text = DEFAULT_TEXTS[kind][lang];
      assert.equal(templateProblem(text, kind), null, `${kind} ${lang}`);
      for (const name of placeholders(text)) assert.ok(Object.hasOwn(SAMPLE_LENGTHS, name), `${kind} ${lang} : longueur type de {${name}}`);
      assert.equal(estimateTemplate(text), 1, `${kind} ${lang} : un seul SMS`);
      assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, "sans émoji");
    }
    assert.deepEqual(frenchFaults(DEFAULT_TEXTS[kind].fr), [], kind);
    assert.deepEqual(englishFaults(DEFAULT_TEXTS[kind].en), [], kind);
  }
  assert.equal(
    decode("fr", templateProblem("Votre rendez-vous du {date}", "anniversaire")!),
    "Variable inconnue\u00a0: {date}. Variables permises\u00a0: {prenom}, {nom}, {institut}, {telephone}.",
  );
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.anniversaire.fr, { prenom: "Aïcha", nom: "Aïcha Mbarga", institut: "Institut Ébène", telephone: "699 00 00 00" }),
    "Bon anniversaire, Aïcha. Institut Ébène vous souhaite une très belle journée.",
  );
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.absence.en, { prenom: "Brenda", nom: "Brenda Ngo", institut: "Institut Ébène", telephone: "699 00 00 00" }),
    "Hello Brenda, we miss you! We would love to welcome you back at Institut Ébène.",
  );
});

test("modèles du mini CRM rendus sans téléphone et avec un nom à voyelle initiale : ni « de I », ni « au . », ni espace double", () => {
  for (const kind of ["anniversaire", "absence", "campagne"] as const) {
    for (const lang of ["fr", "en"] as const) {
      const text = renderTemplate(DEFAULT_TEXTS[kind][lang], { prenom: "Aïcha", nom: "Aïcha Mbarga", institut: "Institut Ébène", telephone: "" });
      assert.doesNotMatch(text, /\bde I/, `${kind} ${lang} : élision impossible`);
      assert.doesNotMatch(text, /\b(au|on|le) \./, `${kind} ${lang} : variable vide en fin de phrase`);
      assert.doesNotMatch(text, / \.|\s{2,}/, `${kind} ${lang} : espace double ou avant un point`);
      assert.match(text, /Institut Ébène/, `${kind} ${lang} : nom de l'institut`);
    }
  }
});

test("modèle de transfert (spec du 04/10/2026, décision 11) : variables d'une confirmation et {praticienne}, un SMS, typographie", () => {
  assert.deepEqual(variablesOf("transfert"), ["prenom", "nom", "date", "heure", "prestation", "institut", "telephone", "praticienne"]);
  for (const lang of ["fr", "en"] as const) {
    const text = DEFAULT_TEXTS.transfert[lang];
    assert.equal(templateProblem(text, "transfert"), null, lang);
    for (const name of placeholders(text)) assert.ok(Object.hasOwn(SAMPLE_LENGTHS, name), `${lang} : longueur type de {${name}}`);
    assert.equal(estimateTemplate(text), 1, `${lang} : un seul SMS`);
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, "sans émoji");
  }
  assert.deepEqual(frenchFaults(DEFAULT_TEXTS.transfert.fr), []);
  assert.deepEqual(englishFaults(DEFAULT_TEXTS.transfert.en), []);
  assert.doesNotMatch(DEFAULT_TEXTS.transfert.fr, /[:;!?]/, "sans ponctuation à espace insécable, comme les relances (GSM 7 bits)");
  assert.match(decode("fr", templateProblem("{praticienne} vous attend", "confirmation")!), /^Variable inconnue\u00a0: \{praticienne\}\./, "{praticienne} réservée au transfert");
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.transfert.fr, { ...VALUES, praticienne: "Grace" }),
    "Bonjour Aïcha, votre rendez-vous Tresses du vendredi 2 octobre à 10:00 chez Institut Ébène sera assuré par Grace.",
  );
  assert.equal(
    renderTemplate(DEFAULT_TEXTS.transfert.en, { ...VALUES, prestation: "Braids", date: "Friday 2 October", praticienne: "Grace" }),
    "Hello Aïcha, your Braids appointment on Friday 2 October at 10:00 at Institut Ébène will be with Grace.",
  );
});
