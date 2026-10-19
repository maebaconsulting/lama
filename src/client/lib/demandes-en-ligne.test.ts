import assert from "node:assert/strict";
import { test } from "node:test";
import type { DemandeEnLigne } from "../types.ts";
import { actionsDe, corpsAction, delaiDepuis, ficheParDefaut, issueDe, libelleFiche, libelleSouhait, praticienneDemandee, praticiennesProposees, prestationDe, saisieInitiale, saisiePrete, telephoneLisible } from "./demandes-en-ligne.ts";

const demande = (o: Partial<DemandeEnLigne> = {}): DemandeEnLigne => ({
  id: 4, type: "creneau", etat: "a_confirmer", service_id: 1, prestation_ref: "s1", prestation_nom: "Soin visage", prestation_nom_en: "Facial",
  staff_demande_id: 1, staff_demande_nom: "Awa Ndiaye", sans_preference: 0, staff_id: 1, staff_nom: "Awa Ndiaye",
  date: "2026-10-20", start_time: "10:00", end_time: "11:00", cliente_nom: "Mireille Ngo", cliente_telephone: "+237699000111", cliente_langue: "fr",
  note: "", souhait: null, fiche: "nouvelle", client_id: null, client_nom: null, tentatives: 0, appointment_id: null,
  autre_date: null, autre_heure: null, autre_staff_id: null, autre_staff_nom: null, motif: "", recue_le: 0, decidee_le: null, decidee_par_nom: null, decision_attente: false,
  ...o,
});

test("actions selon l'état (spec § 4.5)", () => {
  assert.deepEqual(actionsDe("a_confirmer"), ["confirmer", "autre_horaire", "refuser"]);
  assert.deepEqual(actionsDe("en_conflit"), ["autre_horaire", "refuser"]);
  assert.deepEqual(actionsDe("a_rappeler"), ["appeler", "clore"]);
  assert.deepEqual(actionsDe("autre_horaire"), ["rendez_vous"]);
  for (const etat of ["confirmee", "refusee", "traitee"] as const) assert.deepEqual(actionsDe(etat), []);
});

test("délai depuis l'arrivée, accordé en nombre dans chaque langue", () => {
  assert.equal(delaiDepuis(0, 30_000, "fr"), "à l'instant");
  assert.equal(delaiDepuis(0, 5 * 60_000, "fr"), "il y a 5\u00a0min");
  assert.equal(delaiDepuis(0, 3 * 3_600_000, "fr"), "il y a 3\u00a0h");
  assert.equal(delaiDepuis(0, 26 * 3_600_000, "fr"), "il y a 1\u00a0jour");
  assert.equal(delaiDepuis(0, 50 * 3_600_000, "fr"), "il y a 2\u00a0jours");
  assert.equal(delaiDepuis(0, 50 * 3_600_000, "en"), "2 days ago");
  assert.equal(delaiDepuis(10_000, 0, "en"), "just now", "horloge de l'appareil en retard");
});

test("fiche : connue avec son nom, nouvelle, à vérifier jamais choisie d'office", () => {
  assert.equal(libelleFiche(demande({ fiche: "connue", client_id: 3, client_nom: "Mireille Ngo" }), "fr"), "Cliente connue\u00a0: Mireille Ngo");
  assert.equal(libelleFiche(demande(), "en"), "New client");
  assert.equal(libelleFiche(demande({ fiche: "a_verifier", client_id: 3, client_nom: "Grace Ngo" }), "fr"), "Même numéro, nom différent\u00a0: à vérifier (Grace Ngo)");
  assert.equal(ficheParDefaut(demande({ fiche: "connue", client_id: 3 })), "trouvee");
  assert.equal(ficheParDefaut(demande()), "nouvelle");
  assert.equal(ficheParDefaut(demande({ fiche: "a_verifier", client_id: 3 })), null);
  assert.equal(saisiePrete("confirmer", saisieInitiale(demande({ fiche: "a_verifier", client_id: 3 }), "confirmer")), false, "la réception choisit la fiche");
});

test("prestation retirée et praticienne demandée lisibles", () => {
  assert.equal(prestationDe(demande(), "en"), "Facial");
  assert.equal(prestationDe(demande({ prestation_nom: "", prestation_nom_en: "", prestation_ref: "s9" }), "fr"), "Prestation retirée (s9)");
  assert.equal(praticienneDemandee(demande({ sans_preference: 1, staff_demande_id: null, staff_demande_nom: null }), "fr"), "Sans préférence");
  assert.equal(praticienneDemandee(demande({ staff_demande_id: null, staff_demande_nom: null }), "fr"), "praticienne retirée");
});

test("souhait d'une demande de rappel, en clair", () => {
  assert.equal(libelleSouhait({ jours: ["lun", "sam"], moments: ["matin", "soir"], precision: "après 10 h" }, "fr"), "Jours\u00a0: lundi, samedi. Moments\u00a0: matin, soir. Précision\u00a0: après 10 h");
  assert.equal(libelleSouhait({ jours: [], moments: [], precision: "" }, "en"), "Days: any. Times: any.");
});

