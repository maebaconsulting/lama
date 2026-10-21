import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATIONS, runMigrations } from "./migrations.ts";
import { insererDemande } from "./en-ligne/essais-en-ligne.ts";

const avant021 = MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === "021_en_ligne"));

test("021 : base en service, rendez-vous existants hors ligne ; état de la liaison vierge", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, avant021);
  db.exec("INSERT INTO clients (name) VALUES ('Aïcha')");
  db.exec("INSERT INTO appointments (identifier, client_id) VALUES ('APT-1', 1)");
  runMigrations(db);
  assert.equal((db.prepare("SELECT en_ligne FROM appointments WHERE identifier = 'APT-1'").get() as { en_ligne: number }).en_ligne, 0);
  const etat = db.prepare("SELECT * FROM en_ligne_etat").all() as Record<string, unknown>[];
  assert.equal(etat.length, 1);
  assert.deepEqual([etat[0].id, etat[0].curseur, etat[0].offre_version, etat[0].plages_version, etat[0].derniere_erreur], [1, null, 0, 0, null]);
  assert.throws(() => db.exec("INSERT INTO en_ligne_etat (id) VALUES (2)"), /CHECK/);
});

test("021 : une demande par identifiant du contrat, états et langues contrôlés", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  db.exec("INSERT INTO staff (id, name) VALUES (1, 'Awa')");
  db.exec("INSERT INTO services (id, name) VALUES (1, 'Soin visage')");
  const id = insererDemande(db, { contrat_id: "d_unique" });
  assert.ok(id > 0);
  assert.throws(() => insererDemande(db, { contrat_id: "d_unique" }), /UNIQUE/);
  assert.throws(() => insererDemande(db, { etat: "perdue" }), /CHECK/);
  assert.throws(() => insererDemande(db, { cliente_langue: "de" }), /CHECK/);
  assert.throws(() => insererDemande(db, { fiche: "peut-etre" }), /CHECK/);
  db.exec("DELETE FROM services WHERE id = 1");
  assert.equal((db.prepare("SELECT service_id FROM demandes_en_ligne WHERE id = ?").get(id) as { service_id: number | null }).service_id, null, "prestation supprimée : la demande reste");
});

test("022 : base en service, curseur gardé sans référence : le premier tour l'oubliera", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === "022_curseur_ref")));
  db.exec("UPDATE en_ligne_etat SET curseur = '000000000042'");
  assert.deepEqual(runMigrations(db), ["022_curseur_ref", "023_prenom_en_ligne", "024_supplements", "025_mise_a_jour"]);
  assert.deepEqual({ ...(db.prepare("SELECT curseur, curseur_ref FROM en_ligne_etat").get() as object) }, { curseur: "000000000042", curseur_ref: null });
});

test("023 : base en service, demandes déjà reçues sans prénom", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === "023_prenom_en_ligne")));
  db.exec("INSERT INTO staff (id, name) VALUES (1, 'Awa')");
  db.exec("INSERT INTO services (id, name) VALUES (1, 'Soin visage')");
  const id = insererDemande(db, { contrat_id: "d_ancienne" });
  assert.deepEqual(runMigrations(db), ["023_prenom_en_ligne", "024_supplements", "025_mise_a_jour"]);
  assert.equal((db.prepare("SELECT cliente_prenom FROM demandes_en_ligne WHERE id = ?").get(id) as { cliente_prenom: string | null }).cliente_prenom, null);
});
