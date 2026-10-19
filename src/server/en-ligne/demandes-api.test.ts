import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp, type Caller, type TestApp } from "../test-support.ts";
import { insererDemande } from "./essais-en-ligne.ts";

/** Écran « Demandes en ligne » (spec § 4.5), par l'API. Horloge : lundi 28/09/2026, 09:00 à Douala ; demandes du mardi 29. */
const FR = { "Accept-Language": "fr" };

async function scene(t: Parameters<typeof setupApp>[0]) {
  const ctx = await setupApp(t, { demo: false });
  ctx.db.exec(`INSERT INTO staff (id, name, color, en_ligne) VALUES (1, 'Awa Ndiaye', '#4A5D73', 1), (2, 'Bella Ewane', '#4F6552', 1);
    INSERT INTO clients (id, name, phone, language) VALUES (1, 'Mireille Ngo', '699 000 111', 'fr');
    INSERT INTO services (id, name, name_en, duration, price, en_ligne) VALUES (1, 'Soin visage', 'Facial', 60, 25000, 1);
    INSERT INTO settings (key, value, secret, updated_at) VALUES ('institut.nom', '"Institut Éclat"', 0, 0);`);
  return { ctx, reception: await ctx.as("reception") };
}

const ligne = (ctx: TestApp, id: number) => ({ ...(ctx.db.prepare("SELECT * FROM demandes_en_ligne WHERE id = ?").get(id) as Record<string, unknown>) });
const messages = (ctx: TestApp) => (ctx.db.prepare("SELECT payload FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { payload: string }[]).map((m) => JSON.parse(m.payload));
const journal = (ctx: TestApp) => (ctx.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'en_ligne.%' ORDER BY id").all() as { action: string; target: string }[]).map((l) => ({ ...l }));
const agir = (call: Caller, id: number, action: string, corps: unknown) => call("POST", `/api/demandes-en-ligne/${id}/${action}`, corps, FR);

test("liste à traiter de la plus ancienne à la plus récente, filtre « Toutes », compte ; droits", async (t) => {
  const { ctx, reception } = await scene(t);
  const recente = insererDemande(ctx.db, { recue_le: ctx.clock.now - 60_000 });
  const ancienne = insererDemande(ctx.db, { recue_le: ctx.clock.now - 3_600_000, type: "rappel", etat: "a_rappeler", staff_id: null, date: null, start_time: null, end_time: null, souhait: JSON.stringify({ jours: ["sam"], moments: ["matin"], precision: "" }) });
  insererDemande(ctx.db, { recue_le: ctx.clock.now - 7_200_000, etat: "refusee" });
  const liste = await reception("GET", "/api/demandes-en-ligne");
  assert.equal(liste.status, 200);
  assert.deepEqual(liste.body.demandes.map((d: { id: number }) => d.id), [ancienne, recente]);
  assert.deepEqual(liste.body.demandes[0].souhait, { jours: ["sam"], moments: ["matin"], precision: "" });
  assert.equal(liste.body.demandes[1].staff_nom, "Awa Ndiaye");
  assert.equal((await reception("GET", "/api/demandes-en-ligne?filtre=toutes")).body.demandes.length, 3);
  assert.deepEqual((await reception("GET", "/api/demandes-en-ligne/compte")).body, { active: false, a_traiter: 2 });
  const praticienne = await ctx.as("practitioner");
  assert.equal((await praticienne("GET", "/api/demandes-en-ligne")).status, 403);
  assert.equal((await praticienne("POST", `/api/demandes-en-ligne/${recente}/refuser`, { motif: "complet" })).status, 403);
  assert.equal((await (await ctx.as("admin"))("GET", "/api/demandes-en-ligne")).status, 403);
});

test("agenda : la réception voit la cliente, la praticienne seulement un créneau « réservé »", async (t) => {
  const { ctx, reception } = await scene(t);
  insererDemande(ctx.db, { sans_preference: 1 });
  insererDemande(ctx.db, { etat: "en_conflit" });
  const vue = (await reception("GET", "/api/demandes-en-ligne/agenda?date=2026-09-29")).body.demandes;
  assert.equal(vue.length, 1);
  assert.deepEqual([vue[0].cliente_nom, vue[0].prestation_nom, vue[0].sans_preference, vue[0].staff_id], ["Mireille Ngo", "Soin visage", 1, 1]);
  const praticienne = await ctx.as("practitioner");
  assert.deepEqual((await praticienne("GET", "/api/demandes-en-ligne/agenda?date=2026-09-29")).body.demandes, [{ staff_id: 1, start_time: "10:00", end_time: "11:00" }]);
  assert.equal((await reception("GET", "/api/demandes-en-ligne/agenda?date=29/09/2026")).status, 400);
});

test("confirmer : rendez-vous confirmé « En ligne », fiche créée, message et décision ; confirmation en double refusée", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db, { cliente_prenom: "Brenda", cliente_nom: "Brenda Tabi", cliente_telephone: "+237655000222" });
  const [a, b] = await Promise.all([
    agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } }),
    agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.match((a.status === 409 ? a : b).body.error, /déjà été traitée/);
  const rdvs = ctx.db.prepare("SELECT * FROM appointments").all() as Record<string, unknown>[];
  assert.equal(rdvs.length, 1, "un seul rendez-vous");
  assert.deepEqual([rdvs[0].status, rdvs[0].en_ligne, rdvs[0].staff_id, rdvs[0].scheduled_date, rdvs[0].start_time, rdvs[0].end_time, rdvs[0].total_price], ["confirmed", 1, 1, "2026-09-29", "10:00", "11:00", 25000]);
  const fiche = ctx.db.prepare("SELECT name, phone, language FROM clients WHERE id = ?").get(rdvs[0].client_id as number) as Record<string, unknown>;
  assert.deepEqual({ ...fiche }, { name: "Brenda Tabi", phone: "+237655000222", language: "fr" });
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM clients WHERE name = 'Brenda Tabi'").get() as { n: number }).n, 1, "une seule fiche");
  const l = ligne(ctx, id);
  assert.deepEqual([l.etat, l.appointment_id, l.client_id, l.decision_envoyee_le], ["confirmee", rdvs[0].id, rdvs[0].client_id, null]);
  const decision = JSON.parse(String(l.decision));
  assert.deepEqual([decision.decision, decision.horaire], ["acceptee", { date: "2026-09-29", heure: "10:00", praticienne: "Awa" }]);
  assert.match(decision.message.fr, /^Bonjour Brenda, votre rendez-vous Soin visage du mardi 29 septembre à 10:00 avec Awa est confirmé/);
  const [m] = messages(ctx);
  assert.deepEqual([m.to, m.lang, m.origin.type, m.origin.demandeId, m.origin.clientId], ["237655000222", "fr", "en_ligne", id, rdvs[0].client_id]);
  assert.equal(messages(ctx).length, 1, "un seul message");
  assert.deepEqual(journal(ctx), [{ action: "en_ligne.confirmation", target: String(id) }]);
});

