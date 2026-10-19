import assert from "node:assert/strict";
import { test } from "node:test";
import { contexteCharge } from "../essais/charge.ts";
import { dispoEssai, MAINTENANT, offreEssai } from "../essais/donnees.ts";
import { creneaux, etatVitrine, FRAICHEUR_MS, refusDemande, resume, type Contexte, type DemandeActive } from "./creneaux.ts";
import { ajouterJours } from "./temps.ts";

type Plages = Record<string, Record<string, [string, string][]>>;
const ctx = (plages: Plages, demandes: DemandeActive[] = [], extra: Partial<Contexte> = {}): Contexte =>
  ({ offre: offreEssai(), dispo: dispoEssai(plages), demandes, maintenant: MAINTENANT, ...extra });
const demande = (o: Partial<DemandeActive>): DemandeActive =>
  ({ id: "d", type: "creneau", prestation: "s60", praticienne: "p1", date: "2026-10-21", debut: 600, fin: 660, accusee_le: null, decision: null, decidee_le: null, ...o });
const heures = (liste: { heure: string }[]) => liste.map((c) => c.heure);
const GENERE = MAINTENANT - 60_000;

test("règle 1 : pas de 15 minutes, la prestation entière tient dans la plage", () => {
  assert.deepEqual(heures(creneaux(ctx({ p1: { "2026-10-21": [["09:00", "10:40"]] } }), "s60", "2026-10-21", "p1")), ["09:00", "09:15", "09:30"]);
});

test("règle 1 : plage qui ne tombe pas sur le pas", () => {
  assert.deepEqual(heures(creneaux(ctx({ p1: { "2026-10-21": [["09:05", "10:30"]] } }), "s30", "2026-10-21", "p1")), ["09:15", "09:30", "09:45", "10:00"]);
});

test("pause de midi : aucun créneau à cheval sur la pause", () => {
  const liste = heures(creneaux(ctx({ p1: { "2026-10-21": [["09:00", "12:00"], ["14:00", "15:00"]] } }), "s60", "2026-10-21", "p1"));
  assert.equal(liste.length, 10);
  assert.ok(liste.includes("11:00") && !liste.includes("11:15") && liste.includes("14:00") && !liste.includes("14:15"));
});

test("règle 1 : une praticienne qui ne pratique pas la prestation n'est jamais proposée", () => {
  assert.deepEqual(creneaux(ctx({ p2: { "2026-10-21": [["09:00", "12:00"]] } }), "s30", "2026-10-21", null), []);
});

test("règle 2 : délai minimal compté dans le fuseau de l'institut, minute entamée comprise", () => {
  const plages = { p1: { "2026-10-20": [["08:00", "12:00"]] as [string, string][] } };
  assert.equal(creneaux(ctx(plages), "s30", "2026-10-20", "p1")[0].heure, "10:00");
  assert.equal(creneaux(ctx(plages, [], { maintenant: MAINTENANT + 30_000 }), "s30", "2026-10-20", "p1")[0].heure, "10:15");
});

test("règle 2 : fuseau de l'institut, pas celui de la machine (23:30 UTC = 00:30 le lendemain à Douala)", () => {
  const maintenant = Date.UTC(2026, 9, 20, 23, 30);
  const plages = { p1: { "2026-10-20": [["09:00", "12:00"]] as [string, string][], "2026-10-21": [["00:00", "02:00"]] as [string, string][] } };
  const c: Contexte = { offre: offreEssai(), dispo: dispoEssai(plages, { genere_le: maintenant - 60_000, delai_minimal: 0 }), demandes: [], maintenant };
  assert.deepEqual(creneaux(c, "s30", "2026-10-20", "p1"), []);
  assert.equal(creneaux(c, "s30", "2026-10-21", "p1")[0].heure, "00:30");
});