test("corps envoyés au serveur, selon l'action", () => {
  const s = saisieInitiale(demande(), "confirmer");
  assert.deepEqual(corpsAction("confirmer", s, false), { staff_id: 1, fiche: { mode: "nouvelle" } });
  assert.deepEqual(corpsAction("confirmer", { ...s, fiche: "autre", autreClient: "7" }, true), { staff_id: 1, fiche: { mode: "autre", client_id: 7 }, allow_conflict: true });
  assert.deepEqual(corpsAction("autre_horaire", { ...s, staff: "2", heure: "16:00" }, false), { date: "2026-10-20", heure: "16:00", staff_id: 2 });
  assert.deepEqual(corpsAction("refuser", { ...s, motif: "complet", message: "  " }, false), { motif: "complet" });
  assert.deepEqual(corpsAction("clore", { ...s, issue: "injoignable" }, false), { issue: "injoignable" });
  const accepte = saisieInitiale(demande({ etat: "autre_horaire", autre_date: "2026-10-21", autre_heure: "16:00", autre_staff_id: 2 }), "rendez_vous");
  assert.deepEqual([accepte.date, accepte.heure, accepte.staff], ["2026-10-21", "16:00", "2"], "horaire proposé prérempli");
  const rappel = saisieInitiale(demande({ type: "rappel", etat: "a_rappeler", date: null, start_time: null, staff_id: null, staff_demande_id: null }), "clore");
  assert.equal(saisiePrete("clore", rappel), true, "injoignable : rien d'autre à saisir");
  assert.equal(saisiePrete("clore", { ...rappel, issue: "rdv_pris" }), false, "rendez-vous pris : horaire exigé");
});

test("prestation : reprise de la demande, à choisir quand elle n'existe plus", () => {
  const s = saisieInitiale(demande(), "rendez_vous");
  assert.equal(s.service, "1");
  assert.equal(corpsAction("rendez_vous", { ...s, fiche: "nouvelle" }, false).service_id, 1);
  assert.equal(corpsAction("clore", { ...s, issue: "rdv_pris", fiche: "nouvelle" }, false).rendez_vous && (corpsAction("clore", { ...s, issue: "rdv_pris", fiche: "nouvelle" }, false).rendez_vous as { service_id: number }).service_id, 1);
  const retiree = saisieInitiale(demande({ service_id: null, etat: "autre_horaire", autre_date: "2026-10-21", autre_heure: "16:00", autre_staff_id: 2 }), "rendez_vous");
  assert.equal(retiree.service, "");
  assert.equal(saisiePrete("rendez_vous", { ...retiree, fiche: "nouvelle" }), false, "la réception choisit la prestation");
  assert.equal(saisiePrete("rendez_vous", { ...retiree, fiche: "nouvelle", service: "3" }), true);
  assert.equal("service_id" in corpsAction("rendez_vous", { ...retiree, fiche: "nouvelle" }, false), false);
  assert.equal("service_id" in corpsAction("autre_horaire", s, false), false, "l'autre horaire garde la prestation de la demande");
});

test("demande de rappel close : l'issue est dite (« Injoignable », « Rendez-vous pris », « Sans suite ») ; rien ailleurs", () => {
  const close = (motif: string) => demande({ type: "rappel", etat: "traitee", motif });
  assert.equal(issueDe(close("injoignable"), "fr"), "Injoignable");
  assert.equal(issueDe(close("rdv_pris"), "fr"), "Rendez-vous pris");
  assert.equal(issueDe(close("sans_suite"), "en"), "No follow-up");
  assert.equal(issueDe(demande({ type: "rappel", etat: "a_rappeler", motif: "" }), "fr"), null);
  assert.equal(issueDe(demande({ etat: "refusee", motif: "complet" }), "fr"), null, "un refus de créneau garde son libellé");
});

test("téléphone de la cliente groupé comme ailleurs dans lama (groupPhone)", () => {
  assert.equal(telephoneLisible("+237677112233"), "+237\u00a0677\u00a011\u00a022\u00a033");
  assert.equal(telephoneLisible("+33612345678"), "+33612345678");
});

test("praticiennes proposées : celles qui pratiquent la prestation et celle déjà choisie ; toute l'équipe sur demande ou sans prestation", () => {
  const equipe = [{ id: 1, service_ids: [1] }, { id: 2, service_ids: [1, 2] }, { id: 3, service_ids: [2] }];
  assert.deepEqual(praticiennesProposees(equipe, 1, "", false), { liste: [equipe[0], equipe[1]], masquees: 1 });
  assert.deepEqual(praticiennesProposees(equipe, "1", "3", false).liste.map((s) => s.id), [1, 2, 3], "la praticienne déjà choisie reste visible");
  assert.deepEqual(praticiennesProposees(equipe, 1, "", true), { liste: equipe, masquees: 0 });
  assert.deepEqual(praticiennesProposees(equipe, null, "", false), { liste: equipe, masquees: 0 }, "prestation supprimée : toute l'équipe");
  assert.deepEqual(praticiennesProposees(equipe, "", "", false), { liste: equipe, masquees: 0 }, "prestation pas encore choisie");
  assert.deepEqual(praticiennesProposees(equipe, 9, "", false), { liste: [], masquees: 3 }, "personne : « Toute l'équipe » reste possible");
});
