import assert from "node:assert/strict";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { relaisEssai } from "../../../relais/essais/relais.ts";
import { setMasterKey } from "../settings.ts";
import { setupApp } from "../test-support.ts";
import { tour } from "./boucle.ts";

/**
 * Bout en bout (spec § 6) : le serveur d'essai de lama et le relais de référence en mémoire, à la même
 * horloge (lundi 28/09/2026, 09:00 à Douala). La gérante et l'administrateur règlent la liaison, une cliente
 * réserve sur la page du relais, la boucle relève, la réception confirme, la cliente reçoit son message et
 * voit « Confirmée » sur sa page de suivi ; puis deux demandes de rappel (accusée pour la cliente connue, sans accusé pour une inconnue), closes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

test("réservation en ligne de bout en bout : réglage, publication, demande, confirmation, message, suivi ; puis rappel", async (t) => {
  let relais: Awaited<ReturnType<typeof relaisEssai>> | null = null;
  const versRelais = (url: string, init: RequestInit) => relais!.app.fetch(new Request(url, init));
  const ctx = await setupApp(t, { demo: false, bindings: { EN_LIGNE_FETCH: versRelais } });
  relais = await relaisEssai({ etat: "actif", maintenant: () => ctx.clock.now });
  // La boucle tourne ici avec les modules du dépôt, sur la même base que le serveur d'essai.
  initDB({ STORAGE: ctx.env.STORAGE });
  setMasterKey(ctx.env.MASTER_KEY);
  const boucle = () => tour({ storage: ctx.env.STORAGE, maintenant: () => ctx.clock.now, fetch: versRelais, enLigne: () => true });
  const lire = async (chemin: string): Promise<Json> => (await relais!.app.request(chemin)).json();
  const deposer = async (corps: Record<string, unknown>): Promise<Json> => {
    const r = await relais!.app.request("/api/eclat/demandes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accord: true, note: "", souhait: null, ...corps }) });
    assert.equal(r.status, 201);
    return r.json();
  };
  const suivre = async (jeton: string): Promise<Json> => (await relais!.app.request("/api/eclat/suivi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jeton }) })).json();
  const messages = () => (ctx.db.prepare("SELECT payload FROM outbox WHERE kind = 'whatsapp' ORDER BY id").all() as { payload: string }[]).map((m) => JSON.parse(m.payload) as Json);

  const gerante = await ctx.as("manager");
  const admin = await ctx.as("admin");
  const reception = await ctx.as("reception");
  const service = (await gerante("POST", "/api/services", { name: "Soin visage", name_en: "Facial", category: "Visage", duration: 60, price: 25000, en_ligne: 1 })).body.service.id as number;
  const awa = (await gerante("POST", "/api/staff", { name: "Awa Ndiaye", en_ligne: 1 })).body.staff.id as number;
  for (const [cle, value] of [["institut.nom", "Institut Éclat"], ["institut.telephone", "699 00 00 00"], ["en_ligne.active", true], ["en_ligne.adresse", "https://relais.exemple"]] as const) {
    assert.equal((await gerante("PUT", `/api/settings/${cle}`, { value })).status, 200, cle);
  }
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await admin("PUT", "/api/settings/en_ligne.salon", { value: "eclat" })).status, 200);
  assert.equal((await admin("PUT", "/api/settings/en_ligne.cle", { value: relais.cles.eclat })).status, 200);
  assert.equal((await gerante("POST", "/api/en-ligne/tester", {})).body.ok, true);
  // Ici, le serveur d'essai (assemblé à part) et la boucle n'ont pas la même table d'horodatages du client du relais :
  // une seconde plus tard, la boucle ne signe jamais le même appel que l'essai de la liaison (refusé comme rejeu).
  ctx.clock.now += 1_000;

  // Publication : la page du relais propose la prestation et des créneaux dès le lendemain matin.
  assert.equal((await boucle()).statut, "ok");
  const vitrine = await lire("/api/eclat/vitrine");
  assert.equal(vitrine.etat, "ouvert");
  assert.deepEqual(vitrine.prestations.map((p: { id: string }) => p.id), [`s${service}`]);
  assert.equal((await lire(`/api/eclat/creneaux?prestation=s${service}&date=2026-09-29`)).creneaux[0].heure, "09:00");

  // La cliente réserve « Sans préférence », institut ouvert (lundi 09:00).
  const { jeton, hors_horaires } = await deposer({
    type: "creneau", prestation: `s${service}`, praticienne: null, date: "2026-09-29", heure: "10:00",
    cliente: { prenom: "Mireille", nom: "Mireille Ngo", telephone: "+237699000111", langue: "fr" }, note: "Première visite",
  });
  assert.equal(hors_horaires, false);
  assert.deepEqual(await boucle(), { statut: "ok", nouvelles: 1 });
  assert.deepEqual((await reception("GET", "/api/demandes-en-ligne/compte")).body, { active: true, a_traiter: 1 });
  const [demande] = (await reception("GET", "/api/demandes-en-ligne")).body.demandes;
  assert.deepEqual([demande.etat, demande.staff_id, demande.sans_preference, demande.fiche, demande.note], ["a_confirmer", awa, 1, "nouvelle", "Première visite"]);
  assert.equal((await reception("GET", "/api/demandes-en-ligne/agenda?date=2026-09-29")).body.demandes.length, 1, "la colonne d'Awa est occupée");
  await boucle();
  const libres = (await lire(`/api/eclat/creneaux?prestation=s${service}&date=2026-09-29`)).creneaux.map((c: { heure: string }) => c.heure);
  assert.ok(!libres.includes("10:00") && !libres.includes("10:30"), "le créneau n'est plus proposé");

  // La réception confirme : rendez-vous « En ligne », fiche créée, message, décision transmise au tour suivant.
  const confirme = await reception("POST", `/api/demandes-en-ligne/${demande.id}/confirmer`, { staff_id: awa, fiche: { mode: "nouvelle" } });
  assert.equal(confirme.status, 200);
  const rdv = (await reception("GET", `/api/appointments/${confirme.body.appointment_id}`)).body.appointment;
  assert.deepEqual([rdv.status, rdv.en_ligne, rdv.client_name, rdv.start_time], ["confirmed", 1, "Mireille Ngo", "10:00"]);
  assert.equal(messages().length, 1);
  assert.match(messages()[0].text, /^Bonjour Mireille, votre rendez-vous Soin visage du mardi 29 septembre à 10:00 avec Awa est confirmé chez Institut Éclat\./);
  assert.equal((await suivre(jeton)).etat, "en_attente", "pas encore transmise");
  await boucle();
  const suivi = await suivre(jeton);
  assert.deepEqual([suivi.etat, suivi.horaire], ["confirmee", { date: "2026-09-29", heure: "10:00", praticienne: "Awa" }]);

  // Demande de rappel de la même cliente (fiche créée par la confirmation : téléphone et nom identiques, donc « connue ») :
  // accusée par message dans sa langue, avec le prénom de la fiche ; close « Sans suite ».
  const rappel = await deposer({
    type: "rappel", prestation: `s${service}`, praticienne: null, date: null, heure: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" },
    cliente: { prenom: "Mireille", nom: "Mireille Ngo", telephone: "+237699000111", langue: "en" },
  });
  assert.deepEqual(await boucle(), { statut: "ok", nouvelles: 1 });
  assert.equal(messages().length, 2);
  assert.match(messages()[1].text, /^Hello Mireille, Institut Éclat has received your call-back request for Facial\./);
  // Une inconnue (autre numéro, autre nom) n'a aucun accusé : le formulaire est public.
  const inconnue = await deposer({
    type: "rappel", prestation: `s${service}`, praticienne: null, date: null, heure: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" },
    cliente: { nom: "Brenda Tabi", telephone: "+237655000222", langue: "en" },
  });
  assert.deepEqual(await boucle(), { statut: "ok", nouvelles: 1 });
  assert.equal(messages().length, 2, "aucun accusé pour une inconnue");
  const aRappeler = (await reception("GET", "/api/demandes-en-ligne")).body.demandes.filter((d: { etat: string }) => d.etat === "a_rappeler");
  assert.equal(aRappeler.length, 2);
  for (const d of aRappeler) assert.equal((await reception("POST", `/api/demandes-en-ligne/${d.id}/clore`, { issue: "sans_suite" })).status, 200);
  await boucle();
  const clos = await suivre(rappel.jeton);
  assert.deepEqual([clos.etat, clos.issue], ["traitee", "sans_suite"], "la page dira \u00ab\u00a0Votre demande est close\u00a0\u00bb");
  assert.equal((await suivre(inconnue.jeton)).etat, "traitee");
  assert.deepEqual((await reception("GET", "/api/demandes-en-ligne/compte")).body, { active: true, a_traiter: 0 });
  assert.deepEqual((ctx.db.prepare("SELECT action FROM audit_log WHERE action LIKE 'en_ligne.%' ORDER BY id").all() as { action: string }[]).map((l) => l.action), ["en_ligne.confirmation", "en_ligne.cloture", "en_ligne.cloture"]);
});