test("confirmer : chevauchement vérifié une dernière fois ; fiche « à vérifier » jamais choisie d'office", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db, { client_id: 1, fiche: "a_verifier", cliente_nom: "Grace Ngo", cliente_telephone: "+237699000111" });
  ctx.db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time) VALUES ('APT-9', 1, 2, '2026-09-29', '10:30', '11:30')").run();
  const pris = await agir(reception, id, "confirmer", { staff_id: 2, fiche: { mode: "nouvelle" } });
  assert.equal(pris.status, 409);
  assert.equal(pris.body.conflicts[0].kind, "appointment");
  assert.match(pris.body.error, /Bella Ewane n'est pas libre/);
  assert.equal((await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "inconnu" } })).status, 400, "choix de fiche exigé");
  const ok = await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } });
  assert.equal(ok.status, 200);
  const rdv = ctx.db.prepare("SELECT client_id FROM appointments WHERE id = ?").get(ok.body.appointment_id) as { client_id: number };
  assert.notEqual(rdv.client_id, 1, "même numéro, autre personne : nouvelle fiche, la fiche existante n'est pas touchée");
  assert.equal((ctx.db.prepare("SELECT name FROM clients WHERE id = 1").get() as { name: string }).name, "Mireille Ngo");
});

test("autre horaire : libre exigé, la demande libère son créneau ; puis « Créer le rendez-vous » quand la cliente accepte", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db, { client_id: 1, fiche: "connue" });
  ctx.db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time) VALUES ('APT-9', 1, 2, '2026-09-29', '15:00', '16:00')").run();
  assert.equal((await agir(reception, id, "autre-horaire", { date: "2026-09-29", heure: "15:30", staff_id: 2 })).status, 409);
  assert.equal((await agir(reception, id, "autre-horaire", { date: "2026-09-29", heure: "22:30", staff_id: 2 })).status, 400, "finirait après 23:00");
  assert.equal((await agir(reception, id, "autre-horaire", { date: "2026-09-29", heure: "16:00", staff_id: 2 })).status, 200);
  const l = ligne(ctx, id);
  assert.deepEqual([l.etat, l.autre_date, l.autre_heure, l.autre_staff_id], ["autre_horaire", "2026-09-29", "16:00", 2]);
  assert.deepEqual(JSON.parse(String(l.decision)).horaire, { date: "2026-09-29", heure: "16:00", praticienne: "Bella" });
  assert.match(messages(ctx)[0].text, /vous propose le mardi 29 septembre à 16:00 avec Bella/);
  // Le créneau d'origine est libéré : 10:00 se réserve de nouveau chez Awa.
  assert.equal((await reception("POST", "/api/appointments", { client_id: 1, staff_id: 1, scheduled_date: "2026-09-29", start_time: "10:00", service_ids: [1] })).status, 201);
  const cree = await agir(reception, id, "rendez-vous", { date: "2026-09-29", heure: "16:00", staff_id: 2, fiche: { mode: "trouvee" } });
  assert.equal(cree.status, 200);
  assert.deepEqual([ligne(ctx, id).etat, JSON.parse(String(ligne(ctx, id).decision)).decision], ["confirmee", "acceptee"]);
  assert.equal((ctx.db.prepare("SELECT client_id FROM appointments WHERE id = ?").get(cree.body.appointment_id) as { client_id: number }).client_id, 1);
});

