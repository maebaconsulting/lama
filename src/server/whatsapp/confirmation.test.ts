import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { setupApp, type TestApp } from "../test-support.ts";
import { runReminders } from "./rappels.ts";

/** Confirmation à la création et au déplacement d'un rendez-vous, dans la même transaction (sous-projet 7 § 3). */

type Row = { dedupe_key: string; payload: string; next_attempt_at: number; created_at: number };
const rows = (ctx: TestApp) => ctx.db.prepare("SELECT dedupe_key, payload, next_attempt_at, created_at FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as Row[];

async function scene(t: Parameters<typeof setupApp>[0], client: Record<string, unknown> = {}) {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  await g("PUT", "/api/settings/institut.nom", { value: "Institut Ébène" });
  await g("PUT", "/api/settings/institut.telephone", { value: "699 00 00 00" });
  const clientId = (await g("POST", "/api/clients", { name: "Aïcha Mbarga", phone: "699 12 34 56", ...client })).body.client.id;
  const service = (await g("POST", "/api/services", { name: "Tresses", name_en: "Braids", duration: 60, price: 10000 })).body.service.id;
  const book = async (date: string, time: string) =>
    (await g("POST", "/api/appointments", { client_id: clientId, scheduled_date: date, start_time: time, service_ids: [service] })).body.appointment?.id as number;
  return { ctx, g, clientId, book };
}

test("création d'un rendez-vous futur : confirmation en file, texte dans la langue de l'institut, numéro normalisé", async (t) => {
  const { ctx, book } = await scene(t);
  const id = await book("2026-10-05", "10:00");
  const [row] = rows(ctx);
  assert.equal(row.dedupe_key, `wa:confirmation:${id}:2026-10-05 10:00:${ctx.clock.now}`);
  const payload = JSON.parse(row.payload);
  assert.equal(payload.to, "237699123456");
  assert.equal(payload.lang, "fr");
  assert.equal(payload.text, "Bonjour Aïcha, votre rendez-vous Tresses est confirmé le lundi 5 octobre à 10:00 chez Institut Ébène. Pour tout changement, appelez le 699 00 00 00.");
  assert.deepEqual(payload.origin, { type: "confirmation", appointmentId: id, clientId: payload.origin.clientId, at: Date.parse("2026-10-05T09:00:00Z") });
  assert.equal(row.next_attempt_at, ctx.clock.now);
});

test("langue de la cliente, sinon celle de l'institut", async (t) => {
  const { ctx, g, book } = await scene(t, { language: "en" });
  await book("2026-10-05", "10:00");
  assert.match(JSON.parse(rows(ctx)[0].payload).text, /^Hello Aïcha, your Braids appointment is confirmed for Monday 5 October at 10:00/);
  const other = (await g("POST", "/api/clients", { name: "Brenda", phone: "677000000" })).body.client.id;
  await g("PUT", "/api/settings/institut.langue", { value: "en" });
  await g("POST", "/api/appointments", { client_id: other, scheduled_date: "2026-10-06", start_time: "09:00" });
  assert.equal(JSON.parse(rows(ctx)[1].payload).lang, "en");
});

test("pas de confirmation : cliente décochée, sans numéro, rendez-vous passé", async (t) => {
  const { ctx, g, book } = await scene(t, { channel: "none" });
  await book("2026-10-05", "10:00");
  const sansNumero = (await g("POST", "/api/clients", { name: "Brenda" })).body.client.id;
  await g("POST", "/api/appointments", { client_id: sansNumero, scheduled_date: "2026-10-05", start_time: "11:00" });
  const ok = (await g("POST", "/api/clients", { name: "Carine", phone: "677000000" })).body.client.id;
  await g("POST", "/api/appointments", { client_id: ok, scheduled_date: "2026-09-27", start_time: "11:00" });
  assert.equal(rows(ctx).length, 0);
});

test("déplacement : nouvelle confirmation (nouvelle clé) ; une note ou un statut n'en crée pas", async (t) => {
  const { ctx, g, book } = await scene(t);
  const id = await book("2026-10-05", "10:00");
  await g("PUT", `/api/appointments/${id}`, { notes: "Cheveux longs" });
  await g("PUT", `/api/appointments/${id}`, { status: "confirmed" });
  assert.equal(rows(ctx).length, 1);
  await g("PUT", `/api/appointments/${id}`, { scheduled_date: "2026-10-06", start_time: "15:00" });
  assert.deepEqual(rows(ctx).map((r) => r.dedupe_key), [
    `wa:confirmation:${id}:2026-10-05 10:00:${ctx.clock.now}`,
    `wa:confirmation:${id}:2026-10-06 15:00:${ctx.clock.now}`,
  ]);
  await g("PUT", `/api/appointments/${id}`, { status: "cancelled" });
  await g("PUT", `/api/appointments/${id}`, { status: "cancelled", start_time: "16:00" });
  assert.equal(rows(ctx).length, 2, "déplacer un rendez-vous annulé ne le confirme pas");
});

test("aller-retour A → B → A : la confirmation du retour s'inscrit (clé distincte à chaque écriture)", async (t) => {
  const { ctx, g, book } = await scene(t);
  const id = await book("2026-10-05", "10:00");
  ctx.db.exec("UPDATE outbox SET status = 'sent'"); // confirmation en A, envoyée
  ctx.clock.now += 60_000;
  await g("PUT", `/api/appointments/${id}`, { start_time: "11:00" }); // déplacé en B, une minute plus tard
  ctx.db.exec("UPDATE outbox SET status = 'sent'"); // confirmation en B, envoyée
  ctx.clock.now += 60_000;
  const reply = await g("PUT", `/api/appointments/${id}`, { start_time: "10:00" }); // retour en A, une minute plus tard, même date et heure qu'au départ
  assert.equal(reply.status, 200);
  const all = rows(ctx);
  assert.equal(all.length, 3, "la confirmation du retour en A s'inscrit, malgré la clé (rendez-vous, date, heure) déjà prise au départ");
  assert.equal(new Set(all.map((r) => r.dedupe_key)).size, 3, "trois clés distinctes : l'instant de chaque écriture les sépare");
});

test("changement de cliente : nouvelle confirmation pour la nouvelle cliente ; l'ancienne n'a plus lieu d'être", async (t) => {
  const { ctx, g, clientId, book } = await scene(t);
  const other = (await g("POST", "/api/clients", { name: "Brenda Eyenga", phone: "677000000" })).body.client.id;
  const id = await book("2026-10-05", "10:00");
  ctx.clock.now += 60_000; // le changement de cliente a lieu un peu plus tard
  const reply = await g("PUT", `/api/appointments/${id}`, { client_id: other });
  assert.equal(reply.status, 200);
  const all = rows(ctx);
  assert.equal(all.length, 2, "une confirmation pour l'ancienne cliente à l'origine, une nouvelle pour la nouvelle");
  const payloads = all.map((r) => JSON.parse(r.payload));
  assert.equal(payloads[0].origin.clientId, clientId);
  assert.equal(payloads[1].origin.clientId, other);
  assert.equal(payloads[1].to, "237677000000");
});

test("date déjà en base mal formée (donnée ancienne, hors API) : la préparation du message échoue, le rendez-vous est quand même mis à jour", async (t) => {
  const { ctx, g, book } = await scene(t);
  const id = await book("2026-10-05", "10:00");
  ctx.db.exec(`UPDATE appointments SET scheduled_date = '05/10/2026' WHERE id = ${id}`);
  const before = rows(ctx).length;
  const reply = await g("PUT", `/api/appointments/${id}`, { start_time: "11:00" });
  assert.equal(reply.status, 200);
  assert.equal((ctx.db.prepare("SELECT start_time FROM appointments WHERE id = ?").get(id) as { start_time: string }).start_time, "11:00");
  assert.equal(rows(ctx).length, before, "rien de plus inscrit, mais l'écriture du rendez-vous n'est pas bloquée");
});

test("fenêtre de silence : prise à 22:30, la confirmation part à 08:00 ; rendez-vous avant 08:00, aucune", async (t) => {
  const { ctx, book } = await scene(t);
  ctx.clock.now = Date.parse("2026-10-01T21:30:00Z");
  await book("2026-10-03", "10:00");
  await book("2026-10-02", "07:30");
  const [row, ...rest] = rows(ctx);
  assert.equal(row.next_attempt_at, Date.parse("2026-10-02T07:00:00Z"));
  assert.equal(row.created_at, ctx.clock.now);
  assert.equal(rest.length, 0);
});

test("même transaction : si la confirmation ne peut pas être inscrite, le rendez-vous n'est pas créé", async (t) => {
  const { ctx, book } = await scene(t);
  ctx.db.exec("CREATE TRIGGER panne BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'file indisponible'); END");
  const before = (ctx.db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n;
  assert.equal(await book("2026-10-05", "10:00"), undefined);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n, before);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM appointment_services").get() as { n: number }).n, 0);
});

test("rendez-vous restauré (annulé puis réservé de nouveau) : nouvelle confirmation, pris de nouveau à cet instant, rappel ignoré rendu possible (vague 2)", async (t) => {
  const { ctx, g, book } = await scene(t);
  const id = await book("2026-10-05", "10:00");
  await g("PUT", `/api/appointments/${id}`, { status: "cancelled" });
  // Rappel déjà passé par la file pendant l'annulation : marqué « ignoré », jamais envoyé.
  ctx.db.prepare("INSERT INTO outbox (kind, payload, dedupe_key, status, manual, next_attempt_at, created_at) VALUES ('whatsapp', '{}', ?, 'sent', 'ignored', 0, 0)").run(`wa:rappel:${id}:2026-10-05 10:00`);
  // Rappel d'un autre rendez-vous, ignoré lui aussi : il ne doit pas être touché.
  ctx.db.prepare("INSERT INTO outbox (kind, payload, dedupe_key, status, manual, next_attempt_at, created_at) VALUES ('whatsapp', '{}', 'wa:rappel:999:2026-10-05 10:00', 'sent', 'ignored', 0, 0)").run();
  ctx.clock.now += 60_000;
  assert.equal((await g("PUT", `/api/appointments/${id}`, { status: "booked" })).status, 200);
  const keys = rows(ctx).map((r) => r.dedupe_key);
  assert.ok(keys.includes(`wa:confirmation:${id}:2026-10-05 10:00:${ctx.clock.now}`), "confirmation de la restauration");
  assert.ok(!keys.includes(`wa:rappel:${id}:2026-10-05 10:00`), "le rappel ignoré libère sa clé");
  assert.ok(keys.includes("wa:rappel:999:2026-10-05 10:00"));
  assert.equal((ctx.db.prepare("SELECT booked_at FROM appointments WHERE id = ?").get(id) as { booked_at: number }).booked_at, ctx.clock.now);
  initDB(ctx.env); // la tâche des rappels lit la base hors d'une requête
  assert.equal(await runReminders(ctx.env.STORAGE, Date.parse("2026-10-04T09:00:00Z")), 1, "le rappel peut de nouveau être mis en file");
});

test("rendez-vous restauré : rien pour une cliente décochée, ni pour un rendez-vous passé ; un rappel réellement envoyé n'est pas refait", async (t) => {
  const { ctx, g, clientId, book } = await scene(t);
  const id = await book("2026-10-05", "10:00");
  const past = await book("2026-09-29", "10:00");
  ctx.db.exec("DELETE FROM outbox");
  ctx.db.prepare("INSERT INTO outbox (kind, payload, dedupe_key, status, next_attempt_at, created_at) VALUES ('whatsapp', '{}', ?, 'sent', 0, 0)").run(`wa:rappel:${id}:2026-10-05 10:00`);
  await g("PUT", `/api/appointments/${id}`, { status: "cancelled" });
  await g("PUT", `/api/appointments/${past}`, { status: "cancelled" });
  ctx.clock.now = Date.parse("2026-09-30T08:00:00Z");
  await g("PUT", `/api/appointments/${past}`, { status: "booked" });
  assert.deepEqual(rows(ctx).map((r) => r.dedupe_key), [`wa:rappel:${id}:2026-10-05 10:00`], "rendez-vous passé : aucune confirmation");
  await g("PUT", `/api/clients/${clientId}`, { channel: "none" });
  await g("PUT", `/api/appointments/${id}`, { status: "confirmed" });
  assert.deepEqual(rows(ctx).map((r) => r.dedupe_key), [`wa:rappel:${id}:2026-10-05 10:00`], "cliente décochée : rien, et le rappel envoyé reste");
});
