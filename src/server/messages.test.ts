import assert from "node:assert/strict";
import { test } from "node:test";
import { englishFaults, frenchFaults, placeholders, titleCaseFaults } from "../client/i18n/typography.ts";
import { coded, decode, DICTIONARY, langFromEnv, langOf, message, MessageError, type MessageKey } from "./messages.ts";
import { setupApp } from "./test-support.ts";

const keys = Object.keys(DICTIONARY) as MessageKey[];

test("dictionnaire du serveur : chaque message dans les deux langues, mêmes variables, typographie (spec § 11)", () => {
  const faults: string[] = [];
  for (const key of keys) {
    const { fr, en } = DICTIONARY[key];
    if (!fr.trim() || !en.trim()) faults.push(`${key} : vide`);
    if (placeholders(fr).join() !== placeholders(en).join()) faults.push(`${key} : variables`);
    faults.push(...frenchFaults(fr).map((f) => `fr.${key} : ${f}`));
    faults.push(...englishFaults(en).map((f) => `en.${key} : ${f}`));
    faults.push(...titleCaseFaults(fr).map((w) => `fr.${key} : ${w}`), ...titleCaseFaults(en).map((w) => `en.${key} : ${w}`));
  }
  assert.deepEqual(faults, []);
});

test("Accept-Language : la première langue décide, l'anglais pour tout le reste (Review Focus 2)", () => {
  for (const value of ["fr", "FR", "fr-CM", "fr-CM,fr;q=0.9,en;q=0.8", "fr;q=0.8", " fr-FR , en"]) assert.equal(langOf(value), "fr", value);
  for (const value of ["en", "en-US,en;q=0.9,fr;q=0.8", "*", "de", "", undefined, null, "francais"]) assert.equal(langOf(value), "en", String(value));
});

test("ligne de commande : LAMA_LANGUE force fr ou en, sinon LANG (anglais s'il commence par en)", () => {
  assert.equal(langFromEnv({}), "fr");
  assert.equal(langFromEnv({ LANG: "C.UTF-8" }), "fr");
  assert.equal(langFromEnv({ LANG: "en_GB.UTF-8" }), "en");
  assert.equal(langFromEnv({ LANG: "fr_FR.UTF-8", LAMA_LANGUE: "en" }), "en");
  assert.equal(langFromEnv({ LANG: "en_US.UTF-8", LAMA_LANGUE: "fr" }), "fr");
  assert.equal(langFromEnv({ LANG: "en_US.UTF-8", LAMA_LANGUE: "de" }), "en", "LAMA_LANGUE inconnue : ignorée");
});

test("messages codés : traduits à la sortie, valeurs codées comprises, texte libre intact", () => {
  assert.equal(message("fr", "connexion.bloque", { heure: "09:30" }), "Compte bloqué jusqu'à 09:30.");
  const inner = coded("reglage.drive_format");
  const outer = coded("sauvegarde.drive_invalide", { detail: inner });
  assert.equal(decode("en", outer), "Invalid Google Drive destination: Expected format: remote:folder.");
  assert.equal(decode("fr", outer), "Destination Google Drive invalide\u00a0: Format attendu\u00a0: remote:dossier.");
  assert.equal(decode("fr", "Numéro invalide"), "Numéro invalide");
  assert.equal(decode("fr", "@cle.inconnue"), "@cle.inconnue");
  assert.equal(decode("fr", "@connexion.bloque {pas du json"), "@connexion.bloque {pas du json");
  const error = new MessageError("compte.introuvable");
  assert.equal(error.key, "compte.introuvable");
  assert.equal(decode("en", error.message), "Account not found.");
});

test("decode ignore les propriétés héritées du dictionnaire (aucune exception)", () => {
  assert.equal(decode("en", "@constructor"), "@constructor");
  assert.equal(decode("en", "@__proto__"), "@__proto__");
  const outer = coded("sauvegarde.drive_invalide", { detail: "@toString" });
  assert.equal(decode("en", outer), "Invalid Google Drive destination: @toString");
});

test("sans Accept-Language, l'API répond en anglais ; avec fr, en français", async (t) => {
  const ctx = await setupApp(t);
  await ctx.seedAccount("manager", "aicha");
  assert.equal((await ctx.raw("GET", "/api/stats")).body.error, "Sign-in required.");
  assert.equal((await ctx.raw("GET", "/api/stats", undefined, { "Accept-Language": "fr-CM,fr;q=0.9" })).body.error, "Connexion requise.");
  const anon = ctx.anonymous();
  assert.equal((await anon("POST", "/api/auth/login", { login: "aicha", password: "pas-le-bon-1" })).body.error, "Incorrect username or password.");
  assert.equal((await anon("POST", "/api/auth/login", { login: "aicha", password: "pas-le-bon-1" }, { "Accept-Language": "fr" })).body.error, "Identifiant ou mot de passe incorrect.");
});

test("refus des comptes et des réglages traduits, codes inchangés", async (t) => {
  const ctx = await setupApp(t);
  const gerante = await ctx.as("manager");
  const refus = await gerante("POST", "/api/accounts", { display_name: "X", login: "xx", role: "reception", password: "assez-long-1" });
  assert.equal(refus.body.code, "confirmation");
  assert.equal(refus.body.error, "Password confirmation required.");
  await gerante("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  const court = await gerante("POST", "/api/accounts", { display_name: "X", login: "xavier", role: "reception", password: "court" }, { "Accept-Language": "fr" });
  assert.equal(court.body.error, "Le mot de passe doit comporter au moins 10 caractères.");
  const long = await gerante("PUT", "/api/settings/institut.nom", { value: "x".repeat(81) }, { "Accept-Language": "en" });
  assert.equal(long.body.error, "Text of at most 80 characters expected.");
});

test("la ligne de commande parle la langue de LANG ou de LAMA_LANGUE (spec § 6)", async () => {
  const { readFileSync } = await import("node:fs");
  const cli = readFileSync(new URL("./cli.ts", import.meta.url), "utf8");
  assert.match(cli, /const lang = langFromEnv\(process\.env\);/);
  assert.doesNotMatch(cli, /console\.(log|error)\("[^"]*[A-Za-zé]/, "aucun texte en dur dans la ligne de commande");
});

test("passe V 1.0 (vague D) : textes anglais du ticket et du serveur, apostrophe droite", () => {
  assert.equal(DICTIONARY["ticket.caisse"].en, "Charged by {nom}");
  assert.equal(DICTIONARY["ticket.test"].en, "Test receipt");
  assert.equal(DICTIONARY["conflit.autre_rdv"].en, "another appointment");
  assert.equal(DICTIONARY["ticket.total_avoir"].fr, "Total de l'avoir");
  assert.deepEqual(keys.filter((k) => /booking/i.test(DICTIONARY[k].en)), []);
  assert.deepEqual(keys.filter((k) => DICTIONARY[k].fr.includes("\u2019")), []);
});
