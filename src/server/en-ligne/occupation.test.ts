import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";
import { busyOn } from "../transferts.ts";
import { queueDueReminders } from "../whatsapp/rappels.ts";
import { DEFAULT_TEXTS } from "../whatsapp/textes.ts";
import { insererDemande } from "./essais-en-ligne.ts";

/** Statut « à confirmer » (spec § 4.4 et § 6) : un essai par endroit qui contrôle le chevauchement, et ce qui ignore les demandes. */
const FR = { "Accept-Language": "fr" };

async function scene(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  ctx.db.exec(`INSERT INTO staff (id, name, color) VALUES (1, 'Awa Ndiaye', '#4A5D73'), (2, 'Bella Ewane', '#4F6552');
    INSERT INTO clients (id, name, phone) VALUES (1, 'Aïcha Mbarga', '699123456');
    INSERT INTO services (id, name, name_en, duration, price) VALUES (1, 'Soin visage', 'Facial', 60, 25000);`);
  return { ctx, reception: await ctx.as("reception") };
}

test("une demande à confirmer occupe l'agenda : création, déplacement, blocage et transfert refusés", async (t) => {
  const { ctx, reception } = await scene(t);
  insererDemande(ctx.db);
  const pose = await reception("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-29", start_time: "10:30", service_ids: [1] }, FR);
  assert.equal(pose.status, 409);
  assert.deepEqual(pose.body.conflicts.map((c: { kind: string }) => c.kind), ["demande"]);
  assert.match(pose.body.error, /demande en ligne de Mireille Ngo/);
  const ailleurs = await reception("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-29", start_time: "14:00", service_ids: [1] });
  assert.equal(ailleurs.status, 201);
  assert.equal((await reception("PUT", `/api/appointments/${ailleurs.body.appointment.id}`, { start_time: "10:00" })).status, 409, "déplacement");
  assert.equal((await reception("POST", "/api/blocked-slots", { staff_id: 1, blocked_date: "2026-09-29", start_time: "10:15", end_time: "10:45" })).status, 409, "blocage");
  const chezBella = await reception("POST", "/api/appointments", { client_id: 1, staff_id: 2, scheduled_date: "2026-09-29", start_time: "10:00", service_ids: [1] });
  const transfert = await reception("POST", "/api/transfers", { from_staff_id: 2, notify: false, moves: [{ appointment_id: chezBella.body.appointment.id, staff_id: 1 }] }, FR);
  assert.equal(transfert.status, 409);
  assert.match(transfert.body.conflicts[0].reason, /n'est pas libre de 10:00 à 11:00/);
  // Au comptoir, rien n'est bloqué : la réception passe outre en connaissance de cause.
  assert.equal((await reception("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-29", start_time: "10:30", service_ids: [1], allow_conflict: true })).status, 201);
});

test("une demande en conflit, refusée, à rappeler ou d'une autre praticienne n'occupe pas la colonne", async (t) => {
  const { ctx, reception } = await scene(t);
  for (const etat of ["en_conflit", "refusee", "autre_horaire", "confirmee"]) insererDemande(ctx.db, { etat });
  insererDemande(ctx.db, { type: "rappel", etat: "a_rappeler", staff_id: null, date: null, start_time: null, end_time: null });
  insererDemande(ctx.db, { staff_id: 2 });
  assert.equal((await reception("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-29", start_time: "10:30", service_ids: [1] })).status, 201);
});

test("busyOn : la demande se laisse de côté elle-même (sa propre confirmation ne se gêne pas)", async (t) => {
  const { ctx } = await scene(t);
  const id = insererDemande(ctx.db);
  assert.deepEqual(busyOn(ctx.db, 1, "2026-09-29").map((b) => b.kind), ["demande"]);
  assert.deepEqual(busyOn(ctx.db, 1, "2026-09-29", undefined, id), []);
});

test("une demande n'est pas un rendez-vous : ni chiffres du jour, ni agenda, ni liste, ni fiche de la cliente, ni rappel", async (t) => {
  const { ctx, reception } = await scene(t);
  const avant = (await reception("GET", "/api/stats")).body;
  const ficheAvant = (await reception("GET", "/api/clients/1")).body;
  // Demande d'une cliente connue (fiche 1), aujourd'hui à 15:00 : rien de ce qui compte les rendez-vous ne la voit.
  insererDemande(ctx.db, { date: "2026-09-28", start_time: "15:00", end_time: "16:00", client_id: 1, fiche: "connue" });
  const apres = (await reception("GET", "/api/stats")).body;
  assert.deepEqual([apres.appointments, apres.today_appointments, apres.upcoming_appointments], [avant.appointments, avant.today_appointments, avant.upcoming_appointments]);
  assert.equal((await reception("GET", "/api/calendar?start=2026-09-28&end=2026-09-29")).body.appointments.length, 0);
  assert.equal((await reception("GET", "/api/appointments")).body.total, 0);
  const ficheApres = (await reception("GET", "/api/clients/1")).body;
  assert.deepEqual([ficheApres.appointments, ficheApres.summary], [ficheAvant.appointments, ficheAvant.summary], "synthèse de la fiche inchangée");
  const reglages = { lang: "fr" as const, institut: "Institut Éclat", telephone: "", indicatif: "237", silenceStart: "21:00", silenceEnd: "08:00", reminderHours: 24, texts: DEFAULT_TEXTS };
  assert.equal(queueDueReminders(ctx.db, reglages, ctx.clock.now + 3 * 3_600_000), 0, "aucun rappel WhatsApp pour une demande");
});