test("refuser une demande en conflit (prestation supprimée) : motif et message ajoutés ; jamais confirmée", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db, { etat: "en_conflit", service_id: null, prestation_ref: "s9", prestation_nom: "", staff_id: null });
  assert.equal((await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } })).status, 409, "une demande en conflit ne se confirme pas");
  assert.match((await agir(reception, id, "autre-horaire", { date: "2026-09-29", heure: "14:00", staff_id: 1 })).body.error, /n'existe plus/);
  assert.equal((await agir(reception, id, "refuser", { motif: "inconnu" })).status, 400);
  assert.equal((await agir(reception, id, "refuser", { motif: "prestation_indisponible", message: "Cette prestation revient en novembre." })).status, 200);
  const l = ligne(ctx, id);
  assert.deepEqual([l.etat, l.motif], ["refusee", "prestation_indisponible"]);
  assert.match(JSON.parse(String(l.decision)).message.fr, /Cette prestation revient en novembre\.$/);
  assert.match(messages(ctx)[0].text, /Cette prestation revient en novembre\.$/);
  assert.equal((await agir(reception, id, "refuser", { motif: "complet" })).status, 409, "déjà refusée");
});

test("demande de rappel : injoignable trois fois, close d'office ; sans suite ; rendez-vous pris", async (t) => {
  const { ctx, reception } = await scene(t);
  const rappel = (o: Record<string, string | number | null> = {}) => insererDemande(ctx.db, { type: "rappel", etat: "a_rappeler", staff_id: null, date: null, start_time: null, end_time: null, ...o });
  const a = rappel();
  for (const attendu of ["a_rappeler", "a_rappeler", "traitee"]) {
    assert.equal((await agir(reception, a, "clore", { issue: "injoignable" })).status, 200);
    assert.equal(ligne(ctx, a).etat, attendu);
  }
  assert.deepEqual([ligne(ctx, a).tentatives, JSON.parse(String(ligne(ctx, a).decision)).decision], [3, "traitee"]);
  const b = rappel();
  await agir(reception, b, "clore", { issue: "sans_suite" });
  assert.equal(ligne(ctx, b).etat, "traitee");
  const c = rappel();
  assert.equal((await agir(reception, c, "clore", { issue: "rdv_pris" })).status, 400, "horaire du rendez-vous exigé");
  const pris = await agir(reception, c, "clore", { issue: "rdv_pris", rendez_vous: { date: "2026-09-30", heure: "11:00", staff_id: 1, fiche: { mode: "nouvelle" } } });
  assert.equal(pris.status, 200);
  assert.deepEqual([ligne(ctx, c).etat, ligne(ctx, c).appointment_id], ["traitee", pris.body.appointment_id]);
  assert.deepEqual([a, b, c].map((x) => JSON.parse(String(ligne(ctx, x).decision)).issue), ["injoignable", "sans_suite", "rdv_pris"]);
  assert.deepEqual(journal(ctx).map((l) => l.action), ["en_ligne.cloture", "en_ligne.cloture", "en_ligne.cloture", "en_ligne.cloture", "en_ligne.cloture"]);
});

