import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { openDatabase, sqliteStorage } from "../storage.ts";
import { runMigrations } from "../migrations.ts";
import { AccountError, authenticatePassword, authenticatePin, countAccounts, createAccount, unlockAccount, updateAccount } from "./accounts.ts";
import { confirmSession, createSession, deleteSessionsOf, isConfirmed, resolveSession, PERSONAL_TTL_MS } from "./sessions.ts";

function freshDb() {
  const db = openDatabase(":memory:");
  runMigrations(db);
  db.exec("INSERT INTO staff (id, name, email, title, color) VALUES (1, 'Mireille', '', '', '#4A5D73')");
  initDB({ STORAGE: sqliteStorage(db) });
  return db;
}

const NOW = Date.parse("2026-09-28T08:00:00Z");

test("création : identifiant unique, mot de passe et PIN valides, praticienne reliée", async () => {
  freshDb();
  assert.equal(await countAccounts(), 0);
  const admin = await createAccount({ display_name: "Dan", login: "dan", role: "admin", password: "assez-long-1", pin: null }, NOW);
  assert.equal(admin.role, "admin");
  assert.equal(admin.has_pin, false);
  await assert.rejects(createAccount({ display_name: "X", login: "DAN", role: "manager", password: "assez-long-1" }, NOW), /@compte\.identifiant_pris/);
  await assert.rejects(createAccount({ display_name: "X", login: "xavier", role: "manager", password: "court" }, NOW), /@compte\.mot_de_passe_court/);
  await assert.rejects(createAccount({ display_name: "X", login: "xena", role: "reception", password: "assez-long-1", pin: "1234" }, NOW), /@compte\.pin_simple/);
  await assert.rejects(createAccount({ display_name: "X", login: "xenia", role: "practitioner", password: "assez-long-1" }, NOW), (e: AccountError) => e.status === 400 && e.key === "compte.praticienne_sans_fiche");
  await assert.rejects(createAccount({ display_name: "X", login: "xy", role: "manager", password: "assez-long-1" }, NOW), /@compte\.identifiant_invalide/);
  const praticienne = await createAccount({ display_name: "Mireille", login: "mireille", role: "practitioner", password: "assez-long-1", pin: "2580", staff_id: 1 }, NOW);
  assert.equal(praticienne.staff_id, 1);
  assert.equal(praticienne.has_pin, true);
});

test("authentification : succès, échec, blocage au cinquième essai, déblocage", async () => {
  freshDb();
  const a = await createAccount({ display_name: "Grace", login: "grace", role: "reception", password: "assez-long-1", pin: "2580" }, NOW);
  assert.deepEqual((await authenticatePassword("GRACE", "assez-long-1", NOW)).ok, true);
  for (let i = 0; i < 4; i++) assert.deepEqual(await authenticatePassword("grace", "faux-mot-de-passe", NOW), { ok: false, reason: "invalid" });
  const fifth = await authenticatePassword("grace", "faux-mot-de-passe", NOW);
  assert.equal(fifth.ok, false);
  assert.equal(fifth.ok === false && fifth.reason, "locked");
  assert.equal((await authenticatePassword("grace", "assez-long-1", NOW + 1000)).ok, false, "bloqué même avec le bon mot de passe");
  assert.equal((await authenticatePin(a.id, "2580", NOW + 1000)).ok, false, "le PIN est bloqué aussi");
  assert.equal((await authenticatePassword("grace", "assez-long-1", NOW + 5 * 60_000 + 1)).ok, true, "débloqué après 5 minutes");
  for (let i = 0; i < 5; i++) await authenticatePin(a.id, "0000", NOW);
  await unlockAccount(a.id);
  assert.equal((await authenticatePin(a.id, "2580", NOW)).ok, true);
});

test("identifiant inconnu et compte désactivé", async () => {
  freshDb();
  const a = await createAccount({ display_name: "Boris", login: "boris", role: "reception", password: "assez-long-1" }, NOW);
  assert.deepEqual(await authenticatePassword("inconnu", "assez-long-1", NOW), { ok: false, reason: "invalid" });
  await updateAccount(a.id, { active: 0 });
  assert.deepEqual(await authenticatePassword("boris", "assez-long-1", NOW), { ok: false, reason: "inactive" });
});

test("sessions : jeton non stocké, glissement, expiration, confirmation, révocation", async () => {
  const db = freshDb();
  const a = await createAccount({ display_name: "Dan", login: "dan", role: "admin", password: "assez-long-1" }, NOW);
  const { token, session } = await createSession(a.id, "personnel", null, NOW);
  const stored = db.prepare("SELECT token_hash FROM sessions WHERE id = ?").get(session.id) as { token_hash: string };
  assert.notEqual(stored.token_hash, token);
  const later = NOW + PERSONAL_TTL_MS - 1000;
  const resolved = await resolveSession(token, later);
  assert.ok(resolved && "session" in resolved && resolved.account.login === "dan");
  assert.ok(await resolveSession(token, later + PERSONAL_TTL_MS - 1000), "prolongée par l'usage");
  assert.equal(await resolveSession(token, later + 2 * PERSONAL_TTL_MS), null, "expirée");
  const second = await createSession(a.id, "personnel", null, NOW);
  assert.equal(isConfirmed(second.session, NOW), false);
  const until = await confirmSession(second.session.id, NOW);
  assert.equal(until, NOW + 5 * 60_000);
  const reread = await resolveSession(second.token, NOW + 1000);
  assert.ok(reread && "session" in reread && isConfirmed(reread.session, NOW + 1000));
  await deleteSessionsOf(a.id);
  assert.equal(await resolveSession(second.token, NOW + 2000), null);
});

test("une session de poste se verrouille après le délai d'inactivité", async () => {
  const db = freshDb();
  const a = await createAccount({ display_name: "Grace", login: "grace", role: "reception", password: "assez-long-1", pin: "2580" }, NOW);
  db.exec("INSERT INTO devices (token_hash, name, created_at) VALUES ('x', 'Réception', 0)");
  const { token } = await createSession(a.id, "poste", 1, NOW);
  assert.ok(await resolveSession(token, NOW + 4 * 60_000));
  assert.deepEqual(await resolveSession(token, NOW + 4 * 60_000 + 5 * 60_000 + 1), { locked: true });
});
