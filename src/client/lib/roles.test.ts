import assert from "node:assert/strict";
import { test } from "node:test";
import { translate } from "../i18n/translate.ts";
import {
  canManageAppointments, canSeeBackupStatus, canSeeOutbox, canSell, creatableRoles, homePath, loadsActivity, mayManageAccount, mayOpen, menuFor,
  ROLE_KEYS, sectionFor, sectionsFor,
} from "./roles.ts";

test("libellés des rôles dans les deux langues", () => {
  const labels = (lang: "fr" | "en") => Object.fromEntries(Object.entries(ROLE_KEYS).map(([role, key]) => [role, translate(lang, key)]));
  assert.deepEqual(labels("fr"), { admin: "Administrateur", manager: "Gérante", reception: "Réceptionniste", practitioner: "Praticienne" });
  assert.deepEqual(labels("en"), { admin: "Administrator", manager: "Manager", reception: "Receptionist", practitioner: "Practitioner" });
});

test("l'administrateur n'a que les Réglages et ne charge aucune activité", () => {
  assert.deepEqual(menuFor("admin"), ["reglages"]);
  assert.equal(homePath("admin"), "/reglages");
  assert.equal(loadsActivity("admin"), false);
  for (const view of ["dashboard", "calendar", "appointments", "clients", "staff", "services", "products"]) {
    assert.equal(mayOpen("admin", view), false, view);
  }
  assert.equal(mayOpen("admin", "reglages"), true);
});

test("l'équipe garde l'activité et les Réglages", () => {
  for (const role of ["manager", "reception", "practitioner"] as const) {
    // « Caisse du jour » (sous-projet 5 § 6.3) : à qui vend, jamais à la praticienne.
    const caisse = role === "practitioner" ? [] : ["caisse"];
    assert.deepEqual(menuFor(role), ["dashboard", "calendar", "appointments", ...caisse, "clients", "staff", "services", "products", "reglages"]);
    assert.equal(mayOpen(role, "caisse"), role !== "practitioner");
    assert.equal(homePath(role), "/");
    assert.equal(loadsActivity(role), true);
    assert.equal(mayOpen(role, "clients"), true);
  }
});

test("rubriques des Réglages par rôle (spec § 4), « Mon compte » pour tous", () => {
  const ids = (role: Parameters<typeof sectionsFor>[0]) => sectionsFor(role).map((s) => s.id);
  assert.deepEqual(ids("admin"), ["caisse", "comptes", "postes", "file-envoi", "sauvegardes", "heure", "connexions", "journal", "mon-compte"]);
  assert.deepEqual(ids("manager"), ["institut", "caisse", "fidelite", "whatsapp", "comptes", "postes", "a-envoyer", "file-envoi", "journal", "mon-compte"]);
  assert.deepEqual(ids("reception"), ["a-envoyer", "file-envoi", "mon-compte"]);
  assert.deepEqual(ids("practitioner"), ["mon-compte"]);
});

test("rubrique demandée si permise, sinon la première permise", () => {
  assert.equal(sectionFor("manager", "journal"), "journal");
  assert.equal(sectionFor("manager", "sauvegardes"), "institut");
  assert.equal(sectionFor("practitioner", null), "mon-compte");
  assert.equal(sectionFor("admin", "inconnue"), "caisse", "préfixe des factures en tête, à régler avant la première vente (distribution D-01)");
});

test("bandeaux : file d'envoi sauf praticienne, sauvegardes pour la gérante et l'administrateur", () => {
  assert.deepEqual((["admin", "manager", "reception", "practitioner"] as const).map(canSeeOutbox), [true, true, true, false]);
  assert.deepEqual((["admin", "manager", "reception", "practitioner"] as const).map(canSeeBackupStatus), [true, true, false, false]);
});

test("comptes : ce que chacun peut créer et gérer, comme le serveur", () => {
  assert.deepEqual(creatableRoles("admin"), ["admin", "manager", "reception"]);
  assert.deepEqual(creatableRoles("manager"), ["reception", "practitioner"]);
  assert.deepEqual(creatableRoles("reception"), []);
  const admin = { id: 1, role: "admin" as const };
  const manager = { id: 2, role: "manager" as const };
  assert.equal(mayManageAccount(admin, { id: 9, role: "manager" }), true);
  assert.equal(mayManageAccount(manager, { id: 9, role: "reception" }), true);
  assert.equal(mayManageAccount(manager, { id: 9, role: "admin" }), false);
  assert.equal(mayManageAccount(manager, { id: 3, role: "manager" }), false, "une autre gérante");
  assert.equal(mayManageAccount(manager, { id: 2, role: "manager" }), true, "elle-même");
});

test("fiche d'un rendez-vous : supprimer, déplacer, réattribuer, changer le statut et supprimer une note réservés à la gérante et à la réception (règles du serveur)", () => {
  assert.equal(canManageAppointments("manager"), true);
  assert.equal(canManageAppointments("reception"), true);
  assert.equal(canManageAppointments("practitioner"), false, "la praticienne lit la fiche et ajoute une note");
  assert.equal(canManageAppointments("admin"), false, "l'administrateur n'a aucun accès à l'activité");
});

test("écran « Vente », hors menu : gérante et réception seulement, comme le serveur (sous-projet 5 § 4.5)", () => {
  assert.deepEqual((["admin", "manager", "reception", "practitioner"] as const).map((role) => [canSell(role), mayOpen(role, "vente")]), [
    [false, false], [true, true], [true, true], [false, false],
  ]);
  assert.equal((menuFor("manager") as string[]).includes("vente"), false, "pas de rubrique « Vente » au menu");
});
