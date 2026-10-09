import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/** Accord et langue de la cliente (sous-projet 7 § 2) ; heure de prise du rendez-vous (§ 3, rappels). */

test("fiche cliente : canal « whatsapp » par défaut, « sms » ou « none » au choix de la réception ; langue fr, en ou vide", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const reception = await ctx.as("reception");
  const created = (await reception("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699 00 00 01" })).body.client;
  assert.equal(created.channel, "whatsapp");
  assert.equal(created.language, "");
  assert.equal((await reception("PUT", `/api/clients/${created.id}`, { channel: "sms", language: "en" })).status, 200);
  const fiche = (await reception("GET", `/api/clients/${created.id}`)).body.client;
  assert.deepEqual({ channel: fiche.channel, language: fiche.language }, { channel: "sms", language: "en" });
  assert.equal((await reception("PUT", `/api/clients/${created.id}`, { language: "de" })).status, 400);
  assert.equal((await reception("PUT", `/api/clients/${created.id}`, { channel: "fax" })).status, 400);
  const other = (await reception("POST", "/api/clients", { name: "Brenda", channel: "none", language: "fr" })).body.client;
  assert.deepEqual({ channel: other.channel, language: other.language }, { channel: "none", language: "fr" });
});

test("la praticienne ne change pas le canal (seule la note lui est permise)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const manager = await ctx.as("manager");
  const id = (await manager("POST", "/api/clients", { name: "Aïcha" })).body.client.id;
  await (await ctx.as("practitioner"))("PUT", `/api/clients/${id}`, { channel: "none", notes: "Allergie" });
  const fiche = (await manager("GET", `/api/clients/${id}`)).body.client;
  assert.deepEqual({ channel: fiche.channel, notes: fiche.notes }, { channel: "whatsapp", notes: "Allergie" });
});

test("heure de prise du rendez-vous : posée à la création, remise à jour au déplacement seulement", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const client = (await g("POST", "/api/clients", { name: "Aïcha" })).body.client.id;
  const id = (await g("POST", "/api/appointments", { client_id: client, scheduled_date: "2026-10-05", start_time: "10:00" })).body.appointment.id;
  const bookedAt = () => (ctx.db.prepare("SELECT booked_at FROM appointments WHERE id = ?").get(id) as { booked_at: number }).booked_at;
  assert.equal(bookedAt(), ctx.clock.now);
  const first = ctx.clock.now;
  ctx.clock.now += 3600e3;
  await g("PUT", `/api/appointments/${id}`, { notes: "Cheveux longs" });
  assert.equal(bookedAt(), first, "une note ne déplace pas le rendez-vous");
  await g("PUT", `/api/appointments/${id}`, { start_time: "11:00" });
  assert.equal(bookedAt(), ctx.clock.now);
});