test("demande inconnue : 404 lisible", async (t) => {
  const { reception } = await scene(t);
  const r = await agir(reception, 999, "refuser", { motif: "complet" });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "Demande en ligne introuvable.");
});

test("fiche « à vérifier » : « trouvée » refusée, fiche choisie acceptée ; canal « Aucun » n'empêche pas la confirmation ; une seule confirmation", async (t) => {
  const { ctx, reception } = await scene(t);
  ctx.db.prepare("UPDATE clients SET channel = 'none' WHERE id = 1").run();
  const id = insererDemande(ctx.db, { client_id: 1, fiche: "a_verifier", cliente_nom: "Grace Ngo", cliente_telephone: "+237699000111" });
  const refusee = await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "trouvee" } });
  assert.equal(refusee.status, 400);
  assert.match(refusee.body.error, /à vérifier/);
  assert.equal(ligne(ctx, id).etat, "a_confirmer");
  assert.equal((await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "autre", client_id: 999 } })).status, 404);
  const ok = await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "autre", client_id: 1 } });
  assert.equal(ok.status, 200, "la fiche en canal « Aucun » ne fait pas échouer la confirmation");
  assert.equal(ligne(ctx, id).etat, "confirmee");
  assert.equal(messages(ctx).length, 0, "canal « Aucun » : rien d'écrit");
  assert.deepEqual(journal(ctx), [{ action: "en_ligne.confirmation", target: String(id) }]);
});

test("confirmer : la demande ne se heurte pas à elle-même ; seule la confirmation en ligne part, jamais celle d'un rendez-vous ordinaire", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db); // a_confirmer, Awa, 10:00 à 11:00 : occupe déjà son propre créneau
  const ok = await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } });
  assert.equal(ok.status, 200);
  const sortants = messages(ctx);
  assert.equal(sortants.length, 1);
  assert.equal(sortants[0].origin.type, "en_ligne");
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM outbox").get() as { n: number }).n, 1, "aucun autre élément dans la file");
});

test("rendez-vous pris : prestation de la demande supprimée, la réception en choisit une autre", async (t) => {
  const { ctx, reception } = await scene(t);
  ctx.db.exec("INSERT INTO services (id, name, name_en, duration, price, en_ligne, active) VALUES (2, 'Pose de vernis', 'Nail polish', 30, 10000, 1, 1), (3, 'Ancien soin', 'Old care', 30, 5000, 0, 0)");
  const id = insererDemande(ctx.db, { type: "rappel", etat: "a_rappeler", service_id: null, prestation_ref: "s9", prestation_nom: "", staff_id: null, date: null, start_time: null, end_time: null });
  const corps = { date: "2026-09-30", heure: "11:00", staff_id: 1, fiche: { mode: "nouvelle" } };
  const sans = await agir(reception, id, "clore", { issue: "rdv_pris", rendez_vous: corps });
  assert.equal(sans.status, 400);
  assert.match(sans.body.error, /choisissez la prestation/);
  assert.doesNotMatch(sans.body.error, /refus/i);
  assert.equal((await agir(reception, id, "clore", { issue: "rdv_pris", rendez_vous: { ...corps, service_id: 3 } })).status, 404, "prestation désactivée");
  assert.equal((await agir(reception, id, "clore", { issue: "rdv_pris", rendez_vous: { ...corps, service_id: 99 } })).status, 404);
  const ok = await agir(reception, id, "clore", { issue: "rdv_pris", rendez_vous: { ...corps, service_id: 2 } });
  assert.equal(ok.status, 200);
  assert.deepEqual([ligne(ctx, id).etat, ligne(ctx, id).appointment_id], ["traitee", ok.body.appointment_id]);
  const r = ctx.db.prepare("SELECT service_id, price, duration FROM appointment_services WHERE appointment_id = ?").get(ok.body.appointment_id) as Record<string, number>;
  assert.deepEqual({ ...r }, { service_id: 2, price: 10000, duration: 30 });
  assert.equal((ctx.db.prepare("SELECT end_time FROM appointments WHERE id = ?").get(ok.body.appointment_id) as { end_time: string }).end_time, "11:30");
});

