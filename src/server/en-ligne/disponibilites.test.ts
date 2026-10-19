import assert from "node:assert/strict";
import { test } from "node:test";
import { Disponibilites } from "../../../relais/noyau/contrat.ts";
import { SEMAINE_DEFAUT } from "../../shared/horaires.ts";
import { construirePlages, plagesPubliables, PLAGES_PAR_JOUR } from "./disponibilites.ts";
import { baseEssai, CONFIG_ESSAI, insererDemande } from "./essais-en-ligne.ts";

/** Lundi 19 octobre 2026, 08:00 à Douala. */
const LUNDI = Date.parse("2026-10-19T07:00:00Z");
const rdv = (db: ReturnType<typeof baseEssai>, staff: number, date: string, debut: string, fin: string) =>
  db.prepare("INSERT INTO appointments (identifier, client_id, staff_id, scheduled_date, start_time, end_time) VALUES (?, 1, ?, ?, ?, ?)").run(`APT-${date}-${debut}-${staff}`, staff, date, debut, fin);

test("plages : heures de travail moins les occupations, sur l'horizon, conformes au contrat", () => {
  const db = baseEssai();
  rdv(db, 1, "2026-10-20", "10:00", "11:00");
  db.prepare("INSERT INTO blocked_slots (staff_id, blocked_date, start_time, end_time, reason) VALUES (1, '2026-10-22', '12:00', '13:00', 'Pause')").run();
  insererDemande(db, { date: "2026-10-21", start_time: "14:00", end_time: "15:00" });
  insererDemande(db, { date: "2026-10-23", start_time: "14:00", end_time: "15:00", etat: "en_conflit" });
  const c = construirePlages(db, CONFIG_ESSAI, LUNDI);
  assert.deepEqual([c.du, c.au, c.pas, c.delai_minimal], ["2026-10-19", "2026-11-17", 15, 120]);
  assert.deepEqual(c.plages.p1["2026-10-19"], [["09:00", "19:00"]]);
  assert.deepEqual(c.plages.p1["2026-10-20"], [["09:00", "10:00"], ["11:00", "19:00"]], "rendez-vous retiré");
  assert.deepEqual(c.plages.p1["2026-10-21"], [["09:00", "14:00"], ["15:00", "19:00"]], "demande à confirmer retirée");
  assert.deepEqual(c.plages.p1["2026-10-22"], [["09:00", "12:00"], ["13:00", "19:00"]], "créneau bloqué retiré");
  assert.deepEqual(c.plages.p1["2026-10-23"], [["09:00", "19:00"]], "une demande en conflit n'occupe rien");
  assert.equal(c.plages.p1["2026-10-25"], undefined, "dimanche fermé : aucun jour publié");
  assert.equal(c.plages.p3, undefined, "praticienne fermée en ligne");
  const r = Disponibilites.safeParse({ version: 1, genere_le: LUNDI, ...c });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
});

test("journée hachée : plages trop courtes écartées, dix au plus, publication toujours acceptée", () => {
  const db = baseEssai();
  // Un trou de 15 minutes dès 09:00, puis des rendez-vous de 15 minutes toutes les 45 minutes dès 10:00 :
  // treize trous de 30 minutes. La plage trop courte est parmi les dix premières : couper avant de filtrer n'en garderait que neuf.
  const h = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  rdv(db, 1, "2026-10-20", "09:15", "09:30");
  for (let m = 10 * 60; m < 19 * 60; m += 45) rdv(db, 1, "2026-10-20", h(m), h(m + 15));
  const c = construirePlages(db, CONFIG_ESSAI, LUNDI);
  const jour = c.plages.p1["2026-10-20"];
  assert.equal(jour.length, PLAGES_PAR_JOUR);
  assert.ok(!jour.some(([a]) => a === "09:00"), "le trou de 15 minutes est écarté");
  assert.deepEqual(jour[0], ["09:30", "10:00"]);
  assert.ok(jour.every(([a, b]) => Number(b.slice(0, 2)) * 60 + Number(b.slice(3)) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3))) >= 30), "aucune plage plus courte que la pose de vernis");
  assert.ok(Disponibilites.safeParse({ version: 1, genere_le: LUNDI, ...c }).success);
  const bella = construirePlages(db, CONFIG_ESSAI, LUNDI).plages.p2["2026-10-20"];
  assert.deepEqual(bella, [["09:00", "19:00"]], "Bella n'est pas touchée");
});

test("semaine type tronquée aux horaires de l'institut (heuresTravail), soirée jusqu'à 22:00", () => {
  const db = baseEssai();
  db.prepare("UPDATE staff SET horaires = ? WHERE id = 1").run(JSON.stringify({ ...SEMAINE_DEFAUT, lun: [["08:00", "22:00"]] }));
  const institut = { ...SEMAINE_DEFAUT, ven: [["09:30", "22:00"]] as [string, string][] };
  const c = construirePlages(db, { ...CONFIG_ESSAI, institut: { ...CONFIG_ESSAI.institut, horaires: institut } }, LUNDI);
  assert.deepEqual(c.plages.p1["2026-10-19"], [["09:00", "19:00"]]);
  assert.deepEqual(c.plages.p2["2026-10-23"], [["09:30", "22:00"]]);
});

test("horizon et délai minimal réglés par la gérante", () => {
  const c = construirePlages(baseEssai(), { ...CONFIG_ESSAI, horizonJours: 7, delaiHeures: 0 }, LUNDI);
  assert.deepEqual([c.du, c.au, c.delai_minimal], ["2026-10-19", "2026-10-25", 0]);
});

test("plagesPubliables : écarte les plages plus courtes que la durée, puis garde les dix premières", () => {
  const iv = (a: number, b: number) => ({ start: a, end: b });
  assert.deepEqual(plagesPubliables([iv(540, 555), iv(570, 600), iv(600, 660)], 30), [["09:30", "10:00"], ["10:00", "11:00"]]);
  const douze = Array.from({ length: 12 }, (_, i) => iv(540 + i * 60, 540 + i * 60 + 30));
  const gardees = plagesPubliables([iv(0, 5), ...douze], 30);
  assert.equal(gardees.length, PLAGES_PAR_JOUR);
  assert.deepEqual(gardees[0], ["09:00", "09:30"]);
  assert.deepEqual(plagesPubliables([], 30), []);
});

test("minuit à Douala (UTC+1) : le jour de départ suit l'heure locale, pas l'heure UTC", () => {
  const db = baseEssai();
  const c = construirePlages(db, CONFIG_ESSAI, Date.parse("2026-10-19T23:30:00Z"));
  assert.deepEqual([c.du, c.au], ["2026-10-20", "2026-11-18"], "00:30 le 20 octobre à Douala");
  assert.equal(c.plages.p1["2026-10-19"], undefined, "la veille locale n'est pas publiée");
  assert.deepEqual(c.plages.p1["2026-10-20"], [["09:00", "19:00"]]);
  const temoin = construirePlages(db, CONFIG_ESSAI, Date.parse("2026-10-19T22:59:59Z"));
  assert.deepEqual([temoin.du, temoin.au], ["2026-10-19", "2026-11-17"], "23:59:59 le 19 octobre à Douala");
  assert.deepEqual(temoin.plages.p1["2026-10-19"], [["09:00", "19:00"]]);
});
