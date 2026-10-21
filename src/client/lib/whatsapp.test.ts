import assert from "node:assert/strict";
import { test } from "node:test";
import { documentPdfPath, groupPhone, manualAttachment, manualOpenKey, manualTypeLabel, sessionAlert, smsLink, statusAlarming, statusText, ticketChoice, waLink } from "./whatsapp.ts";
import { canLinkWhatsapp, canSeeManual, sectionsFor } from "./roles.ts";
import { outboxStatus, outboxType } from "./libelles.ts";
import { parseRoute, pathFor } from "./routes.ts";

test("lien « Ouvrir WhatsApp » : wa.me, numéro en chiffres, texte encodé ; sans numéro, choix du contact", () => {
  assert.equal(waLink("237699123456", "Bonjour Aïcha, à 10:00 ?"), "https://wa.me/237699123456?text=Bonjour%20A%C3%AFcha%2C%20%C3%A0%2010%3A00%20%3F");
  assert.equal(waLink("", "Bonjour"), "https://wa.me/?text=Bonjour");
});

test("état de la session dit en clair, numéro de l'institut au format international", () => {
  assert.equal(statusText({ provider: "waha", state: "connecte", phone: "237699000000" }, "fr"), "Connecté au numéro +237\u00a0699\u00a000\u00a000\u00a000.");
  assert.equal(statusText({ provider: "waha", state: "qr" }, "en"), "QR code to scan with the institute's phone.");
  assert.equal(statusText({ provider: "waha", state: "injoignable" }, "fr"), "Passerelle injoignable\u00a0: vérifiez que WAHA tourne sur le serveur de l'institut.");
  assert.equal(statusText({ provider: "aucun" }, "fr"), "Aucun fournisseur\u00a0: les messages vont dans «\u00a0À envoyer à la main\u00a0».");
});

test("bandeau d'alerte : WAHA choisi et session non connectée seulement", () => {
  assert.equal(sessionAlert(null), false);
  assert.equal(sessionAlert({ provider: "aucun" }), false);
  assert.equal(sessionAlert({ provider: "waha", state: "connecte", phone: "1" }), false);
  for (const state of ["qr", "demarrage", "deconnecte", "injoignable", "erreur"] as const) assert.equal(sessionAlert({ provider: "waha", state }), true, state);
});

test("types de message traduits", () => {
  assert.deepEqual((["confirmation", "rappel", "ticket", "libre"] as const).map((t) => manualTypeLabel(t, "fr")), ["Confirmation", "Rappel", "Ticket", "Message"]);
});

test("droits à l'écran, comme le serveur : liste à la main pour la réception et la gérante, session pour la gérante et l'administrateur", () => {
  assert.deepEqual((["admin", "manager", "reception", "practitioner"] as const).map(canSeeManual), [false, true, true, false]);
  assert.deepEqual((["admin", "manager", "reception", "practitioner"] as const).map(canLinkWhatsapp), [true, true, false, false]);
});

test("file d'envoi : messages WhatsApp nommés, sort donné à la main affiché", () => {
  assert.equal(outboxType("whatsapp", "fr"), "Message WhatsApp");
  assert.equal(outboxStatus("sent", "fr", "sent"), "Envoyé à la main");
  assert.equal(outboxStatus("sent", "en", "ignored"), "Ignored");
  assert.equal(outboxStatus("sent", "fr", ""), "Envoyé");
});

test("rubriques WhatsApp : « WhatsApp » à la gérante, « À envoyer à la main » à la réception et à la gérante, adresses dans les deux langues", () => {
  assert.ok(sectionsFor("manager").some((s) => s.id === "whatsapp"));
  assert.ok(!sectionsFor("admin").some((s) => s.id === "whatsapp" || s.id === "a-envoyer"));
  assert.ok(sectionsFor("reception").some((s) => s.id === "a-envoyer"));
  assert.equal(pathFor("reglages", "fr", "a-envoyer"), "/reglages/a-envoyer");
  assert.equal(pathFor("reglages", "en", "a-envoyer"), "/settings/to-send");
  assert.equal(pathFor("reglages", "en", "whatsapp"), "/settings/messages");
  assert.equal(pathFor("reglages", "fr", "whatsapp"), "/reglages/messages");
  assert.equal(parseRoute("/settings/to-send").id, "a-envoyer");
});

test("document à envoyer à la main (vague 2) : adresse du PDF à télécharger, nom du fichier", () => {
  assert.equal(documentPdfPath({ kind: "invoice", id: 12 }), "/api/invoices/12/pdf?telecharger=1");
  assert.equal(documentPdfPath({ kind: "credit", id: 13 }), "/api/invoices/13/pdf?telecharger=1");
  assert.equal(documentPdfPath({ kind: "deposit", id: 4 }), "/api/deposits/4/pdf?telecharger=1");
});

