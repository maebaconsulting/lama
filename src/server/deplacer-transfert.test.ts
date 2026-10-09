import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type TestApp } from "./test-support.ts";

/** « Déplacer » et changement de praticienne (spec du 04/10/2026, décisions 5, 10 et 12). Horloge : lundi 28/09, 09:00 à Douala. */

async function scene(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  ctx.db.exec(`INSERT INTO staff (id, name, color) VALUES (1, 'Solange Ekambi', '#4A5D73'), (2, 'Grace Nkeng', '#4F6552'), (3, 'Mireille Fotso', '#6B4660');
    INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Tresses', 'Braids', 60, 10000);
    INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', '"Institut Ébène"', 0, 0);
    INSERT INTO appointments (id, identifier, client_id, staff_id, scheduled_date, start_time, end_time) VALUES (1, 'APT-12', 1, 1, '2026-09-29', '10:00', '11:00');
    INSERT INTO appointment_services (appointment_id, service_id, price, duration) VALUES (1, 1, 10000, 60);`);
  const reception = await ctx.as("reception");
  ctx.db.exec("UPDATE accounts SET display_name = 'Mireille' WHERE login = 'reception'");
  return { ctx, reception };
}

const keys = (ctx: TestApp) => (ctx.db.prepare("SELECT dedupe_key FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { dedupe_key: string }[]).map((r) => r.dedupe_key);
const texts = (ctx: TestApp) => (ctx.db.prepare("SELECT payload FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { payload: string }[]).map((r) => JSON.parse(r.payload).text as string);
const notes = (ctx: TestApp) => (ctx.db.prepare("SELECT content FROM appointment_notes WHERE appointment_id = 1 ORDER BY id").all() as { content: string }[]).map((n) => n.content);
const audit = (ctx: TestApp) => (ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'rdv.transfert' ORDER BY id").all() as { target: string }[]).map((r) => r.target);

test("Déplacer vers une autre praticienne, case cochée : message « transfert » à la place de la confirmation, note et journal", async (t) => {
  const { ctx, reception } = await scene(t);
  const r = await reception("PUT", "/api/appointments/1", { staff_id: 2, notify_transfer: true });
  assert.equal(r.status, 200);
  assert.deepEqual(keys(ctx), [`wa:transfert:1:2:2026-09-29 10:00:${ctx.clock.now}`]);
  assert.deepEqual(texts(ctx), ["Bonjour Aïcha, votre rendez-vous Tresses du mardi 29 septembre à 10:00 chez Institut Ébène sera assuré par Grace."]);
  assert.deepEqual(notes(ctx), ["Transféré de Solange Ekambi à Grace Nkeng le 28/09/2026 par Mireille."]);
  assert.deepEqual(audit(ctx), ["APT-12\u00a0: Solange Ekambi → Grace Nkeng"]);
});

test("case décochée, seule la praticienne change : aucun message ; note et journal quand même", async (t) => {
  const { ctx, reception } = await scene(t);
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, notify_transfer: false })).status, 200);
  assert.deepEqual(keys(ctx), []);
  assert.equal(notes(ctx).length, 1);
  assert.equal(audit(ctx).length, 1);
});

test("heure et praticienne changent, case cochée : un seul message, le transfert, à la nouvelle heure", async (t) => {
  const { ctx, reception } = await scene(t);
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, start_time: "15:00", notify_transfer: true })).status, 200);
  assert.deepEqual(keys(ctx), [`wa:transfert:1:2:2026-09-29 15:00:${ctx.clock.now}`]);
  assert.match(texts(ctx)[0], /du mardi 29 septembre à 15:00 chez Institut Ébène sera assuré par Grace\.$/);
});

test("heure et praticienne changent, case décochée : la confirmation habituelle", async (t) => {
  const { ctx, reception } = await scene(t);
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, start_time: "15:00", notify_transfer: false })).status, 200);
  assert.deepEqual(keys(ctx), [`wa:confirmation:1:2026-09-29 15:00:${ctx.clock.now}`]);
  assert.equal(audit(ctx).length, 1);
});

test("Déplacer vers une praticienne et retour : deux messages à clés distinctes, le premier sans objet ; deux notes, deux lignes au journal", async (t) => {
  const { ctx, reception } = await scene(t);
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, notify_transfer: true })).status, 200);
  const first = ctx.clock.now;
  ctx.clock.now += 60_000;
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 1, notify_transfer: true })).status, 200);
  assert.deepEqual(keys(ctx), [`wa:transfert:1:2:2026-09-29 10:00:${first}`, `wa:transfert:1:1:2026-09-29 10:00:${ctx.clock.now}`]);
  ctx.db.exec("UPDATE outbox SET status = 'failed', last_error = '@whatsapp.sans_fournisseur'");
  const items = (await reception("GET", "/api/whatsapp/manual")).body.items as { text: string }[];
  assert.deepEqual(items.map((i) => i.text), ["Bonjour Aïcha, votre rendez-vous Tresses du mardi 29 septembre à 10:00 chez Institut Ébène sera assuré par Solange."]);
  assert.deepEqual(notes(ctx), [
    "Transféré de Solange Ekambi à Grace Nkeng le 28/09/2026 par Mireille.",
    "Transféré de Grace Nkeng à Solange Ekambi le 28/09/2026 par Mireille.",
  ]);
  assert.deepEqual(audit(ctx), ["APT-12\u00a0: Solange Ekambi → Grace Nkeng", "APT-12\u00a0: Grace Nkeng → Solange Ekambi"]);
});

