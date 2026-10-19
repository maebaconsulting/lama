import assert from "node:assert/strict";
import { test } from "node:test";
import { SEMAINE_DEFAUT } from "../../shared/horaires.ts";
import { busyOn } from "../transferts.ts";
import { DemandeRelais, enregistrerDemande, lireDemande, nomComplet, nomsProches, rechercherFiche, type ContexteArrivee } from "./demandes.ts";
import { FORME_NOM, FORME_PRENOM } from "../../../relais/noyau/prenom.ts";
import { baseEssai, reglagesMessages } from "./essais-en-ligne.ts";
import { FORME_NOM_LAMA, FORME_PRENOM_LAMA } from "./identite.ts";
import { personneDe, texteMessage } from "./messages-en-ligne.ts";

/** Lundi 19 octobre 2026, 08:00 à Douala ; demandes pour le mardi 20. */
const T = Date.parse("2026-10-19T07:00:00Z");
const ctx = (): ContexteArrivee => ({ institut: SEMAINE_DEFAUT, indicatif: "237", messages: reglagesMessages(), maintenant: T });
let suite = 0;
const creneau = (o: Record<string, unknown> = {}) => DemandeRelais.parse({
  id: `d_${++suite}`, curseur: String(suite).padStart(6, "0"), type: "creneau", recue_le: T - 60_000,
  prestation: "s1", praticienne: "p1", date: "2026-10-20", heure: "10:00", souhait: null,
  cliente: { nom: "Mireille Ngo", telephone: "+237699000111", langue: "fr" }, note: "Première visite", acompte: null, ...o,
});
const rdv = (db: ReturnType<typeof baseEssai>, staff: number, debut: string, fin: string) =>
  db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time) VALUES (?, 1, ?, '2026-10-20', ?, ?)").run(`APT-${staff}-${debut}`, staff, debut, fin);

test("praticienne demandée et libre : à confirmer dans sa colonne ; la même demande relevée deux fois n'est enregistrée qu'une fois", () => {
  const db = baseEssai();
  const d = creneau();
  const premier = enregistrerDemande(db, d, ctx());
  assert.equal(premier.nouvelle, true);
  const l = lireDemande(db, premier.id)!;
  assert.deepEqual([l.etat, l.staff_id, l.staff_demande_id, l.sans_preference, l.start_time, l.end_time, l.prestation_nom, l.note, l.fiche], ["a_confirmer", 1, 1, 0, "10:00", "11:00", "Soin visage", "Première visite", "nouvelle"]);
  assert.deepEqual(enregistrerDemande(db, d, ctx()), { id: premier.id, nouvelle: false });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM demandes_en_ligne").get() as { n: number }).n, 1);
  assert.deepEqual(busyOn(db, 1, "2026-10-20").map((b) => b.kind), ["demande"]);
});

test("« Sans préférence » : la praticienne libre la moins chargée qui pratique la prestation", () => {
  const db = baseEssai();
  rdv(db, 2, "15:00", "16:00");
  const visage = lireDemande(db, enregistrerDemande(db, creneau({ praticienne: null }), ctx()).id)!;
  assert.deepEqual([visage.etat, visage.staff_id, visage.sans_preference], ["a_confirmer", 1, 1], "Awa : aucun rendez-vous ce jour-là");
  const second = lireDemande(db, enregistrerDemande(db, creneau({ praticienne: null, heure: "10:30" }), ctx()).id)!;
  assert.equal(second.staff_id, 2, "Awa est prise à 10:30 par la demande précédente");
  const vernis = lireDemande(db, enregistrerDemande(db, creneau({ praticienne: null, prestation: "s2", heure: "16:00" }), ctx()).id)!;
  assert.equal(vernis.staff_id, 1, "seule Awa pose le vernis");
});

