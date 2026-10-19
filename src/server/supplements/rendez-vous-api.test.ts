import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Caller } from "../test-support.ts";
import { JOUR, LIBRE, rdvAvecSupplements, salon } from "./essais-supplements.ts";

/** Suppléments d'un rendez-vous (spec du 18/10/2026 § 3.3) : création, lecture, modification, chevauchement, journal. */

const FR = { "Accept-Language": "fr" };

test("création : chaque supplément sous sa prestation ; fin et total prévus allongés ; lus dans la fiche et l'agenda", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const res = await g("POST", "/api/appointments", {
    client_id: s.client, staff_id: s.staff, scheduled_date: JOUR, start_time: "10:00", service_ids: [s.tresses, s.soin],
    supplements: [
      { service_index: 0, kind: "service", ref_id: s.meches },
      { service_index: 0, kind: "product", ref_id: s.perles, quantity: 3 },
      { service_index: 0, ...LIBRE },
      { service_index: 1, kind: "service", ref_id: s.masque },
    ],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // 60 + 45 minutes de prestations, 30 + 15 + 15 de suppléments ; 15 000 + 20 000 + 5 000 + 3 × 500 + 3 000 + 4 000.
  assert.deepEqual([res.body.appointment.end_time, res.body.appointment.total_price], ["12:45", 48500]);
  const apt = (await g("GET", `/api/appointments/${res.body.appointment.id}`)).body.appointment;
  const vue = apt.appointment_services.map((svc: { service_name: string; supplements: Record<string, unknown>[] }) => [
    svc.service_name, svc.supplements.map((x) => [x.kind, x.label_fr, x.quantity, x.price, x.minutes]),
  ]);
  assert.deepEqual(vue, [
    ["Tresses", [["service", "Mèches", 1, 5000, 30], ["product", "Perles", 3, 500, 0], ["libre", "Perles dorées", 1, 3000, 15]]],
    ["Soin du visage", [["service", "Masque", 1, 4000, 15]]],
  ]);
  const agenda = (await g("GET", `/api/calendar?start=${JOUR}&end=${JOUR}`)).body.appointments[0];
  assert.deepEqual(agenda.appointment_services[0].supplements.map((x: { label_fr: string }) => x.label_fr), ["Mèches", "Perles", "Perles dorées"]);
});

test("création : une prestation « supplément seulement » ne se réserve pas seule ; supplément invalide refusé sans rien écrire", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const base = { client_id: s.client, staff_id: s.staff, scheduled_date: JOUR, start_time: "10:00" };
  const seule = await g("POST", "/api/appointments", { ...base, service_ids: [s.meches] }, FR);
  assert.deepEqual([seule.status, seule.body.error], [400, "«\u00a0Mèches\u00a0» ne se réserve qu'en supplément d'une prestation."]);
  const refus: [Record<string, unknown>, string][] = [
    [{ service_index: 0, kind: "libre", label: "x".repeat(81), price: 0 }, "Libellé du supplément libre obligatoire, 80 caractères au plus."],
    [{ service_index: 0, kind: "libre", label: "Perles", price: 0, minutes: 300 }, "Minutes du supplément libre\u00a0: de 0 à 240."],
    [{ service_index: 0, kind: "product", ref_id: s.perles, quantity: 100 }, "Quantité d'un produit en supplément\u00a0: de 1 à 99."],
    [{ service_index: 3, kind: "service", ref_id: s.meches }, "Supplément rattaché à une prestation absente du rendez-vous."],
    [{ service_index: 0, kind: "service", ref_id: s.tresses }, "Une prestation ne peut pas être son propre supplément."],
    [{ service_index: 0, kind: "service", ref_id: s.soin }, "«\u00a0Soin du visage\u00a0» a ses propres suppléments\u00a0: un supplément n'en a pas lui-même."],
    [{ service_index: 0, kind: "product", ref_id: 999 }, "Article introuvable (n°\u00a0999)."],
  ];
  for (const [supplement, error] of refus) {
    const res = await g("POST", "/api/appointments", { ...base, service_ids: [s.tresses], supplements: [supplement] }, FR);
    assert.deepEqual([res.status, res.body.error], [400, error], JSON.stringify(supplement).slice(0, 60));
  }
  const perles = (n: number) => Array.from({ length: n }, () => ({ service_index: 0, kind: "product", ref_id: s.perles }));
  const trop = await g("POST", "/api/appointments", { ...base, service_ids: [s.tresses], supplements: perles(21) }, FR);
  assert.deepEqual([trop.status, trop.body.error], [400, "20 suppléments au plus sous une prestation."]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n, 0, "aucun rendez-vous écrit, aucun numéro pris");
  assert.equal((await g("POST", "/api/appointments", { ...base, service_ids: [s.tresses], supplements: perles(20) })).status, 201);
});