test("règle 2 : rien en dehors de du..au, rien pour une prestation inconnue", () => {
  const c = ctx({ p1: { "2026-10-31": [["09:00", "12:00"]] } });
  assert.equal(creneaux(c, "s60", "2026-10-31", "p1").length, 9);
  assert.deepEqual(creneaux(c, "s60", "2026-11-01", "p1"), []);
  assert.deepEqual(creneaux(c, "s99", "2026-10-31", null), []);
});

test("règles 5 et 6 : fraîcheur de 2 heures, offre vide ou absente, plages absentes", () => {
  const plages = { p1: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] } };
  const limite = ctx(plages, [], { dispo: dispoEssai(plages, { genere_le: MAINTENANT - FRAICHEUR_MS }) });
  assert.equal(etatVitrine(limite), "ouvert");
  const perimee = ctx(plages, [], { dispo: dispoEssai(plages, { genere_le: MAINTENANT - FRAICHEUR_MS - 1 }) });
  assert.equal(etatVitrine(perimee), "rappel");
  assert.deepEqual(creneaux(perimee, "s60", "2026-10-21", null), []);
  assert.equal(etatVitrine(ctx(plages, [], { dispo: null })), "rappel");
  assert.equal(etatVitrine(ctx(plages, [], { offre: null })), "ferme");
  assert.equal(etatVitrine(ctx(plages, [], { offre: { ...offreEssai(), prestations: [], praticiennes: [] } })), "ferme");
});

test("règle 3 : une demande en attente avec praticienne retire son créneau aussitôt", () => {
  const c = ctx({ p1: { "2026-10-21": [["09:00", "12:00"]] } }, [demande({})]);
  assert.deepEqual(heures(creneaux(c, "s60", "2026-10-21", "p1")), ["09:00", "11:00"]);
});

test("règle 3 : une demande déjà intégrée aux plages n'est pas retirée une seconde fois", () => {
  const c = ctx({ p1: { "2026-10-21": [["09:00", "12:00"]] } }, [demande({ accusee_le: GENERE - 1 })]);
  assert.equal(creneaux(c, "s60", "2026-10-21", "p1").length, 9);
});

test("décision : refusée avant intégration, le créneau revient", () => {
  const c = ctx({ p1: { "2026-10-21": [["09:00", "12:00"]] } }, [demande({ decision: "refusee", decidee_le: MAINTENANT })]);
  assert.equal(creneaux(c, "s60", "2026-10-21", "p1").length, 9);
});

test("décision : refusée après intégration, le créneau est remis dans les plages jusqu'à la publication suivante", () => {
  const plages = { p1: { "2026-10-21": [["09:00", "10:00"], ["11:00", "12:00"]] as [string, string][] } };
  const sans = ctx(plages);
  assert.deepEqual(heures(creneaux(sans, "s60", "2026-10-21", "p1")), ["09:00", "11:00"]);
  const avec = ctx(plages, [demande({ accusee_le: GENERE - 1, decision: "refusee", decidee_le: GENERE + 1 })]);
  assert.equal(creneaux(avec, "s60", "2026-10-21", "p1").length, 9);
  const avant = ctx(plages, [demande({ accusee_le: GENERE - 2, decision: "refusee", decidee_le: GENERE - 1 })]);
  assert.deepEqual(heures(creneaux(avant, "s60", "2026-10-21", "p1")), ["09:00", "11:00"], "décision déjà connue des plages : rien à remettre");
});

test("règle 4 : capacité « Sans préférence » sur deux praticiennes libres", () => {
  const plages = { p1: { "2026-10-21": [["09:00", "10:00"]] as [string, string][] }, p2: { "2026-10-21": [["09:00", "10:00"]] as [string, string][] } };
  const flottante = (id: string) => demande({ id, praticienne: null, debut: 540, fin: 600 });
  assert.deepEqual(creneaux(ctx(plages), "s60", "2026-10-21", null), [{ heure: "09:00", praticiennes: ["p1", "p2"] }]);
  assert.deepEqual(creneaux(ctx(plages, [flottante("a")]), "s60", "2026-10-21", null), [{ heure: "09:00", praticiennes: ["p1", "p2"] }]);
  assert.deepEqual(creneaux(ctx(plages, [flottante("a"), flottante("b")]), "s60", "2026-10-21", null), []);
  assert.deepEqual(creneaux(ctx(plages, [flottante("a"), flottante("b")]), "s60", "2026-10-21", "p2"), []);
});

