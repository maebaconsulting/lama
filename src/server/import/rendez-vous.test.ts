import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { registerFunctions } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { lireTableau } from "./csv.ts";
import { importable } from "./commun.ts";
import { analyserRendezVous, COLONNES_RENDEZ_VOUS, ecrireRendezVous } from "./rendez-vous.ts";

const ENTETE = "date;heure;telephone;nom_cliente;prestation;praticienne;notes";
/** 28/09/2026, 09:00 à Douala (08:00 UTC). */
const MAINTENANT = Date.parse("2026-09-28T08:00:00Z");
const CTX = { indicatif: "237", maintenant: MAINTENANT };

function base() {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  db.prepare("INSERT INTO staff (id, name, email, title, color) VALUES (1, 'Awa', '', '', '#4A5D73'), (2, 'Brenda', '', '', '#4A5D73')").run();
  db.prepare("INSERT INTO services (id, name, category, duration, price) VALUES (1, 'Soin hydratant', 'Visage', 60, 15000), (2, 'Brushing', 'Coiffure', 45, 8000), (3, 'Brushing', 'Enfants', 30, 5000), (4, 'Tresses longues', 'Coiffure', 120, 30000)").run();
  db.prepare("INSERT INTO clients (id, name, phone) VALUES (1, 'Cliente connue', '699 00 00 01')").run();
  return db;
}
function tableau(texte: string) {
  const l = lireTableau(texte, COLONNES_RENDEZ_VOUS);
  if (!l.ok) throw new Error(l.erreur.motif);
  return l.tableau;
}
const rendezVous = (db: DatabaseSync) => db.prepare(
  "SELECT a.client_id, a.staff_id, a.status, a.scheduled_date, a.start_time, a.end_time, a.total_price, a.notes, s.service_id, s.price, s.duration FROM appointments a JOIN appointment_services s ON s.appointment_id = a.id ORDER BY a.id",
).all().map((r) => ({ ...r }));

test("ajout : confirmé, durée et prix de la prestation, cliente connue par son téléphone, cliente inconnue créée une fois ; aucun message", () => {
  const db = base();
  const t = tableau([ENTETE,
    "2026-10-05;10:00;+237 699 00 00 01;;Soin hydratant;Awa;Peau sensible",
    "2026-10-05;10:00;677 00 00 02;Nouvelle Cliente;Coiffure > Brushing;brenda;",
    "2026-10-06;14:30;677000002;;Enfants > Brushing;Brenda;",
  ].join("\n"));
  const a = analyserRendezVous(db, t, CTX);
  assert.deepEqual([a.lignes, a.ajouts, a.clientesCreees, a.refusees.length], [3, 3, 1, 0]);
  assert.equal(importable(a), true);
  assert.deepEqual(rendezVous(db), [], "rien d'écrit par l'analyse");
  ecrireRendezVous(db, a.operations, MAINTENANT);
  assert.deepEqual(rendezVous(db), [
    { client_id: 1, staff_id: 1, status: "confirmed", scheduled_date: "2026-10-05", start_time: "10:00", end_time: "11:00", total_price: 15000, notes: "Peau sensible", service_id: 1, price: 15000, duration: 60 },
    { client_id: 2, staff_id: 2, status: "confirmed", scheduled_date: "2026-10-05", start_time: "10:00", end_time: "10:45", total_price: 8000, notes: "", service_id: 2, price: 8000, duration: 45 },
    { client_id: 2, staff_id: 2, status: "confirmed", scheduled_date: "2026-10-06", start_time: "14:30", end_time: "15:00", total_price: 5000, notes: "", service_id: 3, price: 5000, duration: 30 },
  ]);
  assert.deepEqual({ ...(db.prepare("SELECT name, phone FROM clients WHERE id = 2").get() as object) }, { name: "Nouvelle Cliente", phone: "+237677000002" });
  const identifiants = db.prepare("SELECT identifier FROM appointments ORDER BY id").all().map((r) => (r as { identifier: string }).identifier);
  assert.equal(new Set(identifiants).size, 3, "numéros APT distincts");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n, 0, "aucun message à la cliente");
  db.close();
});