test("création : le chevauchement se contrôle sur la durée totale, suppléments compris", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  assert.equal((await g("POST", "/api/appointments", { client_id: s.autre, staff_id: s.staff, scheduled_date: JOUR, start_time: "11:00", service_ids: [s.tresses] })).status, 201);
  const base = { client_id: s.client, staff_id: s.staff, scheduled_date: JOUR, start_time: "10:00", service_ids: [s.tresses] };
  const deborde = await g("POST", "/api/appointments", { ...base, supplements: [{ service_index: 0, kind: "service", ref_id: s.meches }] });
  assert.equal(deborde.status, 409);
  assert.equal(deborde.body.conflicts[0].start_time, "11:00");
  assert.equal((await g("POST", "/api/appointments", { ...base, supplements: [{ service_index: 0, kind: "product", ref_id: s.perles }] })).status, 201, "un produit n'allonge pas");
});

test("praticienne sans prix : ni celui des prestations ni celui des suppléments du catalogue ; celui du supplément libre gardé pour encaisser", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const p = await ctx.as("practitioner");
  const s = await salon(g);
  const own = (ctx.db.prepare("SELECT staff_id FROM accounts WHERE login = 'practitioner'").get() as { staff_id: number }).staff_id;
  const id = (await g("POST", "/api/appointments", {
    client_id: s.client, staff_id: own, scheduled_date: JOUR, start_time: "10:00", service_ids: [s.tresses],
    supplements: [{ service_index: 0, kind: "product", ref_id: s.perles }, { service_index: 0, ...LIBRE }],
  })).body.appointment.id as number;
  const fiche = (await p("GET", `/api/appointments/${id}`)).body.appointment;
  const [perles, libre] = fiche.appointment_services[0].supplements;
  assert.equal(perles.label_fr, "Perles");
  assert.ok(!("price" in perles), "fiche : prix d'un article du catalogue retiré");
  assert.equal(libre.price, 3000, "fiche : prix du supplément libre gardé");
  const agenda = (await p("GET", `/api/calendar?start=${JOUR}&end=${JOUR}`)).body.appointments.find((a: { id: number }) => a.id === id);
  assert.ok(!("price" in agenda.appointment_services[0].supplements[0]), "agenda");
  assert.ok(!("price" in agenda.appointment_services[0]));
});

/** Rendez-vous de Tresses à 10:00 pour Aïcha, et la prestation de ce rendez-vous. */
async function rdv(g: Caller, s: Awaited<ReturnType<typeof salon>>, start = "10:00") {
  const apt = (await g("POST", "/api/appointments", { client_id: s.client, staff_id: s.staff, scheduled_date: JOUR, start_time: start, service_ids: [s.tresses] })).body.appointment;
  const row = (await g("GET", `/api/appointments/${apt.id}`)).body.appointment.appointment_services[0].id as number;
  return { id: apt.id as number, identifier: apt.identifier as string, row };
}