test("règle 4 : une demande sans préférence qu'une seule praticienne peut prendre lui est réservée", () => {
  const plages = { p1: { "2026-10-21": [["09:00", "10:00"]] as [string, string][] }, p2: { "2026-10-21": [["09:00", "10:00"]] as [string, string][] } };
  const s30 = demande({ prestation: "s30", praticienne: null, debut: 540, fin: 570 });
  assert.deepEqual(creneaux(ctx(plages, [s30]), "s60", "2026-10-21", null), [{ heure: "09:00", praticiennes: ["p2"] }]);
});

test("règle 4 : une demande sans préférence qui ne chevauche pas n'enlève rien", () => {
  const plages = { p1: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] }, p2: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] } };
  const tard = demande({ praticienne: null, debut: 660, fin: 720 });
  assert.deepEqual(creneaux(ctx(plages, [tard]), "s60", "2026-10-21", null)[0], { heure: "09:00", praticiennes: ["p1", "p2"] });
});

test("refusDemande : codes du contrat", () => {
  const plages = { p1: { "2026-10-21": [["09:00", "12:00"]] as [string, string][] } };
  const c = ctx(plages);
  const d = { type: "creneau" as const, prestation: "s60", praticienne: "p1", date: "2026-10-21", heure: "09:00" };
  assert.equal(refusDemande(c, d), null);
  assert.equal(refusDemande(c, { ...d, praticienne: null }), null);
  assert.equal(refusDemande(c, { ...d, heure: "09:10" }), "indisponible");
  assert.equal(refusDemande(c, { ...d, heure: "11:15" }), "indisponible");
  assert.equal(refusDemande(c, { ...d, prestation: "s99" }), "inconnue");
  assert.equal(refusDemande(c, { ...d, praticienne: "p9" }), "inconnue");
  assert.equal(refusDemande(c, { ...d, prestation: "s30", praticienne: "p2" }), "inconnue");
  const perimee = ctx(plages, [], { dispo: dispoEssai(plages, { genere_le: MAINTENANT - FRAICHEUR_MS - 1 }) });
  assert.equal(refusDemande(perimee, d), "rappel_seulement");
  assert.equal(refusDemande(perimee, { ...d, type: "rappel", date: null, heure: null }), null);
  assert.equal(refusDemande(ctx(plages, [], { offre: null }), { ...d, type: "rappel", date: null, heure: null }), "ferme");
});

test("resume : jours ouverts et trois prochaines disponibilités", () => {
  const c = ctx({ p1: { "2026-10-21": [["09:00", "10:00"]], "2026-10-23": [["14:00", "16:00"]] } });
  const r = resume(c, "s60", null);
  assert.deepEqual(r.jours, ["2026-10-21", "2026-10-23"]);
  assert.deepEqual(r.prochains, [{ date: "2026-10-21", heure: "09:00" }, { date: "2026-10-23", heure: "14:00" }, { date: "2026-10-23", heure: "14:15" }]);
  assert.deepEqual(resume(c, "s60", "p2"), { jours: [], prochains: [] });
});

const jour = (...plages: [string, string][]) => ({ "2026-10-21": plages });
const flottante = (o: Partial<DemandeActive>) => demande({ praticienne: null, ...o });