test("date passée (dans le fuseau de l'institut), date ou heure mal formées, heure hors grille et fin après la fermeture", () => {
  const db = base();
  const t = tableau([ENTETE,
    "2026-09-27;10:00;699000001;;Soin hydratant;Awa;",
    "2026-09-28;08:30;699000001;;Soin hydratant;Awa;",
    "2026/10/05;10:00;699000001;;Soin hydratant;Awa;",
    "2026-02-30;10:00;699000001;;Soin hydratant;Awa;",
    "2026-10-05;9h30;699000001;;Soin hydratant;Awa;",
    "2026-10-05;10:07;699000001;;Soin hydratant;Awa;",
    "2026-10-05;22:00;699000001;;Tresses longues;Awa;",
    "2026-09-28;09:30;699000001;;Soin hydratant;Awa;",
  ].join("\n"));
  const a = analyserRendezVous(db, t, CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.rdv_passe" },
    { ligne: 3, motif: "import.rdv_passe" },
    { ligne: 4, motif: "import.date" },
    { ligne: 5, motif: "import.date" },
    { ligne: 6, motif: "rdv.heures_format" },
    { ligne: 7, motif: "rdv.heures_plage" },
    { ligne: 8, motif: "rdv.fin_apres_fermeture", valeurs: { fin: "00:00", fermeture: "23:00" } },
  ]);
  assert.equal(a.ajouts, 1, "aujourd'hui à 09:30, encore à venir à 09:00");
  db.close();
});

test("prestation ou praticienne introuvable ou ambiguë, téléphone invalide, cliente inconnue sans nom", () => {
  const db = base();
  const t = tableau([ENTETE,
    "2026-10-05;10:00;699000001;;Massage;Awa;",
    "2026-10-05;10:00;699000001;;Brushing;Awa;",
    "2026-10-05;11:00;699000001;;Soin hydratant;Carole;",
    "2026-10-05;12:00;12;;Soin hydratant;Awa;",
    "2026-10-05;13:00;677000009;;Soin hydratant;Awa;",
  ].join("\n"));
  assert.deepEqual(analyserRendezVous(db, t, CTX).refusees, [
    { ligne: 2, motif: "import.prestation_introuvable", valeurs: { nom: "Massage" } },
    { ligne: 3, motif: "import.prestation_ambigue", valeurs: { nom: "Brushing" } },
    { ligne: 4, motif: "import.praticienne_introuvable", valeurs: { nom: "Carole" } },
    { ligne: 5, motif: "import.telephone" },
    { ligne: 6, motif: "import.nom_cliente" },
  ]);
  db.close();
});

test("chevauchement : rendez-vous existant, créneau bloqué, ligne précédente du fichier ; un rendez-vous annulé ne compte pas", () => {
  const db = base();
  db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, status, scheduled_date, start_time, end_time) VALUES ('APT-1', 1, 1, 'booked', '2026-10-05', '10:00', '11:00'), ('APT-2', 1, 2, 'cancelled', '2026-10-05', '10:00', '11:00')").run();
  db.prepare("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (2, '2026-10-05', '13:00', '14:00', 'Pause')").run();
  const t = tableau([ENTETE,
    "2026-10-05;10:30;677000002;Dina;Soin hydratant;Awa;",
    "2026-10-05;10:00;677000003;Ella;Soin hydratant;Brenda;",
    "2026-10-05;10:30;677000004;Fanny;Soin hydratant;Brenda;",
    "2026-10-05;12:30;677000005;Gina;Soin hydratant;Brenda;",
    "2026-10-05;11:00;677000006;Hawa;Soin hydratant;Awa;",
  ].join("\n"));
  const a = analyserRendezVous(db, t, CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.rdv_occupee", valeurs: { praticienne: "Awa", debut: "10:00", fin: "11:00" } },
    { ligne: 4, motif: "import.rdv_occupee", valeurs: { praticienne: "Brenda", debut: "10:00", fin: "11:00" } },
    { ligne: 5, motif: "import.rdv_occupee", valeurs: { praticienne: "Brenda", debut: "13:00", fin: "14:00" } },
  ]);
  assert.equal(a.ajouts, 2, "Brenda à 10:00 (l'annulé ne compte pas) et Awa à 11:00, juste après");
  db.close();
});

test("doublons : même ligne deux fois dans le fichier, rendez-vous déjà dans l'agenda (fichier envoyé deux fois)", () => {
  const db = base();
  const texte = `${ENTETE}\n2026-10-05;10:00;699000001;;Soin hydratant;Awa;\n2026-10-05;10:00;+237699000001;;Soin hydratant;Brenda;\n`;
  const premier = analyserRendezVous(db, tableau(texte), CTX);
  assert.deepEqual(premier.refusees, [{ ligne: 3, motif: "import.doublon_rdv", doublon: true }]);
  ecrireRendezVous(db, analyserRendezVous(db, tableau(`${ENTETE}\n2026-10-05;10:00;699000001;;Soin hydratant;Awa;\n`), CTX).operations, MAINTENANT);
  const second = analyserRendezVous(db, tableau(`${ENTETE}\n2026-10-05;10:00;699 00 00 01;;Soin hydratant;Awa;\n`), CTX);
  assert.deepEqual(second.refusees, [{ ligne: 2, motif: "import.rdv_deja", doublon: true }]);
  db.close();
});

