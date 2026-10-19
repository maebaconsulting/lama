import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATIONS, runMigrations } from "./migrations.ts";

const avant020 = MIGRATIONS.slice(0, MIGRATIONS.findIndex((m) => m.id === "020_horaires"));

test("020 : base en service, chaque praticienne pratique chaque prestation ; rien d'autre ne change", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, avant020);
  db.exec("INSERT INTO staff (name) VALUES ('Awa'), ('Grâce')");
  db.exec("INSERT INTO services (name) VALUES ('Visage'), ('Ongles'), ('Coiffure')");
  runMigrations(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM staff_services").get() as { n: number }).n, 6);
  const membre = db.prepare("SELECT horaires, en_ligne FROM staff WHERE name = 'Awa'").get() as { horaires: string | null; en_ligne: number };
  assert.deepEqual({ ...membre }, { horaires: null, en_ligne: 0 });
  assert.equal((db.prepare("SELECT en_ligne FROM services WHERE name = 'Visage'").get() as { en_ligne: number }).en_ligne, 0);
});

test("020 : nouveau membre et nouvelle prestation liés par défaut ; suppression en cascade", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  db.exec("INSERT INTO services (name) VALUES ('Visage'), ('Ongles')");
  db.exec("INSERT INTO staff (name) VALUES ('Awa')");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM staff_services").get() as { n: number }).n, 2, "le membre pratique les deux prestations");
  db.exec("INSERT INTO services (name) VALUES ('Coiffure')");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM staff_services").get() as { n: number }).n, 3, "la nouvelle prestation est pratiquée par Awa");
  db.exec("DELETE FROM services WHERE name = 'Coiffure'");
  db.exec("DELETE FROM staff WHERE name = 'Awa'");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM staff_services").get() as { n: number }).n, 0);
});