test("règle 4 : une demande sans préférence contrainte par une autre qui la chevauche (chaîne)", () => {
  const plages = { p1: jour(["08:30", "12:00"]), p2: jour(["08:00", "12:00"]) };
  const x = flottante({ id: "x", debut: 480, fin: 540 });
  const a = flottante({ id: "a", debut: 510, fin: 570 });
  const liste = heures(creneaux(ctx(plages, [x, a]), "s30", "2026-10-21", null));
  assert.ok(!liste.includes("09:00") && !liste.includes("09:15"), `proposés : ${liste.join(", ")}`);
  assert.ok(liste.includes("09:30"));
});

test("règle 4 : l'ordre des demandes existantes ne change pas le résultat", () => {
  const plages = { p1: jour(["09:00", "10:00"]), p2: jour(["09:00", "10:00"]) };
  const a = flottante({ id: "a", debut: 540, fin: 600 });
  const b = flottante({ id: "b", prestation: "s30", debut: 540, fin: 570 });
  assert.deepEqual(creneaux(ctx(plages, [a, b]), "s60", "2026-10-21", null), []);
  assert.deepEqual(creneaux(ctx(plages, [b, a]), "s60", "2026-10-21", null), []);
});

test("règle 2 : délai minimal à cheval sur minuit, dans le fuseau de l'institut", () => {
  const maintenant = Date.UTC(2026, 9, 20, 21, 30); // 22:30 à Douala
  const plages = { p1: { "2026-10-20": [["22:00", "23:30"]] as [string, string][], "2026-10-21": [["00:00", "03:00"]] as [string, string][] } };
  const c: Contexte = { offre: offreEssai(), dispo: dispoEssai(plages, { genere_le: maintenant - 60_000 }), demandes: [], maintenant };
  assert.deepEqual(creneaux(c, "s30", "2026-10-20", "p1"), []);
  assert.equal(creneaux(c, "s30", "2026-10-21", "p1")[0].heure, "00:30");
});

test("règle 3 : autre_horaire libère le créneau, acceptee le garde, un rappel est ignoré", () => {
  const plages = { p1: jour(["09:00", "12:00"]) };
  const nb = (d: DemandeActive) => creneaux(ctx(plages, [d]), "s60", "2026-10-21", "p1").length;
  assert.equal(nb(demande({ decision: "autre_horaire", decidee_le: MAINTENANT })), 9);
  assert.deepEqual(heures(creneaux(ctx(plages, [demande({ decision: "acceptee", decidee_le: MAINTENANT })]), "s60", "2026-10-21", "p1")), ["09:00", "11:00"]);
  assert.equal(nb(demande({ type: "rappel", date: null, debut: null, fin: null })), 9);
  const integree = demande({ accusee_le: GENERE - 1, decision: "autre_horaire", decidee_le: GENERE + 1 });
  assert.equal(nb(integree), 9);
});

test("règle 4 : chaîne réalisable seulement en réutilisant une praticienne sur deux demandes qui ne se chevauchent pas", () => {
  const plages = { p1: jour(["09:00", "12:00"]), p2: jour(["09:00", "12:00"]) };
  const a = flottante({ id: "a", debut: 540, fin: 600 });
  const b = flottante({ id: "b", debut: 570, fin: 630 });
  // La nouvelle demande 10:00-11:00 chevauche b seulement ; a (09:00-10:00) la touche sans la chevaucher.
  // a et b sont distinctes, la nouvelle est distincte de b : avec deux praticiennes, elle reprend celle de a.
  assert.ok(heures(creneaux(ctx(plages, [a, b]), "s60", "2026-10-21", null)).includes("10:00"));
  // Avec une troisième demande qui chevauche a et b, la chaîne est impossible à deux praticiennes.
  const c = flottante({ id: "c", debut: 570, fin: 600 });
  assert.ok(!heures(creneaux(ctx(plages, [a, b, c]), "s60", "2026-10-21", null)).includes("09:30"));
});

