import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateTemplate } from "../../shared/sms.ts";
import { DEFAULT_TEXTS } from "../whatsapp/textes.ts";
import { SEMAINE_DEFAUT } from "../../shared/horaires.ts";
import { DemandeRelais, enregistrerDemande } from "./demandes.ts";
import { baseEssai, reglagesMessages } from "./essais-en-ligne.ts";
import { inscrireMessage, messageBilingue, sansPrenom, texteMessage } from "./messages-en-ligne.ts";

const SUJET = { date: "2026-10-20", heure: "10:00", praticienne: "Awa Ndiaye", prestation: { fr: "Soin visage", en: "Facial" } };
const MIREILLE = { id: 7, cliente_prenom: "Mireille", cliente_nom: "Mireille Ngo", cliente_telephone: "+237699000111", cliente_langue: "fr" as const, client_id: null };
const QUI = { prenom: "Mireille", nom: "Mireille Ngo" };
const file = (db: ReturnType<typeof baseEssai>) => db.prepare("SELECT dedupe_key, payload, next_attempt_at FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { dedupe_key: string; payload: string; next_attempt_at: number }[];

test("texte du message : prénom, prestation et date dans la langue de la cliente", () => {
  const s = reglagesMessages();
  assert.equal(texteMessage(s, "en_ligne_confirmation", "fr", QUI, SUJET), "Bonjour Mireille, votre rendez-vous Soin visage du mardi 20 octobre à 10:00 avec Awa est confirmé chez Institut Éclat. Merci de votre confiance.");
  assert.match(texteMessage(s, "en_ligne_autre_horaire", "en", QUI, SUJET), /^Hello Mireille, the time you asked for Facial is no longer free\. Institut Éclat offers you Tuesday 20 October at 10:00 with Awa\./);
  assert.deepEqual(Object.keys(messageBilingue(s, "en_ligne_refus", QUI, SUJET, "Nous sommes complets ce jour-là.")), ["fr", "en"]);
  assert.match(messageBilingue(s, "en_ligne_refus", QUI, SUJET, "Nous sommes complets.").fr, /Nous sommes complets\.$/);
});

test("message inscrit dans la file : numéro international, langue, nature « en ligne », jamais pendant le silence", () => {
  const db = baseEssai();
  const s = reglagesMessages();
  // Mardi 20 octobre, 10:00 à Douala : hors du silence, premier essai aussitôt.
  const jour = Date.parse("2026-10-20T09:00:00Z");
  assert.equal(inscrireMessage(db, s, "en_ligne_confirmation", MIREILLE, SUJET, jour), true);
  // 22:30 à Douala : premier essai à la fin du silence, 08:00 le lendemain.
  const nuit = Date.parse("2026-10-20T21:30:00Z");
  assert.equal(inscrireMessage(db, s, "en_ligne_refus", { ...MIREILLE, cliente_langue: "en" }, SUJET, nuit), true);
  const [a, b] = file(db);
  const pa = JSON.parse(a.payload);
  assert.deepEqual([pa.to, pa.lang, pa.origin], ["237699000111", "fr", { type: "en_ligne", demandeId: 7 }]);
  assert.equal(a.next_attempt_at, jour);
  assert.equal(JSON.parse(b.payload).lang, "en");
  assert.equal(b.next_attempt_at, Date.parse("2026-10-21T07:00:00Z"));
  assert.match(a.dedupe_key, /^wa:en_ligne:en_ligne_confirmation:7:/);
});

const BASE = { curseur: "000001", recue_le: 1, prestation: "s1", praticienne: null, souhait: { jours: ["lun"], moments: ["matin"], precision: "" }, date: null, heure: null, type: "rappel" as const, note: "" };
const arrivee = (db: ReturnType<typeof baseEssai>, id: string, nom: string, telephone = "+237699000111", prestation = "s1") =>
  enregistrerDemande(db, DemandeRelais.parse({ ...BASE, id, prestation, cliente: { nom, telephone, langue: "fr" } }),
    { institut: SEMAINE_DEFAUT, indicatif: "237", messages: reglagesMessages(), maintenant: Date.parse("2026-10-20T09:00:00Z") });

test("demande de rappel : accusé inscrit à l'arrivée pour une fiche connue, avec le prénom de la fiche ; rien pour un créneau", () => {
  const db = baseEssai();
  const ctx = { institut: SEMAINE_DEFAUT, indicatif: "237", messages: reglagesMessages(), maintenant: Date.parse("2026-10-20T09:00:00Z") };
  db.prepare("INSERT INTO clients (name, phone) VALUES ('Mireille Ngo', '699000111')").run();
  const creneau = { ...BASE, souhait: null, cliente: { nom: "Mireille Ngo", telephone: "+237699000111", langue: "fr" } };
  enregistrerDemande(db, DemandeRelais.parse({ ...creneau, id: "d_c", type: "creneau", date: "2026-10-21", heure: "10:00" }), ctx);
  assert.equal(file(db).length, 0);
  // Le nom saisi diffère mais reste proche (mots inclus) : le prénom vient de la fiche.
  arrivee(db, "d_r", "Ngo Mireille Chantal");
  const [accuse] = file(db);
  assert.match(JSON.parse(accuse.payload).text, /^Bonjour Mireille, Institut Éclat a bien enregistré votre demande de rappel pour Soin visage\./);
  arrivee(db, "d_r", "Ngo Mireille Chantal");
  assert.equal(file(db).length, 1, "relevée deux fois : un seul accusé");
});

test("accusé de rappel : aucun message pour une fiche inconnue, à vérifier, ou en canal « Aucun »", () => {
  const db = baseEssai();
  arrivee(db, "d_1", "Inconnue Personne", "+237677000001");
  db.prepare("INSERT INTO clients (name, phone) VALUES ('Sandrine Eto', '699000222')").run();
  arrivee(db, "d_2", "Quelqu'un d'autre", "+237699000222");
  db.prepare("INSERT INTO clients (name, phone, channel) VALUES ('Brenda Fouda', '699000333', 'none')").run();
  arrivee(db, "d_3", "Brenda Fouda", "+237699000333");
  assert.equal(file(db).length, 0);
});

test("accusé de rappel : prestation inconnue, jamais « pour . »", () => {
  const db = baseEssai();
  db.prepare("INSERT INTO clients (name, phone) VALUES ('Mireille Ngo', '699000111')").run();
  arrivee(db, "d_x", "Mireille Ngo", "+237699000111", "s9999");
  assert.match(JSON.parse(file(db)[0].payload).text, /pour votre demande\. /);
  assert.match(texteMessage(reglagesMessages(), "en_ligne_rappel", "en", QUI, { ...SUJET, prestation: { fr: "", en: "" } }), /for your request\./);
});

test("geste de la réception : rien n'est écrit pour une fiche liée en canal « Aucun » ; sans fiche liée, inchangé", () => {
  const db = baseEssai();
  const s = reglagesMessages();
  db.prepare("INSERT INTO clients (id, name, phone, channel) VALUES (50, 'Brenda Fouda', '699000333', 'none')").run();
  assert.equal(inscrireMessage(db, s, "en_ligne_refus", { ...MIREILLE, client_id: 50 }, SUJET, 1), false);
  assert.equal(file(db).length, 0);
  assert.equal(inscrireMessage(db, s, "en_ligne_refus", MIREILLE, SUJET, 1), true);
});

test("accusé de rappel : un SMS au plus, en français et en anglais", () => {
  for (const lang of ["fr", "en"] as const) assert.equal(estimateTemplate(DEFAULT_TEXTS.en_ligne_rappel[lang]), 1, lang);
});

test("sans prénom transmis (relais plus ancien) : aucun prénom deviné, « Bonjour, » ; jamais le premier mot du nom", () => {
  const s = reglagesMessages();
  const qui = { prenom: null, nom: "Essai Bertille" };
  assert.equal(texteMessage(s, "en_ligne_confirmation", "fr", qui, SUJET), "Bonjour, votre rendez-vous Soin visage du mardi 20 octobre à 10:00 avec Awa est confirmé chez Institut Éclat. Merci de votre confiance.");
  assert.match(texteMessage(s, "en_ligne_refus", "en", qui, SUJET), /^Hello, we cannot see you for Facial/);
  assert.match(messageBilingue(s, "en_ligne_autre_horaire", qui, SUJET).fr, /^Bonjour, l'horaire demandé/);
  assert.match(texteMessage(s, "en_ligne_confirmation", "fr", { prenom: "Bertille", nom: "Essai Bertille" }, SUJET), /^Bonjour Bertille, /);
});

test("texte réécrit par la gérante, prénom ailleurs qu'après « Bonjour » : ni virgule ni espace orphelins", () => {
  assert.equal(sansPrenom("{prenom}, votre rendez-vous {prestation} est confirmé."), "Votre rendez-vous {prestation} est confirmé.");
  assert.equal(sansPrenom("{prenom}\u00a0: votre rendez-vous est confirmé."), "Votre rendez-vous est confirmé.");
  assert.equal(sansPrenom("{prenom} ! - votre rendez-vous"), "Votre rendez-vous");
  assert.equal(sansPrenom("Bonjour {prenom}, à bientôt chez {institut}."), "Bonjour, à bientôt chez {institut}.");
  assert.equal(sansPrenom("Chère {prenom} {nom},"), "Chère {nom},");
});

test("message enrichi (WhatsApp Business, W-2) : modèle de la nature, valeurs ; sans prénom, valeur vide (Meta la remplace), texte inchangé", () => {
  const db = baseEssai();
  const s = reglagesMessages();
  const jour = Date.parse("2026-10-20T09:00:00Z");
  assert.equal(inscrireMessage(db, s, "en_ligne_confirmation", MIREILLE, SUJET, jour), true);
  assert.equal(inscrireMessage(db, s, "en_ligne_refus", { ...MIREILLE, id: 8, cliente_prenom: null }, SUJET, jour, "Nous sommes complets."), true);
  const [a, b] = file(db).map((r) => JSON.parse(r.payload));
  assert.equal(a.modele, "en_ligne_confirmation");
  assert.deepEqual(a.valeurs, { prenom: "Mireille", nom: "Mireille Ngo", institut: "Institut Éclat", telephone: "699 00 00 00", prestation: "Soin visage", date: "mardi 20 octobre", heure: "10:00", praticienne: "Awa" });
  assert.equal(a.text, texteMessage(s, "en_ligne_confirmation", "fr", QUI, SUJET));
  assert.equal(b.modele, "en_ligne_refus");
  assert.equal(b.valeurs.prenom, "");
  assert.match(b.text, /^Bonjour, nous ne pouvons pas vous recevoir/);
  assert.match(b.text, /Nous sommes complets\.$/);
});