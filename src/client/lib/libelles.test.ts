import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  auditAction, auditTarget, backupRunText, backupStatus, dateHeure, derniereCopie, destinationLabel, etatCompte,
  offlineText, outboxStatus, outboxType,
} from "./libelles.ts";

const AT = Date.parse("2026-09-28T08:00:00Z");

test("date et heure de l'institut (Douala), ou « jamais »", () => {
  assert.equal(dateHeure(AT, "fr"), "28/09/2026 09:00");
  assert.equal(dateHeure(AT, "en"), "28/09/2026 09:00");
  assert.equal(dateHeure(null, "fr"), "jamais");
  assert.equal(dateHeure(null, "en"), "never");
});

test("bandeau hors ligne, accord en nombre dans chaque langue", () => {
  assert.equal(offlineText(0, "fr"), "Hors ligne, aucun envoi en attente");
  assert.equal(offlineText(1, "fr"), "Hors ligne, 1 envoi en attente");
  assert.equal(offlineText(4, "fr"), "Hors ligne, 4 envois en attente");
  assert.equal(offlineText(0, "en"), "Offline, nothing waiting to be sent");
  assert.equal(offlineText(1, "en"), "Offline, 1 item waiting to be sent");
  assert.equal(offlineText(4, "en"), "Offline, 4 items waiting to be sent");
});

test("file d'envoi : états et types traduits, type inconnu rendu tel quel", () => {
  assert.deepEqual((["pending", "sending", "sent", "failed"] as const).map((s) => outboxStatus(s, "fr")), ["En attente", "Envoi en cours", "Envoyé", "En échec"]);
  assert.deepEqual((["pending", "sending", "sent", "failed"] as const).map((s) => outboxStatus(s, "en")), ["Waiting", "Sending", "Sent", "Failed"]);
  assert.equal(outboxType("sauvegarde.drive", "fr"), "Sauvegarde vers Google Drive");
  assert.equal(outboxType("sauvegarde.drive", "en"), "Backup to Google Drive");
  assert.equal(outboxType("autre.type", "en"), "autre.type");
});

function serverSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("chaque action inscrite au journal par le serveur a un libellé dans les deux langues (spec § 6)", () => {
  const root = new URL("../../server/", import.meta.url).pathname;
  const actions = new Set<string>();
  for (const file of serverSources(root)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("logAudit(")) continue;
    for (const m of text.matchAll(/action: "([a-z._]+)"/g)) actions.add(m[1]);
  }
  assert.ok(actions.size >= 15, `actions trouvées : ${[...actions].join(", ")}`);
  for (const action of actions) {
    assert.notEqual(auditAction(action, "fr"), action, action);
    assert.notEqual(auditAction(action, "en"), action, action);
  }
  assert.equal(auditAction("connexion.echec", "en"), "Failed sign-in");
});

test("cibles du journal écrites en français par le serveur : traduites à l'écran, les autres gardées", () => {
  assert.equal(auditTarget("(identifiant inconnu)", "en"), "(unknown username)");
  assert.equal(auditTarget("ligne de commande", "en"), "command line");
  assert.equal(auditTarget("grace", "en"), "grace");
});

test("état d'un compte, avec alerte si désactivé ou bloqué", () => {
  const base = { id: 1, display_name: "Grace", login: "grace", role: "reception" as const, staff_id: null, active: 1, has_pin: true, locked_until: null, language: "fr" as const };
  assert.deepEqual(etatCompte(base, AT, "fr"), { text: "Actif", alert: false });
  assert.deepEqual(etatCompte({ ...base, active: 0 }, AT, "en"), { text: "Disabled", alert: true });
  assert.deepEqual(etatCompte({ ...base, locked_until: Date.parse("2026-09-28T08:30:00Z") }, AT, "fr"), { text: "Bloqué jusqu'à 09:30", alert: true });
  assert.deepEqual(etatCompte({ ...base, locked_until: Date.parse("2026-09-28T08:30:00Z") }, AT, "en"), { text: "Locked until 09:30", alert: true });
  assert.deepEqual(etatCompte({ ...base, locked_until: Date.parse("2026-09-28T07:00:00Z") }, AT, "fr"), { text: "Actif", alert: false }, "blocage échu");
});