test("« Sans préférence » : la moins chargée gagne même quand l'autre vient d'abord par le nom, égalité au nom, personne de libre", () => {
  const db = baseEssai();
  rdv(db, 1, "15:00", "16:00");
  const bella = lireDemande(db, enregistrerDemande(db, creneau({ praticienne: null }), ctx()).id)!;
  assert.equal(bella.staff_id, 2, "Awa a un rendez-vous ce jour-là, Bella aucun");
  // Bella porte maintenant une demande à confirmer : une charge chacune, Awa passe avant par le nom.
  const egalite = lireDemande(db, enregistrerDemande(db, creneau({ praticienne: null, heure: "12:00" }), ctx()).id)!;
  assert.equal(egalite.staff_id, 1, "charges égales : la première par nom");
  const autre = baseEssai();
  rdv(autre, 1, "10:00", "11:00");
  rdv(autre, 2, "10:00", "11:00");
  const personne = lireDemande(autre, enregistrerDemande(autre, creneau({ praticienne: null }), ctx()).id)!;
  assert.deepEqual([personne.etat, personne.staff_id, personne.sans_preference], ["en_conflit", null, 1]);
});

test("en conflit : praticienne prise, fermée en ligne, horaire hors des heures ; une demande en conflit n'occupe rien", () => {
  const db = baseEssai();
  rdv(db, 1, "10:00", "11:00");
  const prise = lireDemande(db, enregistrerDemande(db, creneau({ heure: "10:30" }), ctx()).id)!;
  assert.deepEqual([prise.etat, prise.staff_id, prise.staff_demande_id], ["en_conflit", null, 1]);
  db.exec("UPDATE staff SET en_ligne = 0 WHERE id = 2");
  assert.equal(lireDemande(db, enregistrerDemande(db, creneau({ praticienne: "p2", heure: "14:00" }), ctx()).id)!.etat, "en_conflit");
  assert.equal(lireDemande(db, enregistrerDemande(db, creneau({ heure: "18:30" }), ctx()).id)!.etat, "en_conflit", "finirait après 19:00");
  assert.equal(lireDemande(db, enregistrerDemande(db, creneau({ date: "2026-10-25" }), ctx()).id)!.etat, "en_conflit", "dimanche fermé");
  assert.deepEqual(busyOn(db, 1, "2026-10-20").map((b) => b.kind), ["appointment"]);
});

test("prestation retirée entre-temps : décochée ou supprimée, la demande arrive en conflit et reste lisible", () => {
  const db = baseEssai();
  db.exec("UPDATE services SET en_ligne = 0 WHERE id = 1");
  const decochee = lireDemande(db, enregistrerDemande(db, creneau(), ctx()).id)!;
  assert.deepEqual([decochee.etat, decochee.service_id, decochee.prestation_nom, decochee.staff_id], ["en_conflit", 1, "Soin visage", null]);
  db.exec("DELETE FROM services WHERE id = 2");
  const supprimee = lireDemande(db, enregistrerDemande(db, creneau({ prestation: "s2" }), ctx()).id)!;
  assert.deepEqual([supprimee.etat, supprimee.service_id, supprimee.prestation_ref, supprimee.prestation_nom], ["en_conflit", null, "s2", ""]);
  assert.equal(lireDemande(db, enregistrerDemande(db, creneau({ prestation: "zz" }), ctx()).id)!.etat, "en_conflit", "identifiant inconnu");
});

test("demande de rappel : à rappeler, souhait gardé, n'occupe pas l'agenda", () => {
  const db = baseEssai();
  const souhait = { jours: ["lun", "sam"], moments: ["matin"], precision: "après 10 h" };
  const l = lireDemande(db, enregistrerDemande(db, creneau({ type: "rappel", date: null, heure: null, praticienne: null, souhait }), ctx()).id)!;
  assert.deepEqual([l.etat, l.date, l.start_time, l.staff_id], ["a_rappeler", null, null, null]);
  assert.deepEqual(JSON.parse(l.souhait!), souhait);
  assert.deepEqual(busyOn(db, 1, "2026-10-20"), []);
});

