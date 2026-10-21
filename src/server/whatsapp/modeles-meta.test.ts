import assert from "node:assert/strict";
import { test } from "node:test";
import { englishFaults, frenchFaults, titleCaseFaults } from "../../client/i18n/typography.ts";
import {
  choisirLangue, corpsRendu, etatsDepuisMeta, LIMITE_CORPS, MODELES_META, nettoyerValeur, NOM_META, nomModele, nomsValides,
  numeroter, parametres, statutDe, texteADeposer, type EtatsModeles,
} from "./modeles-meta.ts";
import { DEFAULT_TEXTS, TEMPLATE_KINDS, variablesOf } from "./textes.ts";

/** Modèles de Meta fournis par lama (WhatsApp Business, spec du 21/10/2026, W-3, W-4, W-13, W-16, W-20). */

test("un modèle par type : nom par défaut, catégorie et en-tête du tableau de la spec, textes par défaut de lama (W-3)", () => {
  assert.deepEqual(TEMPLATE_KINDS.map((k) => [k, MODELES_META[k].nom, MODELES_META[k].categorie, MODELES_META[k].entete]), [
    ["confirmation", "lama_confirmation", "utilitaire", "aucun"],
    ["rappel", "lama_rappel", "utilitaire", "aucun"],
    ["ticket", "lama_ticket", "utilitaire", "document"],
    ["produit", "lama_produit", "marketing", "image"],
    ["anniversaire", "lama_anniversaire", "marketing", "aucun"],
    ["absence", "lama_absence", "marketing", "aucun"],
    ["campagne", "lama_campagne", "marketing", "aucun"],
    ["transfert", "lama_transfert", "utilitaire", "aucun"],
    ["en_ligne_confirmation", "lama_en_ligne_confirmation", "utilitaire", "aucun"],
    ["en_ligne_autre_horaire", "lama_en_ligne_autre_horaire", "utilitaire", "aucun"],
    ["en_ligne_refus", "lama_en_ligne_refus", "utilitaire", "aucun"],
    ["en_ligne_rappel", "lama_en_ligne_rappel", "utilitaire", "aucun"],
  ]);
  for (const kind of TEMPLATE_KINDS.filter((k) => k !== "produit" && k !== "campagne")) {
    assert.deepEqual(MODELES_META[kind].corps, DEFAULT_TEXTS[kind], `${kind} : texte par défaut de lama`);
  }
  assert.equal(MODELES_META.produit.corps.fr, "Bonjour {prenom}, voici {produit} ({prix}), que nous vous recommandons chez {institut}.");
  assert.equal(MODELES_META.campagne.corps.fr, "Message de {institut}\u00a0: {texte} À bientôt chez {institut}.");
});