test("case « Envoyer par WhatsApp » à l'encaissement : proposée si la cliente a un numéro, cochée si elle accepte WhatsApp", () => {
  assert.deepEqual(ticketChoice(null), { offered: false, checked: false });
  assert.deepEqual(ticketChoice({ phone: "  ", channel: "whatsapp" }), { offered: false, checked: false });
  assert.deepEqual(ticketChoice({ phone: "699 12 34 56", channel: "whatsapp" }), { offered: true, checked: true });
  assert.deepEqual(ticketChoice({ phone: "699 12 34 56", channel: "none" }), { offered: true, checked: false });
  assert.deepEqual(ticketChoice({ phone: "699 12 34 56", channel: "sms" }), { offered: false, checked: false }, "document jamais par SMS");
});

test("lien SMS (Android) : numéro international, texte encodé", () => {
  assert.equal(smsLink("237699123456", "Bonjour Aïcha, à demain & merci"), "sms:+237699123456?body=Bonjour%20A%C3%AFcha%2C%20%C3%A0%20demain%20%26%20merci");
});

test("numéro de l'institut groupé (vague 2) : +237 699 00 00 00, insécable ; autre indicatif : chiffres seuls après le +", () => {
  assert.equal(groupPhone("237699000000"), "+237\u00a0699\u00a000\u00a000\u00a000");
  assert.equal(groupPhone("33612345678"), "+33612345678");
  assert.equal(groupPhone(""), "");
});

test("couleur de l'état : rouge seulement pour une session à reprendre (déconnectée, passerelle injoignable, erreur), jamais pour le QR à scanner", () => {
  for (const state of ["connecte", "qr", "demarrage"] as const) assert.equal(statusAlarming({ provider: "waha", state }), false, state);
  for (const state of ["deconnecte", "injoignable", "erreur"] as const) assert.equal(statusAlarming({ provider: "waha", state }), true, state);
  assert.equal(statusAlarming({ provider: "aucun" }), false);
});

test("produit à envoyer à la main : photo à télécharger s'il en a une (jamais par SMS) ; sans photo, texte seul ; libellés", () => {
  const base = { id: 1, type: "produit" as const, client_id: 1, client_name: "Aïcha", created_at: 0, reason: "", to: "237699123456", text: "x" };
  const avec = { ...base, product: { id: 3, name: "Sérum Karité", image_version: 2 } };
  const sans = { ...base, product: { id: 3, name: "Sérum Karité", image_version: null } };
  assert.equal(manualAttachment(avec), "photo");
  assert.equal(manualAttachment(sans), null);
  assert.equal(manualAttachment({ ...base, type: "ticket", document: { kind: "invoice", id: 1, number: "F-1" } }), "document");
  assert.equal(manualOpenKey(avec), "a_envoyer.ouvrir_photo");
  assert.equal(manualOpenKey(sans), "a_envoyer.ouvrir");
  assert.equal(manualOpenKey({ ...base, document: { kind: "credit", id: 1, number: "AV-1" } }), "a_envoyer.ouvrir_document");
  assert.equal(manualTypeLabel("produit", "fr"), "Produit recommandé");
  assert.equal(manualTypeLabel("produit", "en"), "Recommended product");
});

test("types des relances et des campagnes dans « À envoyer à la main » (mini CRM)", () => {
  assert.deepEqual((["anniversaire", "absence", "campagne"] as const).map((t) => manualTypeLabel(t, "fr")), ["Anniversaire", "Vous nous manquez", "Campagne"]);
  assert.deepEqual((["anniversaire", "absence", "campagne"] as const).map((t) => manualTypeLabel(t, "en")), ["Birthday", "We miss you", "Campaign"]);
});

test("type « transfert » dans « À envoyer à la main » (spec du 04/10/2026)", () => {
  assert.equal(manualTypeLabel("transfert", "fr"), "Transfert");
  assert.equal(manualTypeLabel("transfert", "en"), "Transfer");
});

test("WhatsApp Business : état dit en clair, en rouge hors connexion, jamais de bandeau de session", () => {
  assert.equal(statusText({ provider: "meta", state: "connecte", phone: "237699000000" }, "fr"), "Connecté au numéro +237\u00a0699\u00a000\u00a000\u00a000.");
  assert.equal(statusText({ provider: "meta", state: "erreur" }, "fr"), "WhatsApp Business en erreur\u00a0: vérifiez le jeton et les identifiants avec «\u00a0Tester la connexion\u00a0».");
  assert.equal(statusText({ provider: "meta", state: "injoignable" }, "en"), "Meta unreachable: check the internet connection.");
  assert.equal(statusText({ provider: "waha", state: "erreur" }, "fr"), "Passerelle en erreur\u00a0: vérifiez sa clé et son adresse.", "WAHA inchangé");
  assert.equal(statusAlarming({ provider: "meta", state: "erreur" }), true);
  assert.equal(statusAlarming({ provider: "meta", state: "connecte", phone: "1" }), false);
  assert.equal(sessionAlert({ provider: "meta", state: "erreur" }), false);
});
