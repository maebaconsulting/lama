import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { auditTarget } from "./libelles.ts";
import { accountCommands } from "./reglages.ts";
import { forbiddenSection, settingsPanelAllowed } from "./roles.ts";
import { pathFor } from "./routes.ts";

/** Règles des Réglages de la vague 5 (sous-projet 4 § 7.1 et § 7.3), testées en exécution. */

const NOW = Date.parse("2026-09-30T10:00:00Z");
const compte = (id: number, role: "admin" | "manager" | "reception" | "practitioner", locked_until: number | null = null) => ({ id, role, locked_until });

test("adresse d'une rubrique interdite ou inconnue : à corriger ; rubrique permise ou absente : gardée", () => {
  assert.equal(forbiddenSection("reception", "comptes"), true, "la réception n'a pas les comptes");
  assert.equal(forbiddenSection("practitioner", "journal"), true);
  assert.equal(forbiddenSection("manager", "sauvegardes"), true, "sauvegardes : administrateur seulement");
  assert.equal(forbiddenSection("admin", "institut"), true, "institut : gérante seulement");
  assert.equal(forbiddenSection("manager", "n-importe-quoi"), true, "rubrique inconnue");
  assert.equal(forbiddenSection("reception", "mon-compte"), false);
  assert.equal(forbiddenSection("admin", "sauvegardes"), false);
  assert.equal(forbiddenSection("practitioner", null), false, "/reglages seul : la liste des rubriques");
});

test("fiches des Réglages dans le panneau : compte et poste pour la gérante et l'administrateur seulement", () => {
  for (const role of ["manager", "admin"] as const) {
    assert.equal(settingsPanelAllowed(role, "account"), true, role);
    assert.equal(settingsPanelAllowed(role, "device"), true, role);
  }
  for (const role of ["reception", "practitioner"] as const) {
    assert.equal(settingsPanelAllowed(role, "account"), false, role);
    assert.equal(settingsPanelAllowed(role, "device"), false, role);
  }
  assert.equal(settingsPanelAllowed("admin", "client"), false, "aucune fiche d'activité pour l'administrateur");
});

test("commandes d'un compte : mêmes règles que le serveur, déblocage seulement s'il est bloqué", () => {
  const admin = compte(1, "admin");
  const gerante = compte(2, "manager");
  assert.deepEqual(accountCommands(admin, compte(3, "manager"), NOW), { edit: true, unlock: false });
  assert.deepEqual(accountCommands(admin, compte(4, "admin", NOW + 60_000), NOW), { edit: true, unlock: true });
  assert.deepEqual(accountCommands(gerante, compte(5, "reception", NOW + 60_000), NOW), { edit: true, unlock: true });
  assert.deepEqual(accountCommands(gerante, compte(5, "reception", NOW - 60_000), NOW), { edit: true, unlock: false }, "blocage échu");
  assert.deepEqual(accountCommands(gerante, gerante, NOW), { edit: true, unlock: false }, "la gérante gère son propre compte");
  assert.deepEqual(accountCommands(gerante, compte(6, "manager", NOW + 60_000), NOW), { edit: false, unlock: false }, "une autre gérante");
  assert.deepEqual(accountCommands(gerante, admin, NOW), { edit: false, unlock: false });
  assert.deepEqual(accountCommands(compte(7, "reception"), compte(8, "practitioner"), NOW), { edit: false, unlock: false });
});

test("journal : chaque réglage du serveur a un libellé traduit, plus de clé brute comme postes.verrouillage_minutes", () => {
  assert.equal(auditTarget("postes.verrouillage_minutes", "fr"), "Délai de verrouillage des postes");
  assert.equal(auditTarget("postes.verrouillage_minutes", "en"), "Shared device lock delay");
  assert.equal(auditTarget("institut.nom", "fr"), "Nom de l'institut");
  const source = readFileSync(new URL("../../server/settings.ts", import.meta.url), "utf8");
  const keys = [...source.matchAll(/^\s+"([a-z_]+\.[a-z_]+)": \{/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 8, `réglages lus : ${keys.join(", ")}`);
  for (const key of keys) {
    for (const lang of ["fr", "en"] as const) assert.notEqual(auditTarget(key, lang), key, `${key} (${lang})`);
  }
  assert.equal(auditTarget("grace", "fr"), "grace", "un identifiant reste une donnée");
});

test("pathFor : une clé héritée d'Object (constructor, toString) n'est pas prise pour une rubrique", () => {
  assert.equal(pathFor("reglages", "fr", "constructor"), "/reglages/constructor");
  assert.equal(pathFor("reglages", "en", "toString"), "/settings/toString");
  assert.equal(pathFor("reglages", "en", "comptes"), "/settings/accounts");
});

test("journal : les textes WhatsApp (clés à quatre segments) ont aussi leur libellé", () => {
  assert.equal(auditTarget("whatsapp.texte.rappel.fr", "fr"), "Texte de rappel en français");
  assert.equal(auditTarget("whatsapp.texte.confirmation.en", "en"), "Confirmation text in English");
});