test("horaire déjà passé refusé (autre horaire, confirmation) ; demande en conflit : message propre", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db);
  const hier = await agir(reception, id, "autre-horaire", { date: "2026-09-27", heure: "14:00", staff_id: 1 });
  assert.equal(hier.status, 400);
  assert.match(hier.body.error, /déjà commencé ou passé/);
  assert.equal((await agir(reception, id, "autre-horaire", { date: "2026-09-28", heure: "08:00", staff_id: 1 })).status, 400, "ce matin avant 09:00");
  assert.equal(ligne(ctx, id).etat, "a_confirmer");
  const passee = insererDemande(ctx.db, { staff_id: 2, date: "2026-09-28", start_time: "08:00", end_time: "09:00" });
  const c = await agir(reception, passee, "confirmer", { staff_id: 2, fiche: { mode: "nouvelle" } });
  assert.equal(c.status, 400, "créneau passé : aucun message ne part");
  assert.equal(messages(ctx).length, 0);
  const conflit = insererDemande(ctx.db, { etat: "en_conflit", staff_id: null });
  const r = await agir(reception, conflit, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "Demande en conflit\u00a0: proposez un autre horaire ou refusez-la.");
});

test("confirmer le jour même à l'horaire d'origine : accepté tant que le créneau n'est pas fini (heure de Douala) ; autre horaire déjà commencé toujours refusé", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db, { date: "2026-09-28", start_time: "10:00", end_time: "11:00" });
  const tardive = insererDemande(ctx.db, { staff_id: 2, date: "2026-09-28", start_time: "10:00", end_time: "11:00" });
  ctx.clock.now = Date.parse("2026-09-28T09:05:00Z"); // 10:05 à Douala : la cliente est au comptoir
  const c = await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(ligne(ctx, id).etat, "confirmee");
  const autre = await agir(reception, tardive, "autre-horaire", { date: "2026-09-28", heure: "10:00", staff_id: 2 });
  assert.equal(autre.status, 400, "proposer un horaire déjà commencé reste refusé");
  ctx.clock.now = Date.parse("2026-09-28T10:00:00Z"); // 11:00 à Douala : le créneau est fini
  const fini = await agir(reception, tardive, "confirmer", { staff_id: 2, fiche: { mode: "nouvelle" } });
  assert.equal(fini.status, 400);
  assert.match(fini.body.error, /déjà commencé ou passé/);
  assert.equal(ligne(ctx, tardive).etat, "a_confirmer");
});

test("relais ancien (demande sans prénom) : confirmation sans prénom deviné, fiche au nom transmis", async (t) => {
  const { ctx, reception } = await scene(t);
  const id = insererDemande(ctx.db, { cliente_nom: "Essai Bertille", cliente_telephone: "+237690000202" });
  assert.equal((await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } })).status, 200);
  const decision = JSON.parse(String(ligne(ctx, id).decision));
  assert.match(decision.message.fr, /^Bonjour, votre rendez-vous Soin visage du mardi 29 septembre à 10:00 avec Awa est confirmé/);
  assert.match(decision.message.en, /^Hello, your Facial appointment/);
  assert.match(messages(ctx)[0].text, /^Bonjour, votre rendez-vous/);
  assert.equal((ctx.db.prepare("SELECT name FROM clients WHERE id = ?").get(ligne(ctx, id).client_id as number) as { name: string }).name, "Essai Bertille");
});

test("prestation passée en « supplément seulement » depuis la demande : confirmation refusée (prestation absente), jamais choisie à la place", async (t) => {
  const { ctx, reception } = await scene(t);
  ctx.db.exec("INSERT INTO services (id, name, name_en, duration, price, en_ligne, active, supplement_seulement) VALUES (4, 'Perles', 'Beads', 15, 2000, 0, 1, 1)");
  const id = insererDemande(ctx.db);
  ctx.db.exec("UPDATE services SET supplement_seulement = 1, en_ligne = 0 WHERE id = 1");
  const confirmer = await agir(reception, id, "confirmer", { staff_id: 1, fiche: { mode: "nouvelle" } });
  assert.deepEqual([confirmer.status, confirmer.body.error], [409, "La prestation demandée n'existe plus\u00a0: la demande ne peut qu'être refusée."]);
  const rappel = insererDemande(ctx.db, { type: "rappel", etat: "a_rappeler", service_id: null, prestation_ref: "s9", prestation_nom: "", staff_id: null, date: null, start_time: null, end_time: null });
  const corps = { date: "2026-09-30", heure: "11:00", staff_id: 1, fiche: { mode: "nouvelle" }, service_id: 4 };
  assert.equal((await agir(reception, rappel, "clore", { issue: "rdv_pris", rendez_vous: corps })).status, 404);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number }).n, 0);
});