test("numérotation par langue : première apparition, variable répétée au même numéro, sans trou (W-3)", () => {
  assert.deepEqual(numeroter(MODELES_META.campagne.corps.fr), { texte: "Message de {{1}}\u00a0: {{2}} À bientôt chez {{1}}.", ordre: ["institut", "texte"] });
  assert.deepEqual(numeroter(MODELES_META.confirmation.corps.en).ordre, ["prenom", "prestation", "date", "heure", "institut", "telephone"]);
  for (const kind of TEMPLATE_KINDS) {
    for (const lang of ["fr", "en"] as const) {
      const { texte, ordre } = numeroter(MODELES_META[kind].corps[lang]);
      const numeros = [...new Set([...texte.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
      assert.deepEqual(numeros, ordre.map((_v, i) => i + 1), `${kind}.${lang}`);
      assert.doesNotMatch(texte, /\{[a-z]/, `${kind}.${lang} : variable nommée restée`);
    }
  }
});

test("règles de Meta sur les douze corps : variables permises, ni au début ni à la fin, jamais côte à côte, noms valides, typographie (W-20)", () => {
  for (const kind of TEMPLATE_KINDS) {
    assert.match(MODELES_META[kind].nom, NOM_META, kind);
    const permises = [...variablesOf(kind), ...(kind === "campagne" ? ["texte"] : [])];
    for (const lang of ["fr", "en"] as const) {
      const corps = MODELES_META[kind].corps[lang];
      const ou = `${kind}.${lang}`;
      for (const [, nom] of corps.matchAll(/\{(\w+)\}/g)) assert.ok(permises.includes(nom), `${ou} : {${nom}}`);
      assert.doesNotMatch(corps, /^\s*\{/, `${ou} : variable au début`);
      assert.doesNotMatch(corps, /\}\s*$/, `${ou} : variable à la fin`);
      assert.doesNotMatch(corps, /\}\s*\{/, `${ou} : variables côte à côte`);
      // Typographie du texte lu par la cliente : une variable compte pour un mot, le texte d'une campagne pour une phrase.
      const lu = corps.replace(/\{(\w+)\}/g, (_tout, nom: string) => (nom === "texte" ? "x." : "x"));
      const fautes = lang === "fr" ? [...frenchFaults(lu), ...titleCaseFaults(lu)] : [...englishFaults(lu), ...titleCaseFaults(lu)];
      assert.deepEqual(fautes, [], ou);
    }
  }
});

test("valeurs pour Meta : ordre de la langue, sauts de ligne et tabulations remplacés, valeur vide remplacée, jamais vide (W-3, Review Focus 1 et 4)", () => {
  const valeurs = { prenom: "Aïcha", nom: "Aïcha Mbarga", date: "lundi 5 octobre", heure: "10:00", prestation: "Tresses", institut: "Institut Ébène", telephone: "699 00 00 00" };
  assert.deepEqual(parametres("confirmation", "fr", valeurs), ["Aïcha", "Tresses", "lundi 5 octobre", "10:00", "Institut Ébène", "699 00 00 00"]);
  assert.deepEqual(parametres("campagne", "en", { institut: "Institut Ébène", texte: "Nouveautés\nde la saison\t:      -10 %" }), ["Institut Ébène", "Nouveautés de la saison : -10 %"]);
  assert.equal(nettoyerValeur("a\r\nb"), "a  b");
  assert.equal(nettoyerValeur("a    b"), "a    b", "quatre espaces de suite : permis par Meta");
  assert.deepEqual(
    parametres("en_ligne_confirmation", "fr", { prenom: "", institut: "Institut Ébène", prestation: "", date: "mardi 20 octobre", heure: "10:00", praticienne: "" }),
    ["chère cliente", "beauté", "mardi 20 octobre", "10:00", "notre équipe", "Institut Ébène"],
  );
  assert.deepEqual(parametres("en_ligne_refus", "en", {}), ["dear client", "beauty", "\u2013", "\u2013", "\u2013", "\u2013"]);
  for (const kind of TEMPLATE_KINDS) {
    for (const lang of ["fr", "en"] as const) assert.ok(parametres(kind, lang, {}).every((v) => v.trim() !== ""), `${kind}.${lang}`);
  }
});

test("corps rendu : la limite de 1 024 caractères de Meta se mesure avant l'envoi (Review Focus 4)", () => {
  const params = parametres("campagne", "fr", { institut: "Institut Ébène", texte: "x".repeat(1000) });
  assert.ok(corpsRendu("campagne", "fr", params).length > LIMITE_CORPS);
  assert.equal(
    corpsRendu("rappel", "en", ["Aïcha", "Braids", "Monday 5 October", "10:00", "Institut Ébène"]),
    "Hello Aïcha, this is a reminder of your Braids appointment on Monday 5 October at 10:00 at Institut Ébène. See you soon!",
  );
});

test("noms : réglé, sinon par défaut ; vide reste vide ; réglage refusé hors de la règle de Meta (W-13, W-16)", () => {
  assert.equal(nomModele("rappel", null), "lama_rappel");
  assert.equal(nomModele("rappel", { rappel: "ebene_rappel" }), "ebene_rappel");
  assert.equal(nomModele("rappel", { rappel: "" }), "");
  assert.equal(nomsValides({ rappel: "ebene_rappel_2", ticket: "" }), true);
  assert.equal(nomsValides({}), true);
  for (const v of [null, [], "x", { rappel: "Rappel" }, { rappel: "rappel-1" }, { inconnu: "x" }, { rappel: 3 }, { rappel: "é" }]) {
    assert.equal(nomsValides(v), false, JSON.stringify(v));
  }
});

const LUS = [
  { name: "lama_confirmation", language: "fr", status: "APPROVED" },
  { name: "lama_confirmation", language: "en_US", status: "PENDING" },
  { name: "lama_rappel", language: "en", status: "APPROVED" },
  { name: "lama_rappel", language: "fr", status: "REJECTED" },
  { name: "lama_ticket", language: "fr", status: "PAUSED" },
  { name: "autre", language: "fr", status: "APPROVED" },
];

test("états lus chez Meta : nom réglé, fr ou en (en_US compris), statut traduit, absent sinon, date gardée (W-13)", () => {
  const etats = etatsDepuisMeta(LUS, null, 42);
  assert.equal(etats.verifieLe, 42);
  assert.deepEqual(etats.modeles.confirmation, { nom: "lama_confirmation", langues: { fr: { statut: "approuve", code: "fr" }, en: { statut: "en_attente", code: "en_US" } } });
  assert.deepEqual(etats.modeles.rappel?.langues, { fr: { statut: "refuse", code: "fr" }, en: { statut: "approuve", code: "en" } });
  assert.deepEqual(etats.modeles.ticket?.langues, { fr: { statut: "refuse", code: "fr" }, en: { statut: "absent", code: "en" } });
  assert.deepEqual(etats.modeles.produit?.langues, { fr: { statut: "absent", code: "fr" }, en: { statut: "absent", code: "en" } });
  assert.equal(etatsDepuisMeta(LUS, { confirmation: "autre" }, 0).modeles.confirmation?.langues.fr?.statut, "approuve", "nom réglé par l'administrateur");
  assert.equal(etatsDepuisMeta(LUS, { confirmation: "" }, 0).modeles.confirmation?.langues.fr?.statut, "absent", "nom vide : absent");
});

test("langue d'envoi : celle de la cliente si approuvée, sinon l'autre approuvée ; en attente ou non vérifié : tenté ; refusé ou absent : rien (W-4, W-16, Review Focus 3)", () => {
  const etats = etatsDepuisMeta(LUS, null, 0);
  assert.deepEqual(choisirLangue(etats, "confirmation", "lama_confirmation", "fr"), { lang: "fr", code: "fr" });
  assert.deepEqual(choisirLangue(etats, "confirmation", "lama_confirmation", "en"), { lang: "fr", code: "fr" }, "anglais en attente : le français approuvé, faute de mieux");
  assert.deepEqual(choisirLangue(etats, "rappel", "lama_rappel", "fr"), { lang: "en", code: "en" });
  assert.equal(choisirLangue(etats, "ticket", "lama_ticket", "fr"), null, "en pause et absent");
  assert.equal(choisirLangue(etats, "produit", "lama_produit", "en"), null, "absent dans les deux langues");
  assert.deepEqual(choisirLangue(null, "produit", "lama_produit", "en"), { lang: "en", code: "en" }, "jamais vérifié : tenté");
  assert.deepEqual(choisirLangue(etats, "ticket", "ebene_ticket", "fr"), { lang: "fr", code: "fr" }, "nom changé depuis la vérification : non vérifié, tenté");
  assert.equal(statutDe(etats, "ticket", "ebene_ticket", "en").statut, "non_verifie");
  const enAttente: EtatsModeles = { verifieLe: 0, modeles: { absence: { nom: "lama_absence", langues: { fr: { statut: "absent", code: "fr" }, en: { statut: "en_attente", code: "en" } } } } };
  assert.deepEqual(choisirLangue(enAttente, "absence", "lama_absence", "fr"), { lang: "en", code: "en" });
});

test("texte à déposer : nom, catégorie, en-tête, corps numéroté, exemples dans l'ordre, nom de l'institut réglé (W-13)", () => {
  assert.deepEqual(texteADeposer("ticket", "fr", { ticket: "ebene_ticket" }, { nom: "Institut Ébène", telephone: "" }), {
    nom: "ebene_ticket", categorie: "utilitaire", entete: "document", langue: "fr",
    corps: "Bonjour {{1}}, voici votre {{2}} de {{3}}. Merci de votre confiance\u00a0!",
    exemples: ["Aïcha", "ticket F-2026-000012", "Institut Ébène"],
  });
  assert.deepEqual(texteADeposer("campagne", "en", null, { nom: "", telephone: "" }).exemples, ["Institut", "Discover our new facials this month."]);
});
