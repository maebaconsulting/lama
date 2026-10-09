import assert from "node:assert/strict";
import { test } from "node:test";
import { awaitingArrival, draftFor, keepDraft, needsConfirmation, newestFirst, nextStep, offersTransferNotice, otherStatuses, reschedulePatch, telHref } from "./fiche-rdv.ts";
import { appointmentCommands } from "./roles.ts";

/** Sous-projet 4 § 4.3 : fiche d'un rendez-vous, vérifiée en exécution. */

test("geste suivant : le tableau du § 4.3, ligne par ligne", () => {
  assert.deepEqual(nextStep("booked"), { to: "confirmed", labelKey: "rdv.geste.confirmer" });
  assert.deepEqual(nextStep("confirmed"), { to: "in_progress", labelKey: "rdv.geste.arrivee" });
  assert.deepEqual(nextStep("in_progress"), { to: "completed", labelKey: "rdv.geste.terminer" });
  for (const status of ["completed", "cancelled", "no_show", "inconnu", ""]) assert.equal(nextStep(status), null, status);
});

test("« Autre statut » : tous les autres statuts permis, ni l'actuel ni celui du gros bouton", () => {
  assert.deepEqual(otherStatuses("booked"), ["in_progress", "completed", "cancelled", "no_show"]);
  assert.deepEqual(otherStatuses("confirmed"), ["booked", "completed", "cancelled", "no_show"]);
  assert.deepEqual(otherStatuses("in_progress"), ["booked", "confirmed", "cancelled", "no_show"]);
  assert.deepEqual(otherStatuses("completed"), ["booked", "confirmed", "in_progress", "cancelled", "no_show"], "un rendez-vous terminé par erreur se rouvre");
  assert.deepEqual(otherStatuses("cancelled"), ["booked", "confirmed", "in_progress", "completed", "no_show"]);
});

test("Annuler et Absente demandent une confirmation, pas les autres", () => {
  assert.equal(needsConfirmation("cancelled"), true);
  assert.equal(needsConfirmation("no_show"), true);
  for (const status of ["booked", "confirmed", "in_progress", "completed"]) assert.equal(needsConfirmation(status), false, status);
});

test("Appeler : lien tel: propre, absent sans numéro utilisable", () => {
  assert.equal(telHref("+237 6 99 12 34 56"), "tel:+237699123456");
  assert.equal(telHref("699-12-34-56"), "tel:699123456");
  assert.equal(telHref("(+237) 699 12 34 56"), "tel:237699123456", "« + » gardé seulement en tête");
  for (const empty of [null, undefined, "", "   ", "néant", "12"]) assert.equal(telHref(empty), null, String(empty));
});

test("notes : les plus récentes d'abord, liste reçue intacte", () => {
  const notes = [
    { id: 1, created_at: "2026-09-29 08:00:00", content: "a" },
    { id: 3, created_at: "2026-09-29 10:00:00", content: "c" },
    { id: 2, created_at: "2026-09-29 10:00:00", content: "b" },
  ];
  assert.deepEqual(newestFirst(notes).map((n) => n.id), [3, 2, 1]);
  assert.deepEqual(notes.map((n) => n.id), [1, 3, 2]);
  assert.deepEqual(newestFirst(undefined), []);
});

test("commandes selon le rôle : la praticienne lit et ajoute une note, rien d'autre (droits du serveur)", () => {
  const all = { create: true, block: true, changeStatus: true, move: true, remove: true, deleteNote: true, addNote: true };
  assert.deepEqual(appointmentCommands("manager"), all);
  assert.deepEqual(appointmentCommands("reception"), all);
  assert.deepEqual(appointmentCommands("practitioner"), { create: false, block: false, changeStatus: false, move: false, remove: false, deleteNote: false, addNote: true });
  assert.deepEqual(appointmentCommands("admin"), { create: false, block: false, changeStatus: false, move: false, remove: false, deleteNote: false, addNote: false });
});

test("Déplacer : seuls les champs changés partent, rien si rien n'a changé", () => {
  const current = { scheduled_date: "2026-09-29", start_time: "10:00", staff_id: 3 };
  assert.equal(reschedulePatch(current, { date: "2026-09-29", time: "10:00", staffId: 3 }), null);
  assert.deepEqual(reschedulePatch(current, { date: "2026-09-30", time: "10:00", staffId: 3 }), { scheduled_date: "2026-09-30" });
  assert.deepEqual(reschedulePatch(current, { date: "2026-09-29", time: "11:15", staffId: 5 }), { start_time: "11:15", staff_id: 5 });
  assert.deepEqual(reschedulePatch(current, { date: "2026-09-29", time: "10:00", staffId: null }), { staff_id: null }, "retirer la praticienne");
  assert.equal(reschedulePatch({ ...current, staff_id: null }, { date: "2026-09-29", time: "10:00", staffId: null }), null);
});

test("brouillon de note : gardé par rendez-vous, oublié une fois vidé", () => {
  const drafts = new Map<number, string>();
  assert.equal(draftFor(drafts, 7), "", "aucun brouillon au départ");
  keepDraft(drafts, 7, "Allergie au latex");
  keepDraft(drafts, 9, "Rappeler la veille");
  assert.equal(draftFor(drafts, 7), "Allergie au latex", "retrouvé en revenant sur le rendez-vous");
  assert.equal(draftFor(drafts, 9), "Rappeler la veille", "chaque rendez-vous garde le sien");
  keepDraft(drafts, 7, " ");
  assert.equal(draftFor(drafts, 7), " ", "une saisie en cours reste telle quelle");
  keepDraft(drafts, 7, "");
  assert.equal(drafts.has(7), false, "vidé après l'envoi : plus rien en mémoire");
  assert.equal(draftFor(drafts, 9), "Rappeler la veille");
});

test("en attente d'arrivée : réservé ou confirmé, le jour même, heure de début passée (heure de Douala)", () => {
  const apt = (status: string, start = "15:30", date = "2026-09-29") => ({ status, scheduled_date: date, start_time: start });
  assert.equal(awaitingArrival(apt("confirmed"), "2026-09-29", "16:00"), true);
  assert.equal(awaitingArrival(apt("booked"), "2026-09-29", "16:00"), true);
  assert.equal(awaitingArrival(apt("confirmed", "15:30:00"), "2026-09-29", "15:30"), true, "à l'heure pile, secondes stockées");
  assert.equal(awaitingArrival(apt("confirmed", "16:15"), "2026-09-29", "16:00"), false, "pas encore l'heure");
  for (const status of ["in_progress", "completed", "cancelled", "no_show"]) assert.equal(awaitingArrival(apt(status), "2026-09-29", "16:00"), false, status);
  assert.equal(awaitingArrival(apt("confirmed", "15:30", "2026-09-28"), "2026-09-29", "16:00"), false, "autre jour");
  assert.equal(awaitingArrival(apt("confirmed"), "2026-09-29", "??"), false, "heure illisible");
});

test("Déplacer : case « Prévenir la cliente » quand le rendez-vous va à une autre praticienne, jamais vers « Non attribué »", () => {
  assert.equal(offersTransferNotice(1, 2), true);
  assert.equal(offersTransferNotice(null, 2), true);
  assert.equal(offersTransferNotice(2, 2), false);
  assert.equal(offersTransferNotice(2, null), false);
});