test("recherche de fiche : même numéro et nom proche, même numéro autre nom, numéro inconnu", () => {
  const db = baseEssai();
  assert.deepEqual(rechercherFiche(db, "aicha mbarga", "+237699123456", "237"), { fiche: "connue", client_id: 1 });
  assert.deepEqual(rechercherFiche(db, "Aïcha", "+237699123456", "237"), { fiche: "connue", client_id: 1 }, "prénom seul");
  assert.deepEqual(rechercherFiche(db, "Brenda Mbarga", "+237699123456", "237"), { fiche: "a_verifier", client_id: 1 });
  assert.deepEqual(rechercherFiche(db, "Aïcha Mbarga", "+237655000000", "237"), { fiche: "nouvelle", client_id: null });
  assert.equal(nomsProches("Ngo Mireille", "mireille NGO"), true);
  assert.equal(nomsProches("Mireille", ""), false);
});

test("demande illisible refusée par le schéma : téléphone hors E.164, type inconnu", () => {
  for (const o of [{ cliente: { nom: "A", telephone: "699000111", langue: "fr" } }, { type: "visite" }]) {
    assert.equal(DemandeRelais.safeParse({ ...creneau(), ...o }).success, false, JSON.stringify(o));
  }
});

test("prénom transmis par le relais : gardé à part, nom complet « Prénom Nom » ; sans prénom (relais ancien), rien n'est deviné", () => {
  const db = baseEssai();
  const avec = lireDemande(db, enregistrerDemande(db, creneau({ cliente: { prenom: "Bertille", nom: "Bertille Essai", telephone: "+237690000101", langue: "fr" } }), ctx()).id)!;
  assert.deepEqual([avec.cliente_prenom, avec.cliente_nom], ["Bertille", "Bertille Essai"]);
  const ancien = lireDemande(db, enregistrerDemande(db, creneau({ heure: "14:00", cliente: { nom: "Essai Bertille", telephone: "+237690000202", langue: "fr" } }), ctx()).id)!;
  assert.deepEqual([ancien.cliente_prenom, ancien.cliente_nom], [null, "Essai Bertille"]);
  const tiers = lireDemande(db, enregistrerDemande(db, creneau({ heure: "16:00", cliente: { prenom: "Carine", nom: "Mbia", telephone: "+237690000303", langue: "fr" } }), ctx()).id)!;
  assert.equal(tiers.cliente_nom, "Carine Mbia", "site tiers qui n'envoie que le nom de famille");
});

test("nom complet : le nom transmis est gardé dès que tous les mots du prénom y figurent, à n'importe quelle place", () => {
  assert.equal(nomComplet("Mireille", "Ngo Mireille"), "Ngo Mireille");
  assert.equal(nomComplet("Mireille", "Mireille Ngo"), "Mireille Ngo");
  assert.equal(nomComplet("Carine", "Mbia"), "Carine Mbia");
  assert.equal(nomComplet("Marie Claire", "Ngo Claire Marie"), "Ngo Claire Marie");
  assert.equal(nomComplet("Marie Claire", "Ngo Marie"), "Marie Claire Ngo Marie");
});

test("prénom libre (saut de ligne, lien, chiffres, 4 mots) : ignoré, la demande reste ; prénoms usuels gardés", () => {
  for (const prenom of ["votre compte est suspendu\nappelez le +237 6xx", "www.x.com", "http://x.cm", "Awa 2", "Marie Claire Anne Ngo", "Awa  Ndiaye", "x@exemple.cm", "."]) {
    const r = DemandeRelais.safeParse({ ...creneau(), cliente: { prenom, nom: "Awa Ndiaye", telephone: "+237690000404", langue: "fr" } });
    assert.ok(r.success, prenom);
    assert.equal(r.data.cliente.prenom, undefined, JSON.stringify(prenom));
  }
  for (const prenom of ["Marie-Claire", "N'Dri", "N’Dri", "Ngo Bassa", "Zoë", "Jean P."]) {
    const r = DemandeRelais.safeParse({ ...creneau(), cliente: { prenom, nom: "Awa Ndiaye", telephone: "+237690000404", langue: "fr" } });
    assert.ok(r.success && r.data.cliente.prenom === prenom, prenom);
  }
});

