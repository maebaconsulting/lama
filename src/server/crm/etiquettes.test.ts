import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { listTagCounts, normalizeTags, readTags, writeTags } from "./etiquettes.ts";
import { birthdayValid, readCrmFields } from "./champs.ts";

/**
 * Étiquettes et champs du mini CRM (spec du 04/10/2026, décisions 1 à 3) :
 * nettoyage, repli des accents et des majuscules, plafonds, première
 * écriture gardée, comptes par fréquence ; anniversaire et préférences.
 */

test("étiquettes : espaces resserrés, vides ignorées, doublons repliés retirés ; 30 caractères et 10 par cliente au plus", () => {
  assert.deepEqual(normalizeTags(["  VIP ", "vip", "Peau   sensible", "", "Mariée", "MARIEE"]), { tags: ["VIP", "Peau sensible", "Mariée"] });
  assert.deepEqual(normalizeTags("VIP"), { error: "cliente.etiquettes_format" });
  assert.deepEqual(normalizeTags([1]), { error: "cliente.etiquettes_format" });
  assert.deepEqual(normalizeTags(["x".repeat(31)]), { error: "cliente.etiquette_longueur" });
  assert.deepEqual(normalizeTags(["é".repeat(30)]), { tags: ["é".repeat(30)] }, "30 lettres accentuées comptent 30");
  assert.deepEqual(normalizeTags(Array.from({ length: 11 }, (_, i) => `E${i}`)), { error: "cliente.etiquettes_nombre" });
  assert.deepEqual(normalizeTags([...Array.from({ length: 10 }, (_, i) => `E${i}`), "e0"]), { tags: Array.from({ length: 10 }, (_, i) => `E${i}`) }, "un doublon ne compte pas");
});

test("étiquettes en base : première écriture gardée, ordre de saisie, comptes par fréquence puis par nom", () => {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.exec("INSERT INTO clients (id, name) VALUES (1, 'Aïcha'), (2, 'Brenda'), (3, 'Ngozi')");
  writeTags(db, 1, ["Mariée", "VIP"]);
  writeTags(db, 2, ["vip"]);
  writeTags(db, 3, ["MARIEE", "Vip", "Peau sensible"]);
  assert.deepEqual(readTags(db, 1), ["Mariée", "VIP"]);
  assert.deepEqual(readTags(db, 2), ["VIP"], "écriture de la première saisie");
  assert.deepEqual(readTags(db, 3), ["Mariée", "VIP", "Peau sensible"]);
  assert.deepEqual(listTagCounts(db), [{ tag: "VIP", count: 3 }, { tag: "Mariée", count: 2 }, { tag: "Peau sensible", count: 1 }]);
  writeTags(db, 3, []);
  assert.deepEqual(readTags(db, 3), []);
  assert.deepEqual(listTagCounts(db), [{ tag: "VIP", count: 2 }, { tag: "Mariée", count: 1 }], "« Peau sensible » disparaît avec sa dernière cliente");
  db.close();
});

test("anniversaire MM-JJ (29 février accepté), préférences de 500 caractères au plus", () => {
  for (const ok of ["01-01", "02-29", "10-14", "12-31"]) assert.ok(birthdayValid(ok), ok);
  for (const ko of ["", "1-1", "13-01", "00-10", "02-30", "04-31", "14/10"]) assert.ok(!birthdayValid(ko), ko);
  assert.deepEqual(readCrmFields({ birthday: "", preferences: "  Thé  ", tags: ["VIP"] }), { columns: { birthday: "", preferences: "Thé" }, tags: ["VIP"] });
  assert.deepEqual(readCrmFields({ name: "X" }), { columns: {} }, "rien à écrire");
  assert.deepEqual(readCrmFields({ birthday: "02-30" }), { error: "cliente.anniversaire_format" });
  assert.deepEqual(readCrmFields({ birthday: 1014 }), { error: "cliente.anniversaire_format" });
  assert.deepEqual(readCrmFields({ preferences: "x".repeat(501) }), { error: "cliente.preferences_longueur" });
  assert.deepEqual(readCrmFields({ tags: "VIP" }), { error: "cliente.etiquettes_format" });
});
