import assert from "node:assert/strict";
import { test } from "node:test";
import { translate } from "../i18n/translate.ts";
import type { Appointment } from "../types.ts";
import { BREAKPOINT_PX, defaultPrimaryAction, moreViews, nextAppointment, phoneTabs, plusWatchesStaff, railViews, msToNextMinute, timeAt, viewLabelKey, PANEL_COLUMN_PX, railFolded } from "./cadre.ts";
import type { Role } from "./auth-types.ts";

const ROLES: Role[] = ["admin", "manager", "reception", "practitioner"];
const labels = (role: Role, views: ReturnType<typeof phoneTabs>) => views.map((v) => translate("fr", viewLabelKey(v, role)));

test("point de rupture à 768 px", () => {
  assert.equal(BREAKPOINT_PX, 768);
});

test("onglets du téléphone selon le rôle, avant « Plus » (tableau du § 3.3)", () => {
  assert.deepEqual(labels("practitioner", phoneTabs("practitioner")), ["Ma journée", "Agenda", "Clientes"]);
  assert.deepEqual(labels("reception", phoneTabs("reception")), ["Aujourd'hui", "Agenda", "Rendez-vous", "Clientes"]);
  assert.deepEqual(labels("manager", phoneTabs("manager")), ["Aujourd'hui", "Agenda", "Clientes", "Équipe"]);
  assert.deepEqual(labels("admin", phoneTabs("admin")), ["Réglages"]);
  for (const role of ROLES) assert.ok(phoneTabs(role).length <= 4, role);
});

test("libellés des onglets en anglais", () => {
  assert.deepEqual(phoneTabs("reception").map((v) => translate("en", viewLabelKey(v, "reception"))), ["Today", "Calendar", "Appointments", "Clients"]);
  assert.equal(translate("en", viewLabelKey("dashboard", "practitioner")), "My day");
});

test("« Plus » : les rubriques restantes permises au rôle, sans doublon avec les onglets", () => {
  assert.deepEqual(moreViews("reception"), ["caisse", "staff", "services", "products", "reglages"]);
  assert.deepEqual(moreViews("manager"), ["appointments", "caisse", "services", "products", "reglages"]);
  assert.deepEqual(moreViews("practitioner"), ["appointments", "staff", "services", "products", "reglages"]);
  assert.deepEqual(moreViews("admin"), []);
  for (const role of ROLES) {
    assert.deepEqual([...phoneTabs(role), ...moreViews(role)].sort(), [...railViews(role)].sort(), `${role} : tout reste joignable`);
  }
});

test("le rail montre les rubriques permises au rôle, jamais l'activité à l'administrateur", () => {
  assert.deepEqual(railViews("admin"), ["reglages"]);
  assert.deepEqual(railViews("reception"), ["dashboard", "calendar", "appointments", "caisse", "clients", "staff", "services", "products", "reglages"]);
  assert.equal(translate("fr", viewLabelKey("caisse", "manager")), "Caisse du jour");
  assert.equal(translate("en", viewLabelKey("caisse", "manager")), "Daily till");
});

test("« + » par défaut : note au prochain rendez-vous (praticienne), nouveau rendez-vous (réception, gérante), aucun (administrateur)", () => {
  assert.equal(defaultPrimaryAction("practitioner"), "note-prochain-rdv");
  assert.equal(defaultPrimaryAction("reception"), "nouveau-rdv");
  assert.equal(defaultPrimaryAction("manager"), "nouveau-rdv");
  assert.equal(defaultPrimaryAction("admin"), null);
});

const apt = (id: number, staff_id: number | null, start_time: string, end_time: string, status: Appointment["status"] = "confirmed", scheduled_date = "2026-09-29") =>
  ({ id, staff_id, start_time, end_time, status, scheduled_date }) as Appointment;

test("prochain rendez-vous de la praticienne : en cours ou à venir, le plus tôt, les siens seulement", () => {
  const day = [
    apt(1, 7, "08:00", "09:00", "completed"),
    apt(2, 7, "09:00", "10:00"),
    apt(3, 7, "11:00", "12:00", "cancelled"),
    apt(4, 7, "13:00", "14:00", "booked"),
    apt(5, 8, "09:30", "10:30"),
    apt(6, 7, "12:00", "13:00", "no_show"),
    apt(7, 7, "10:30", "11:00", "booked", "2026-09-30"),
  ];
  assert.equal(nextAppointment(day, 7, "2026-09-29", "09:30")?.id, 2, "en cours");
  assert.equal(nextAppointment(day, 7, "2026-09-29", "10:00")?.id, 4, "terminé à 10:00, annulé et absente écartés");
  assert.equal(nextAppointment(day, 7, "2026-09-29", "14:00"), null, "journée finie");
  assert.equal(nextAppointment(day, 8, "2026-09-29", "07:00")?.id, 5);
  assert.equal(nextAppointment(day, null, "2026-09-29", "07:00"), null, "compte sans fiche de l'équipe");
  assert.equal(nextAppointment([], 7, "2026-09-29", "07:00"), null);
});

test("heure de Douala, quelle que soit l'heure de l'appareil", () => {
  assert.equal(timeAt(new Date("2026-09-29T23:30:00Z")), "00:30");
  assert.equal(timeAt(new Date("2026-09-29T08:05:00Z")), "09:05");
});

test("« + » de la praticienne : son prochain rendez-vous n'est suivi que sur téléphone, rien n'est chargé à partir de 768 px", () => {
  assert.equal(plusWatchesStaff("note-prochain-rdv", 4, false), 4);
  assert.equal(plusWatchesStaff("note-prochain-rdv", 4, true), null, "ordinateur ou tablette : « + » masqué, aucune requête");
  assert.equal(plusWatchesStaff("note-prochain-rdv", null, false), null, "compte sans fiche de l'équipe");
  assert.equal(plusWatchesStaff("nouveau-rdv", 4, false), null);
  assert.equal(plusWatchesStaff(null, 4, false), null);
});

test("rail replié tant qu'un panneau est posé par-dessus la page (768 à 1279 px), jamais à partir de 1280 px", () => {
  assert.equal(PANEL_COLUMN_PX, 1280);
  assert.equal(railFolded(true, false), true, "panneau ouvert sur tablette : rail replié");
  assert.equal(railFolded(true, true), false, "panneau en colonne : le rail garde le choix de l'appareil");
  assert.equal(railFolded(false, false), false, "sans panneau : le choix de l'appareil");
});

test("horloge alignée sur la minute pleine : le prochain relevé tombe à hh:mm:00, jamais jusqu'à 59 s plus tard", () => {
  assert.equal(msToNextMinute(Date.UTC(2026, 8, 29, 13, 59, 59, 500)), 500);
  assert.equal(msToNextMinute(Date.UTC(2026, 8, 29, 14, 0, 12, 0)), 48_000);
  assert.equal(msToNextMinute(Date.UTC(2026, 8, 29, 14, 0, 0, 0)), 60_000, "pile sur la minute : la suivante");
});
