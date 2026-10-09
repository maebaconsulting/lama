import assert from "node:assert/strict";
import { test } from "node:test";
import { describeConflicts } from "./scheduling.ts";
import { setupApp } from "./test-support.ts";

/**
 * Dettes reprises par la vague 5 (sous-projet 4 § 7.3) : libellé des conflits
 * laissé vide sans cliente ni motif (l'écran compose le texte dans sa langue),
 * et `MessageError` rendue par `app.onError` dans la langue de la requête.
 */

test("conflit sans motif : libellé vide dans la réponse, texte d'erreur composé dans la langue de la requête", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const staff = (await g("POST", "/api/staff", { name: "Solange" })).body.staff.id;
  const client = (await g("POST", "/api/clients", { name: "Aïcha Mbarga" })).body.client.id;
  const service = (await g("POST", "/api/services", { name: "Soin", duration: 60, price: 10000 })).body.service.id;
  assert.equal((await g("POST", "/api/blocked-slots", { staff_id: staff, blocked_date: "2026-10-05", start_time: "12:00", end_time: "13:00" })).status, 201);
  const fr = { "Accept-Language": "fr" };
  const refused = await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-10-05", start_time: "12:00", service_ids: [service] }, fr);
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body.conflicts.map((c: { kind: string; label: string }) => [c.kind, c.label]), [["blocked", ""]], "aucun mot figé dans une langue");
  assert.match(refused.body.error, /^Solange est indisponible à 12:00-13:00 \(bloqué\)\./, "le message d'erreur reste lisible");

  await g("POST", "/api/appointments", { client_id: client, staff_id: staff, scheduled_date: "2026-10-05", start_time: "15:00", service_ids: [service] });
  const booked = await g("POST", "/api/blocked-slots", { staff_id: staff, blocked_date: "2026-10-05", start_time: "15:00", end_time: "16:00", reason: "Formation" });
  assert.equal(booked.status, 409);
  assert.deepEqual(booked.body.conflicts.map((c: { label: string }) => c.label), ["Aïcha Mbarga"], "le nom de la cliente reste une donnée");
});

test("describeConflicts : libellé vide remplacé par « autre réservation » ou « bloqué » dans la langue demandée", () => {
  const appt = { kind: "appointment" as const, start_time: "10:00", end_time: "11:00", label: "" };
  const block = { kind: "blocked" as const, start_time: "13:00", end_time: "14:00", label: "" };
  assert.match(describeConflicts("Mireille", [appt], "book", "fr"), /à 10:00-11:00 \(autre réservation\)\./);
  assert.match(describeConflicts("Mireille", [block], "block", "en"), /at 13:00-14:00 \(blocked\)\./);
});

test("MessageError sans gestionnaire propre : réponse traduite par app.onError, plus d'erreur 500 générique", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const admin = await ctx.as("admin");
  const fr = await admin("GET", "/api/backups", undefined, { "Accept-Language": "fr" });
  assert.equal(fr.status, 500);
  assert.deepEqual(fr.body, { error: "Sauvegardes non configurées sur ce serveur." });
  const en = await admin("GET", "/api/backups");
  assert.deepEqual(en.body, { error: "Backups are not configured on this server." }, "anglais sans en-tête");
});

test("toute autre erreur du serveur : réponse JSON traduite, jamais le texte brut « Internal Server Error »", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  // Réglage illisible en base (écrit à la main, disque abîmé) : la lecture lève une erreur ordinaire.
  ctx.db.prepare("INSERT INTO settings (key, value, secret, updated_at) VALUES ('caisse.tva_active', '{illisible', 0, 0)").run();
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args[0]); };
  t.after(() => { console.error = original; });
  const fr = await g("GET", "/api/sales/settings", undefined, { "Accept-Language": "fr" });
  assert.equal(fr.status, 500);
  assert.match(fr.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(fr.body, { error: "Erreur du serveur. Réessayez\u00a0; si cela persiste, prévenez l'administrateur." });
  const en = await g("GET", "/api/sales/settings");
  assert.deepEqual(en.body, { error: "Server error. Try again; if this continues, contact the administrator." });
  assert.ok(logged.length >= 2 && logged.every((e) => e instanceof Error), "l'erreur d'origine reste dans le journal du serveur");
});