test("prénom illisible : ignoré, la demande n'est jamais perdue", () => {
  for (const prenom of ["", "   ", 12, "x".repeat(61)]) {
    const r = DemandeRelais.safeParse({ ...creneau(), cliente: { prenom, nom: "Awa Ndiaye", telephone: "+237690000404", langue: "fr" } });
    assert.ok(r.success, String(prenom));
    assert.equal(r.data.cliente.prenom, undefined);
  }
  const champs = DemandeRelais.safeParse({ ...creneau(), champ_futur: 1, cliente: { nom: "Awa Ndiaye", telephone: "+237690000404", langue: "fr", champ_futur: 1 } });
  assert.ok(champs.success, "champs ajoutés plus tard par le relais : ignorés");
});

test("nom illisible ou piégé : nettoyé, jamais une raison de perdre la demande ; {nom} vide s'il sort de la forme", () => {
  const nom = (n: string) => DemandeRelais.parse({ ...creneau(), cliente: { nom: n, telephone: "+237690000505", langue: "fr" } }).cliente.nom;
  assert.equal(nom("  Mireille\n\tNgo\u00a0 "), "Mireille Ngo");
  assert.equal(nom("Awa\u200b Ndiaye\u202e"), "Awa Ndiaye");
  assert.equal(nom("appelez le\n+237 6xx"), "appelez le +237 6xx");
  assert.equal(nom("x".repeat(300)).length, 120, "trop long : coupé, pas refusé");
  assert.equal(nom("\u200b\n "), "+237690000505", "rien de lisible : le numéro nomme la fiche");
  const db = baseEssai();
  const d = lireDemande(db, enregistrerDemande(db, creneau({ cliente: { nom: "Ngo\nappelez www.x.com\u202e", telephone: "+237690000606", langue: "fr" } }), ctx()).id)!;
  assert.equal(d.cliente_nom, "Ngo appelez www.x.com", "la fiche reçoit le nom nettoyé");
  const texte = texteMessage(reglagesMessages(), "en_ligne_refus", "fr", personneDe(d), { date: null, heure: null, praticienne: "Awa", prestation: { fr: "Soin", en: "Care" } });
  assert.ok(!texte.includes("www.x.com"), texte);
  const reglages = reglagesMessages();
  reglages.texts.en_ligne_refus.fr = "Bonjour {nom}|";
  assert.equal(texteMessage(reglages, "en_ligne_refus", "fr", personneDe(d), { date: null, heure: null, praticienne: "Awa", prestation: { fr: "", en: "" } }), "Bonjour |");
  for (const ok of ["Ngo Bassa Mireille", "N'Dri Kouassi", "Marie-Claire Ébodé"]) {
    const bon = { ...d, cliente_nom: ok };
    assert.equal(texteMessage(reglages, "en_ligne_refus", "fr", personneDe(bon), { date: null, heure: null, praticienne: "Awa", prestation: { fr: "", en: "" } }), `Bonjour ${ok}|`);
  }
});

test("formes du prénom et du nom : la copie de lama est identique à celle du relais", () => {
  assert.equal(FORME_PRENOM_LAMA.source, FORME_PRENOM.source);
  assert.equal(FORME_PRENOM_LAMA.flags, FORME_PRENOM.flags);
  assert.equal(FORME_NOM_LAMA.source, FORME_NOM.source);
  assert.equal(FORME_NOM_LAMA.flags, FORME_NOM.flags);
});

test("nom complet : prénom déjà en tête du nom gardé tel quel, sinon ajouté devant", () => {
  assert.equal(nomComplet("Mireille", "Mireille Ngo"), "Mireille Ngo");
  assert.equal(nomComplet("mireille", "Mireille  Ngo"), "Mireille Ngo");
  assert.equal(nomComplet("Marie Claire", "Marie Claire Abena"), "Marie Claire Abena");
  assert.equal(nomComplet("Mireille", "Ngo"), "Mireille Ngo");
  assert.equal(nomComplet(null, " Essai Bertille "), "Essai Bertille");
});