test("sauvegardes : destinations, états et résultat de « Sauvegarder maintenant »", () => {
  assert.deepEqual([destinationLabel("usb", "fr"), destinationLabel("usb", "en"), destinationLabel("drive", "en")], ["Disque USB", "USB drive", "Google Drive"]);
  assert.deepEqual((["ok", "failed", "pending"] as const).map((s) => backupStatus(s, "fr")), ["Réussie", "En échec", "En attente"]);
  assert.deepEqual((["ok", "failed", "pending"] as const).map((s) => backupStatus(s, "en")), ["Succeeded", "Failed", "Waiting"]);
  assert.equal(backupRunText({ usb: "ok", drive: "pending" }, "fr"), "Copie sur le disque USB réussie, copie vers Google Drive mise en file d'envoi.");
  assert.equal(backupRunText({ usb: "failed", drive: "pending" }, "en"), "Copy to the USB drive failed (see the history), copy to Google Drive queued in the outbox.");
  assert.equal(backupRunText({ usb: "ok", drive: "none" }, "fr"), "Copie sur le disque USB réussie. Google Drive n'est pas réglé, aucune copie hors du serveur.");
  assert.equal(backupRunText({ usb: "ok", drive: "none" }, "en"), "Copy to the USB drive succeeded. Google Drive is not set up, no copy kept off the server.");
  assert.equal(backupRunText({ usb: "failed", drive: "none" }, "fr"), "Copie sur le disque USB en échec (voir l'historique) et Google Drive n'est pas réglé, aucune copie n'a été gardée.");
  assert.equal(backupRunText({ usb: "failed", drive: "none" }, "en"), "Copy to the USB drive failed (see the history) and Google Drive is not set up, no copy was kept.");
});

test("dernière copie réussie, ou constat qu'aucune n'a réussi", () => {
  assert.equal(derniereCopie(AT, "fr"), "Dernière copie réussie le 28/09/2026 09:00");
  assert.equal(derniereCopie(AT, "en"), "Last successful copy on 28/09/2026 09:00");
  assert.equal(derniereCopie(null, "fr"), "Aucune copie réussie");
  assert.equal(derniereCopie(null, "en"), "No successful copy");
});

test("journal : commandes de la session WhatsApp traduites", () => {
  assert.equal(auditAction("whatsapp.session", "fr"), "Session WhatsApp démarrée ou déconnectée");
  assert.equal(auditTarget("demarrage", "en"), "Start");
  assert.equal(auditTarget("deconnexion", "fr"), "Déconnexion");
});

test("journal : photo d'un produit déposée ou retirée (images des produits)", () => {
  assert.equal(auditAction("produit.photo_depot", "fr"), "Photo d'un produit déposée");
  assert.equal(auditAction("produit.photo_retrait", "en"), "Product photo removed");
});

test("journal : produit envoyé par WhatsApp ; textes du produit recommandé (images des produits)", () => {
  assert.equal(auditAction("whatsapp.produit", "fr"), "Produit envoyé par WhatsApp");
  assert.equal(auditAction("whatsapp.produit", "en"), "Product sent by WhatsApp");
  assert.equal(auditTarget("whatsapp.texte.produit.fr", "fr"), "Texte du produit recommandé en français");
  assert.equal(auditTarget("whatsapp.texte.produit.en", "en"), "Recommended product text in English");
});

test("journal : campagne envoyée, réglages et textes des relances (mini CRM)", () => {
  assert.equal(auditAction("campagne.envoyee", "fr"), "Campagne envoyée");
  assert.equal(auditAction("campagne.envoyee", "en"), "Campaign sent");
  assert.equal(auditTarget("relances.anniversaire", "fr"), "Relance d'anniversaire");
  assert.equal(auditTarget("relances.absence", "en"), "Absence follow-up");
  assert.equal(auditTarget("relances.absence_jours", "fr"), "Seuil d'absence des relances");
  assert.equal(auditTarget("relances.heure", "en"), "Sending time of follow-ups");
  assert.equal(auditTarget("whatsapp.texte.anniversaire.fr", "fr"), "Texte d'anniversaire en français");
  assert.equal(auditTarget("whatsapp.texte.absence.en", "en"), "Absence follow-up text in English");
  assert.equal(auditTarget("whatsapp.texte.campagne.en", "en"), "Campaign text in English");
});

test("journal : textes du message de transfert (spec du 04/10/2026)", () => {
  assert.equal(auditTarget("whatsapp.texte.transfert.fr", "fr"), "Texte de transfert en français");
  assert.equal(auditTarget("whatsapp.texte.transfert.en", "en"), "Transfer text in English");
});

test("journal : rendez-vous transféré (spec du 04/10/2026)", () => {
  assert.equal(auditAction("rdv.transfert", "fr"), "Rendez-vous transféré");
  assert.equal(auditAction("rdv.transfert", "en"), "Appointment transferred");
});