test("règle 4 : composante de plus de 12 demandes, créneau refusé par prudence", () => {
  const plages = { p1: jour(["09:00", "16:00"]), p2: jour(["09:00", "16:00"]) };
  const chaine = (n: number) => Array.from({ length: n }, (_, i) => flottante({ id: `d${i}`, debut: 540 + 30 * i, fin: 600 + 30 * i }));
  const propose = (n: number, h: string) => heures(creneaux(ctx(plages, chaine(n)), "s30", "2026-10-21", null)).includes(h);
  assert.equal(propose(11, "14:30"), true, "composante de 12 demandes avec la nouvelle : acceptée");
  assert.equal(propose(13, "15:30"), false, "composante de 14 demandes, réalisable sans le plafond : refusée");
});

test("règle 4 : demande orpheline (hors des plages publiées) ignorée, elle ne bloque pas les créneaux voisins", () => {
  const plages = { p1: jour(["09:00", "12:00"]), p2: jour(["09:00", "12:00"]) };
  const orpheline = flottante({ id: "o", debut: 690, fin: 750 }); // 11:30-12:30, déborde des plages
  const liste = heures(creneaux(ctx(plages, [orpheline]), "s60", "2026-10-21", null));
  assert.ok(liste.includes("10:45") && liste.includes("11:00"));
});

test("règle 4 : budget d'essais épuisé, créneau refusé vite (cas pathologique à dix praticiennes)", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `q${i}`);
  const base = offreEssai();
  const offre = { ...base, praticiennes: ids.map((id) => ({ id, prenom: id, prestations: ["s60"] })) };
  const plages = Object.fromEntries(ids.map((id) => [id, jour(["09:00", "10:00"])]));
  // Onze demandes superposées plus la nouvelle : douze pour dix praticiennes, impossible, constaté au dernier nœud.
  const demandes = Array.from({ length: 11 }, (_, i) => flottante({ id: `d${i}`, debut: 540, fin: 600 }));
  const debut = Date.now();
  const liste = creneaux(ctx(plages, demandes, { offre }), "s60", "2026-10-21", null);
  assert.deepEqual(liste, []);
  assert.ok(Date.now() - debut < 1000, "le calcul doit rester borné");
});

/** Définition de `resume` sans raccourci : tous les créneaux de chaque jour, puis les jours non vides et les trois premiers. */
function resumeComplet(c: Contexte, prestation: string, praticienne: string | null) {
  const jours: string[] = [];
  const prochains: { date: string; heure: string }[] = [];
  for (let d = c.dispo!.du; d <= c.dispo!.au; d = ajouterJours(d, 1)) {
    const liste = creneaux(c, prestation, d, praticienne);
    if (liste.length) jours.push(d);
    for (const x of liste) if (prochains.length < 3) prochains.push({ date: d, heure: x.heure });
  }
  return { jours, prochains };
}

test("resume : salon chargé (8 praticiennes, 30 jours, 60 demandes), même résultat que le calcul complet jour par jour", () => {
  const c = contexteCharge();
  // Matinées pleines les deux premiers jours : huit demandes « sans préférence » de 10:00 à 12:00, chacune une praticienne.
  for (const date of ["2026-10-20", "2026-10-21"]) {
    for (let i = 0; i < 8; i++) c.demandes.push({ id: `m_${date}_${i}`, type: "creneau", prestation: "s60", praticienne: null, date, debut: 600, fin: 720, accusee_le: null, decision: null, decidee_le: null });
  }
  for (const praticienne of [null, "p1", "p3"]) {
    for (const prestation of ["s60", "s30", "inconnue"]) {
      assert.deepEqual(resume(c, prestation, praticienne), resumeComplet(c, prestation, praticienne), `${prestation} ${praticienne}`);
    }
  }
  const r = resume(c, "s60", null);
  assert.equal(r.jours.length, 30);
  assert.deepEqual(r.prochains, [{ date: "2026-10-20", heure: "12:00" }, { date: "2026-10-20", heure: "12:15" }, { date: "2026-10-20", heure: "12:30" }]);
});