test("suppléments qui débordent : 409 et les conflits, puis « Enregistrer quand même » ; les retirer n'est jamais refusé", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const a = await rdv(g, s);
  assert.equal((await g("POST", "/api/appointments", { client_id: s.autre, staff_id: s.staff, scheduled_date: JOUR, start_time: "11:00", service_ids: [s.tresses] })).status, 201);
  const put = (supplements: unknown[], extra = {}) => g("PUT", `/api/appointments/${a.id}/supplements`, { supplements, ...extra }, FR);
  const meche = { appointment_service_id: a.row, kind: "service", ref_id: s.meches };
  const refus = await put([meche]);
  assert.equal(refus.status, 409);
  assert.equal(refus.body.conflicts[0].start_time, "11:00");
  assert.match(refus.body.error, /Awa/);
  const quandMeme = await put([meche], { allow_conflict: true });
  assert.deepEqual([quandMeme.status, quandMeme.body.end_time, quandMeme.body.total_price], [200, "11:30", 20000]);
  const retire = await put([]);
  assert.deepEqual([retire.status, retire.body.end_time, retire.body.total_price], [200, "11:00", 15000], "raccourcir ne chevauche jamais");
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM appointment_supplements").get() as { n: number }).n, 0);
});

test("fin ajustée à la main gardée : seul l'écart des minutes des suppléments la déplace ; jamais après la fermeture", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const a = await rdv(g, s);
  assert.equal((await g("PUT", `/api/appointments/${a.id}`, { end_time: "11:15" })).status, 200);
  const libre = { appointment_service_id: a.row, ...LIBRE };
  assert.equal((await g("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [libre] })).body.end_time, "11:30");
  const soir = await rdv(g, s, "22:00");
  const tard = await g("PUT", `/api/appointments/${soir.id}/supplements`, { supplements: [{ ...libre, appointment_service_id: soir.row }] }, FR);
  assert.deepEqual([tard.status, tard.body.error], [400, "Le rendez-vous finirait à 23:15, après la fermeture à 23:00."]);
  const ailleurs = await g("PUT", `/api/appointments/${soir.id}/supplements`, { supplements: [libre] }, FR);
  assert.deepEqual([ailleurs.status, ailleurs.body.error], [400, "Supplément rattaché à une prestation absente du rendez-vous."], "prestation d'un autre rendez-vous");
});

test("rendez-vous encaissé : ses suppléments ne se modifient plus ; réception permise, praticienne refusée", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const p = await ctx.as("practitioner");
  const s = await salon(g);
  const a = await rdv(g, s);
  const body = { supplements: [{ appointment_service_id: a.row, kind: "product", ref_id: s.perles, quantity: 2 }] };
  assert.equal((await p("PUT", `/api/appointments/${a.id}/supplements`, body)).status, 403);
  assert.equal((await r("PUT", `/api/appointments/${a.id}/supplements`, body)).status, 200);
  assert.equal((await g("PUT", "/api/appointments/999/supplements", body)).status, 404);
  const sale = await g("POST", "/api/sales", {
    request_id: "rdv-supplements-1", client_id: s.client, appointment_id: a.id,
    lines: [{ kind: "service", ref_id: s.tresses, quantity: 1, staff_id: s.staff }], payments: [{ method: "cash", amount: 15000 }],
  });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const fige = await r("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [] }, FR);
  assert.deepEqual([fige.status, fige.body.error], [409, "Ce rendez-vous est encaissé\u00a0: ses suppléments ne se modifient plus."]);
});

test("journal : chaque supplément libre ajouté sur un rendez-vous, une fois, avec le numéro et le prix d'abord", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const s = await salon(g);
  const a = await rdv(g, s);
  const libre = { appointment_service_id: a.row, ...LIBRE };
  const autre = { appointment_service_id: a.row, kind: "libre", label: "Tissage serré", price: 0, minutes: 0 };
  assert.equal((await r("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [libre] })).status, 200);
  assert.equal((await r("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [libre] })).status, 200, "le même enregistré de nouveau");
  assert.equal((await r("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [libre, autre] })).status, 200);
  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'supplement.libre' ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [
    { action: "supplement.libre", target: `${a.identifier} · 3\u202f000\u00a0FCFA · Perles dorées` },
    { action: "supplement.libre", target: `${a.identifier} · 0\u00a0FCFA · Tissage serré` },
  ]);
});

test("journal : un supplément libre posé à la création du rendez-vous est noté aussi ; une création refusée n'écrit rien", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const r = await ctx.as("reception");
  const s = await salon(g);
  const base = { client_id: s.client, staff_id: s.staff, scheduled_date: JOUR, start_time: "10:00", service_ids: [s.tresses] };
  const refus = await r("POST", "/api/appointments", { ...base, supplements: [{ service_index: 0, ...LIBRE }, { service_index: 0, kind: "service", ref_id: 999999 }] });
  assert.equal(refus.status, 400, JSON.stringify(refus.body));
  const ok = await r("POST", "/api/appointments", { ...base, start_time: "14:00", supplements: [{ service_index: 0, kind: "service", ref_id: s.meches }, { service_index: 0, ...LIBRE }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'supplement.libre' ORDER BY id").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [{ action: "supplement.libre", target: `${ok.body.appointment.identifier} · 3\u202f000\u00a0FCFA · Perles dorées` }]);
});

test("modification : un article inconnu ou qui a sa propre liste est un 400, comme à la création", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const a = await rdv(g, s);
  const put = (supplement: Record<string, unknown>) => g("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [{ appointment_service_id: a.row, ...supplement }] }, FR);
  const inconnu = await put({ kind: "product", ref_id: 999 });
  assert.deepEqual([inconnu.status, inconnu.body.error], [400, "Article introuvable (n°\u00a0999)."]);
  const avecListe = await put({ kind: "service", ref_id: s.soin });
  assert.deepEqual([avecListe.status, avecListe.body.error], [400, "«\u00a0Soin du visage\u00a0» a ses propres suppléments\u00a0: un supplément n'en a pas lui-même."]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM appointment_supplements").get() as { n: number }).n, 0);
});

test("fin déjà après la fermeture : retirer un supplément passe, en ajouter un autre reste refusé", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  const a = await rdv(g, s, "21:30");
  const libre = { appointment_service_id: a.row, ...LIBRE };
  assert.equal((await g("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [libre] })).body.end_time, "22:45");
  ctx.db.prepare("UPDATE appointments SET end_time = '23:30' WHERE id = ?").run(a.id);
  const retire = await g("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [] });
  assert.deepEqual([retire.status, retire.body.end_time], [200, "23:15"]);
  const ajoute = await g("PUT", `/api/appointments/${a.id}/supplements`, { supplements: [libre] }, FR);
  assert.deepEqual([ajoute.status, ajoute.body.error], [400, "Le rendez-vous finirait à 23:30, après la fermeture à 23:00."]);
});

test("acompte : plafond au total prévu, suppléments compris ; suppléments jamais retirés sous l'acompte en attente", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const s = await salon(g);
  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: true })).status, 200);
  const { apt } = await rdvAvecSupplements(g, s);
  const acompte = (request_id: string, amount: number) => g("POST", "/api/deposits", { request_id, appointment_id: apt, amount, payments: [{ method: "cash", amount }] }, FR);
  const trop = await acompte("acompte-supp-0001", 24001);
  assert.deepEqual([trop.status, trop.body.error], [409, "L'acompte ne dépasse pas le prix prévu du rendez-vous, suppléments compris (24\u202f000\u00a0F)."]);
  assert.equal((await acompte("acompte-supp-0002", 20000)).status, 201, "15 000 de prestation et 9 000 de suppléments");
  const svc = (await g("GET", `/api/appointments/${apt}`)).body.appointment.appointment_services[0] as { id: number; supplements: Record<string, unknown>[] };
  const [row, rows] = [svc.id, svc.supplements];
  const garder = (kinds: string[]) => rows.filter((x) => kinds.includes(String(x.kind))).map((x) => ({
    appointment_service_id: row, kind: x.kind, ref_id: x.ref_id, quantity: x.quantity, label: x.label_fr, price: x.price, minutes: x.minutes,
  }));
  const sous = await g("PUT", `/api/appointments/${apt}/supplements`, { supplements: garder(["product"]) }, FR);
  assert.deepEqual([sous.status, sous.body.error], [400, "Le total ne peut pas descendre sous l'acompte déjà versé (20\u202f000\u00a0F)."]);
  assert.equal((ctx.db.prepare("SELECT total_price FROM appointments WHERE id = ?").get(apt) as { total_price: number }).total_price, 24000, "rien n'a changé");
  const ok = await g("PUT", `/api/appointments/${apt}/supplements`, { supplements: garder(["service", "libre"]) }, FR);
  assert.deepEqual([ok.status, ok.body.total_price], [200, 23000]);
});