test("« Non attribué » : ni note, ni journal, ni message (hors champ) ; d'un rendez-vous non attribué vers une praticienne, le message seulement", async (t) => {
  const { ctx, reception } = await scene(t);
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: null, notify_transfer: true })).status, 200);
  assert.deepEqual([keys(ctx), notes(ctx), audit(ctx)], [[], [], []]);
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 3, notify_transfer: true })).status, 200);
  assert.deepEqual(keys(ctx), [`wa:transfert:1:3:2026-09-29 10:00:${ctx.clock.now}`]);
  assert.deepEqual([notes(ctx), audit(ctx)], [[], []]);
});

test("rendez-vous annulé changé de praticienne : aucun message, même case cochée", async (t) => {
  const { ctx, reception } = await scene(t);
  ctx.db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 1");
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, notify_transfer: true })).status, 200);
  assert.deepEqual(keys(ctx), []);
});

/** Ressources signalées sur le flux temps réel pendant que `act` s'exécute (l'appli de test est un paquet à part : on passe par le flux, pas par `subscribe`). */
async function changesDuring(ctx: TestApp, act: () => Promise<unknown>, expectOutbox = false): Promise<string[]> {
  await ctx.seedAccount("practitioner");
  const login = await ctx.raw("POST", "/api/auth/login", { login: "practitioner", password: "mot-de-passe-test" }, { "X-Lama": "1" });
  const session = login.headers.getSetCookie().find((c) => c.startsWith("lama_session="))!.split(";")[0];
  const stream = await ctx.app.request("/api/events", { headers: { cookie: session } }, ctx.env);
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + (expectOutbox ? 3000 : 1000);
  const acted = new Promise<void>((r) => setTimeout(r, 50)).then(act);
  while (Date.now() < deadline && !text.includes("outbox")) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), Math.max(deadline - Date.now(), 0))),
    ]);
    if (done || !value) break;
    text += decoder.decode(value, { stream: true });
  }
  await acted;
  await reader.cancel();
  return [...text.matchAll(/"resource":"([^"]+)"/g)].map((m) => m[1]);
}

test("un message de transfert mis en file signale « outbox » (pastille « À envoyer à la main »)", async (t) => {
  const { ctx, reception } = await scene(t);
  const seen = await changesDuring(ctx, () => reception("PUT", "/api/appointments/1", { staff_id: 2, notify_transfer: true }), true);
  assert.ok(seen.includes("outbox"), `signalé : ${seen.join(", ")}`);
});

test("case décochée : « outbox » n'est pas signalé", async (t) => {
  const { ctx, reception } = await scene(t);
  const seen = await changesDuring(ctx, () => reception("PUT", "/api/appointments/1", { staff_id: 2 }));
  assert.ok(seen.includes("appointments") && !seen.includes("outbox"), `signalé : ${seen.join(", ")}`);
});

test("cliente changée en même temps que la praticienne, case cochée : la confirmation seule ; note et journal écrits", async (t) => {
  const { ctx, reception } = await scene(t);
  ctx.db.exec("INSERT INTO clients (id, name, phone) VALUES (2, 'Nadège Tchoumi', '699654321')");
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, client_id: 2, notify_transfer: true })).status, 200);
  assert.deepEqual(keys(ctx), [`wa:confirmation:1:2026-09-29 10:00:${ctx.clock.now}`]);
  assert.equal(notes(ctx).length, 1);
  assert.equal(audit(ctx).length, 1);
});

test("rendez-vous restauré en même temps que la praticienne change, case cochée : la confirmation seule", async (t) => {
  const { ctx, reception } = await scene(t);
  ctx.db.exec("UPDATE appointments SET status = 'cancelled' WHERE id = 1");
  assert.equal((await reception("PUT", "/api/appointments/1", { staff_id: 2, status: "booked", notify_transfer: true })).status, 200);
  assert.deepEqual(keys(ctx), [`wa:confirmation:1:2026-09-29 10:00:${ctx.clock.now}`]);
  assert.equal(notes(ctx).length, 1);
  assert.equal(audit(ctx).length, 1);
});