test("une ligne refusée pour un autre motif ne fait pas refuser sa jumelle valide comme doublon", () => {
  const db = base();
  const t = tableau([ENTETE,
    "2026-10-05;10:00;677 00 00 02;;Soin hydratant;Awa;",
    "2026-10-05;10:00;+237 677 00 00 02;Nouvelle Cliente;Soin hydratant;Awa;",
    "2026-10-05;10:00;677000002;Nouvelle Cliente;Soin hydratant;Awa;",
  ].join("\n"));
  const a = analyserRendezVous(db, t, CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "import.nom_cliente" },
    { ligne: 4, motif: "import.doublon_rdv", doublon: true },
  ]);
  assert.equal(a.ajouts, 1);
  db.close();
});

test("formes laissées par le tableur : date JJ/MM/AAAA ou J/M/AAAA, heure H:MM ou HH:MM:SS (secondes à 00)", () => {
  const db = base();
  const t = tableau([ENTETE,
    "05/10/2026;10:00;699000001;;Soin hydratant;Awa;",
    "6/10/2026;9:30;699000001;;Soin hydratant;Awa;",
    "2026-10-07;14:00:00;699000001;;Soin hydratant;Awa;",
    "2026-10-08;14:00:30;699000001;;Soin hydratant;Awa;",
    "31/02/2026;10:00;699000001;;Soin hydratant;Awa;",
  ].join("\n"));
  const a = analyserRendezVous(db, t, CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 5, motif: "rdv.heures_format" },
    { ligne: 6, motif: "import.date" },
  ]);
  assert.deepEqual(a.operations.map((op) => [op.date, op.debut, op.fin]), [
    ["2026-10-05", "10:00", "11:00"],
    ["2026-10-06", "09:30", "10:30"],
    ["2026-10-07", "14:00", "15:00"],
  ]);
  db.close();
});

test("nom de la ligne différent de celui de la fiche reconnue : avertissement, ligne importée, fiche inchangée", () => {
  const db = base();
  const t = tableau([ENTETE,
    "2026-10-05;10:00;699000001;Bella Autre;Soin hydratant;Awa;",
    "2026-10-05;12:00;699000001;cliente CONNUE;Soin hydratant;Awa;",
  ].join("\n"));
  const a = analyserRendezVous(db, t, CTX);
  assert.equal(a.ajouts, 2);
  assert.deepEqual(a.avertissements, [{ ligne: 2, motif: "import.nom_different", valeurs: { fichier: "Bella Autre", fiche: "Cliente connue" } }]);
  ecrireRendezVous(db, a.operations, MAINTENANT);
  assert.equal((db.prepare("SELECT name FROM clients WHERE id = 1").get() as { name: string }).name, "Cliente connue");
  db.close();
});

test("nom d'une cliente créée : suites d'espaces et retours à la ligne ramenés à une espace ; notes gardées", () => {
  const db = base();
  const a = analyserRendezVous(db, tableau(`${ENTETE}\n2026-10-05;10:00;677000002;"Nouvelle\n  Cliente";Soin hydratant;Awa;"ligne 1\nligne 2"\n`), CTX);
  ecrireRendezVous(db, a.operations, MAINTENANT);
  assert.equal((db.prepare("SELECT name FROM clients WHERE id = 2").get() as { name: string }).name, "Nouvelle Cliente");
  assert.equal((db.prepare("SELECT notes FROM appointments").get() as { notes: string }).notes, "ligne 1\nligne 2");
  db.close();
});

test("prestation « supplément seulement » : ligne refusée, elle ne se réserve qu'en supplément ; rien d'écrit", () => {
  const db = base();
  db.prepare("INSERT INTO services (id, name, category, duration, price, supplement_seulement) VALUES (5, 'Perles', 'Coiffure', 0, 500, 1)").run();
  const a = analyserRendezVous(db, tableau([ENTETE, "2026-10-05;10:00;699000001;;Perles;Awa;", "2026-10-05;11:00;699000001;;Coiffure > Perles;Awa;"].join("\n")), CTX);
  assert.deepEqual(a.refusees, [
    { ligne: 2, motif: "rdv.supplement_seul", valeurs: { nom: "Perles" } },
    { ligne: 3, motif: "rdv.supplement_seul", valeurs: { nom: "Perles" } },
  ]);
  assert.equal(importable(a), false);
  assert.deepEqual(a.operations, []);
  db.close();
});
