import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { Base } from "./base.ts";
import { baseD1 } from "./d1.ts";
import { d1Simule } from "./d1-simule.ts";
import { CONSERVATION_MS, Depot, VERIFICATION_MS, formatCurseur, purgerTout, type NouvelleDemande } from "./depot.ts";
import { baseSqlite, migrerSqlite } from "./sqlite.ts";

const T = 1_792_000_000_000;
const SALON = "eclat";

function nouvelle(o: Partial<NouvelleDemande> = {}): NouvelleDemande {
  return {
    id: "d_1", jeton: "j_1", type: "creneau", prestation: "s60", prestation_nom: { fr: "Soin visage", en: "Facial" },
    praticienne: "p1", date: "2026-10-21", debut: 600, fin: 660, souhait: null,
    cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" }, note: "Première visite",
    telephone_empreinte: "e1", recue_le: T, ...o,
  };
}

/** Enregistre une demande et la déclare contrôlée (comme `deposer`). */
async function ajouter(depot: Depot, d: NouvelleDemande): Promise<number> {
  const curseur = await depot.ajouterDemande(d);
  await depot.confirmer(d.id);
  return curseur;
}

const bases: [string, () => Base][] = [
  ["node:sqlite", () => { const db = new DatabaseSync(":memory:"); migrerSqlite(db); return baseSqlite(db); }],
  ["D1 simulée", () => { const db = new DatabaseSync(":memory:"); migrerSqlite(db); return baseD1(d1Simule(db)); }],
];

test("migrations : rejouées sans effet", () => {
  const db = new DatabaseSync(":memory:");
  migrerSqlite(db);
  migrerSqlite(db);
  assert.deepEqual((db.prepare("SELECT nom FROM _migrations").all() as { nom: string }[]).map((l) => l.nom), ["0001_initial.sql"]);
});

test("curseur : douze chiffres", () => {
  assert.equal(formatCurseur(123), "000000000123");
});

for (const [nom, fabriquer] of bases) {
  test(`${nom} : document écrit, même version acceptée, version plus ancienne refusée`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    assert.equal(await depot.lireDocument("offre"), null);
    assert.equal(await depot.versionDocument("offre"), null);
    assert.equal(await depot.ecrireDocument("offre", 5, { a: 1 }, T), true);
    assert.equal(await depot.ecrireDocument("offre", 5, { a: 2 }, T), true);
    assert.equal(await depot.ecrireDocument("offre", 4, { a: 3 }, T), false);
    assert.deepEqual(await depot.lireDocument("offre"), { a: 2 });
    assert.equal(await depot.versionDocument("offre"), 5);
    assert.equal(await depot.versionDocument("disponibilites"), null);
  });

  test(`${nom} : demandes non accusées dans l'ordre du curseur, avec limite et reprise après un curseur`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    for (const i of [1, 2, 3]) await ajouter(depot, nouvelle({ id: `d_${i}`, jeton: `j_${i}`, recue_le: T + i }));
    const toutes = await depot.nonAccusees(null, 50, T);
    assert.deepEqual(toutes.map((d) => d.id), ["d_1", "d_2", "d_3"]);
    assert.deepEqual(toutes[0], {
      id: "d_1", curseur: formatCurseur(1), type: "creneau", recue_le: T + 1, prestation: "s60", praticienne: "p1",
      date: "2026-10-21", heure: "10:00", souhait: null, cliente: { nom: "Mireille Ngo", telephone: "+237699123456", langue: "fr" },
      note: "Première visite", acompte: null,
    });
    assert.deepEqual((await depot.nonAccusees(1, 1, T)).map((d) => d.id), ["d_2"]);
    assert.deepEqual(await depot.nonAccusees(3, 50, T), []);
    assert.equal(await depot.enAttente(), 3);
  });

  test(`${nom} : l'accusé efface nom, téléphone et note ; il est idempotent ; demande inconnue`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    await ajouter(depot, nouvelle());
    assert.equal(await depot.accuser("d_1", T + 10), true);
    assert.equal(await depot.accuser("d_1", T + 20), true);
    assert.equal(await depot.accuser("d_x", T), false);
    assert.deepEqual(await depot.nonAccusees(null, 50, T), []);
    assert.deepEqual(await depot.pourEssai("d_1"), { id: "d_1", cliente: null, note: null, accusee_le: T + 10, decision: null });
    assert.equal(await depot.pourEssai("d_x"), null);
    assert.equal(await depot.enAttente(), 0);
  });

  test(`${nom} : décision idempotente, remplacée par une autre, demande inconnue`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    await ajouter(depot, nouvelle());
    const acceptee = { decision: "acceptee" as const, horaire: null, message: null };
    assert.equal(await depot.decider("d_1", acceptee, T + 1), true);
    assert.equal(await depot.decider("d_1", acceptee, T + 2), true);
    assert.equal((await depot.demandesActives("2026-10-20"))[0].decidee_le, T + 1, "même décision : rien ne change");
    assert.equal(await depot.decider("d_1", { decision: "refusee", horaire: null, message: null }, T + 3), true);
    const active = (await depot.demandesActives("2026-10-20"))[0];
    assert.equal(active.decision, "refusee");
    assert.equal(active.decidee_le, T + 3);
    assert.equal(await depot.decider("d_x", acceptee, T), false);
  });

  test(`${nom} : demandes actives depuis une date, rappels exclus`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    await ajouter(depot, nouvelle({ id: "d_1", jeton: "j_1", date: "2026-10-19" }));
    await ajouter(depot, nouvelle({ id: "d_2", jeton: "j_2", date: "2026-10-21" }));
    await ajouter(depot, nouvelle({ id: "d_3", jeton: "j_3", type: "rappel", date: null, debut: null, fin: null, souhait: { jours: ["lun"], moments: ["matin"], precision: "" } }));
    assert.deepEqual(await depot.demandesActives("2026-10-20"), [{ id: "d_2", type: "creneau", prestation: "s60", praticienne: "p1", date: "2026-10-21", debut: 600, fin: 660, accusee_le: null, decision: null, decidee_le: null }]);
  });

  test(`${nom} : demandes en attente par téléphone, oubliées à la décision`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    await ajouter(depot, nouvelle({ id: "d_1", jeton: "j_1" }));
    await ajouter(depot, nouvelle({ id: "d_2", jeton: "j_2" }));
    assert.equal(await depot.enAttenteParTelephone("e1", "2026-10-14"), 2);
    await depot.decider("d_1", { decision: "refusee", horaire: null, message: null }, T);
    assert.equal(await depot.enAttenteParTelephone("e1", "2026-10-14"), 1);
    assert.equal(await depot.enAttenteParTelephone("e2", "2026-10-14"), 0);
  });

  test(`${nom} : compteur d'appels par fenêtre, remis à un à la fenêtre suivante`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    assert.equal(await depot.compterAppel("ip:a", 100), 1);
    assert.equal(await depot.compterAppel("ip:a", 100), 2);
    assert.equal(await depot.compterAppel("ip:b", 100), 1);
    assert.equal(await depot.compterAppel("ip:a", 101), 1);
  });

  test(`${nom} : compteur monotone, une fenêtre plus ancienne ne remet pas à zéro`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    assert.equal(await depot.compterAppel("ip:a", 100), 1);
    assert.equal(await depot.compterAppel("ip:a", 101), 1);
    assert.equal(await depot.compterAppel("ip:a", 100), 1, "ancienne fenêtre : compte inchangé");
    assert.equal(await depot.compterAppel("ip:a", 101), 2, "la fenêtre courante n'a pas été remise à zéro");
  });

  test(`${nom} : rang rendu à l'ajout, demandes de rang inférieur, retrait limité au salon`, async () => {
    const base = fabriquer();
    const depot = new Depot(base, SALON);
    const voisin = new Depot(base, "voisin");
    const c1 = await ajouter(depot, nouvelle({ id: "d_1", jeton: "j_1" }));
    const c2 = await ajouter(depot, nouvelle({ id: "d_2", jeton: "j_2" }));
    assert.ok(c2 > c1);
    assert.equal(formatCurseur(c1), (await depot.nonAccusees(null, 1, T))[0].curseur);
    assert.deepEqual((await depot.demandesActives("2026-10-20", c2)).map((d) => d.id), ["d_1"]);
    assert.deepEqual((await depot.demandesActives("2026-10-20")).map((d) => d.id), ["d_1", "d_2"]);
    assert.equal(await voisin.retirer("d_2"), false, "un salon ne retire pas la demande d'un autre");
    assert.equal(await depot.retirer("d_2"), true);
    assert.equal(await depot.retirer("d_2"), false);
    assert.deepEqual((await depot.demandesActives("2026-10-20")).map((d) => d.id), ["d_1"]);
  });

  test(`${nom} : suivi par jeton, nom de la prestation gardé, état après décision`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    await ajouter(depot, nouvelle());
    assert.deepEqual(await depot.suivi("j_1"), { type: "creneau", prestation: { fr: "Soin visage", en: "Facial" }, date: "2026-10-21", heure: "10:00", souhait: null, etat: "en_attente", horaire: null, message: null, issue: null });
    const horaire = { date: "2026-10-22", heure: "11:00", praticienne: "Awa" };
    await depot.decider("d_1", { decision: "autre_horaire", horaire, message: { fr: "Mercredi ?", en: "Wednesday?" } }, T);
    const s = await depot.suivi("j_1");
    assert.equal(s?.etat, "autre_horaire");
    assert.deepEqual(s?.horaire, horaire);
    await depot.decider("d_1", { decision: "acceptee", horaire: null, message: null }, T);
    assert.equal((await depot.suivi("j_1"))?.etat, "confirmee");
    await depot.decider("d_1", { decision: "traitee", horaire: null, message: null, issue: "sans_suite" }, T);
    const close = await depot.suivi("j_1");
    assert.deepEqual([close?.etat, close?.issue], ["traitee", "sans_suite"]);
    assert.equal(await depot.suivi("j_x"), null);
  });

  test(`${nom} : deux salons dans la même base ne voient rien l'un de l'autre`, async () => {
    const base = fabriquer();
    const eclat = new Depot(base, "eclat");
    const voisin = new Depot(base, "voisin");
    await eclat.ecrireDocument("offre", 9, { de: "eclat" }, T);
    await ajouter(eclat, nouvelle());
    await eclat.compterAppel("ip:a", 100);
    assert.equal(await voisin.lireDocument("offre"), null);
    assert.equal(await voisin.ecrireDocument("offre", 1, { de: "voisin" }, T), true, "versions propres à chaque salon");
    assert.deepEqual(await voisin.nonAccusees(null, 50, T), []);
    assert.equal(await voisin.enAttente(), 0);
    assert.equal(await voisin.suivi("j_1"), null);
    assert.equal(await voisin.pourEssai("d_1"), null);
    assert.equal(await voisin.accuser("d_1", T), false, "un salon n'accuse pas la demande d'un autre");
    assert.equal(await voisin.decider("d_1", { decision: "refusee", horaire: null, message: null }, T), false);
    assert.equal(await voisin.enAttenteParTelephone("e1", "2026-10-14"), 0);
    assert.equal(await voisin.compterAppel("ip:a", 100), 1);
    assert.deepEqual(await voisin.demandesActives("2026-10-20"), []);
    assert.equal(await eclat.enAttente(), 1);
    await eclat.effacerTout();
    assert.equal(await eclat.lireDocument("offre"), null);
    assert.equal(await eclat.enAttente(), 0);
    assert.equal(await eclat.compterAppel("ip:a", 100), 1, "compteurs du salon effacés");
    assert.deepEqual(await voisin.lireDocument("offre"), { de: "voisin" }, "l'autre salon est intact");
  });

  test(`${nom} : purge à 30 jours, tous salons confondus`, async () => {
    const base = fabriquer();
    const depot = new Depot(base, SALON);
    const voisin = new Depot(base, "voisin");
    const vieux = T - CONSERVATION_MS - 1;
    await ajouter(depot, nouvelle({ id: "d_jamais", jeton: "j_a", recue_le: vieux }));
    await ajouter(depot, nouvelle({ id: "d_recente", jeton: "j_b", recue_le: T }));
    await ajouter(depot, nouvelle({ id: "d_decidee", jeton: "j_c", recue_le: vieux }));
    await depot.accuser("d_decidee", vieux);
    await depot.decider("d_decidee", { decision: "refusee", horaire: null, message: null }, vieux);
    await ajouter(depot, nouvelle({ id: "d_accusee", jeton: "j_d", recue_le: vieux }));
    await depot.accuser("d_accusee", vieux);
    await ajouter(voisin, nouvelle({ id: "d_voisin", jeton: "j_e", recue_le: vieux }));
    await depot.compterAppel("ip:vieux", vieux);
    await depot.compterAppel("ip:recent", T - 60_000);
    assert.equal(await purgerTout(base, T), 3);
    assert.equal(await depot.compterAppel("ip:vieux", vieux), 1, "vieux compteur effacé : il repart de un");
    assert.equal(await depot.compterAppel("ip:recent", T - 60_000), 2, "compteur récent gardé");
    assert.equal(await depot.pourEssai("d_jamais"), null);
    assert.equal(await depot.pourEssai("d_decidee"), null);
    assert.equal(await voisin.pourEssai("d_voisin"), null);
    assert.notEqual(await depot.pourEssai("d_recente"), null);
    assert.notEqual(await depot.pourEssai("d_accusee"), null, "accusée mais pas encore décidée : gardée");
  });

  test(`${nom} : relevée mais jamais décidée, effacée 30 jours après son créneau (rappel : après sa réception)`, async () => {
    const base = fabriquer();
    const depot = new Depot(base, SALON);
    const voisin = new Depot(base, "voisin");
    const vieux = T - CONSERVATION_MS - 1;
    const dateDe = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const cas: [string, Partial<NouvelleDemande>][] = [
      ["d_creneau_vieux", { date: dateDe(vieux - 24 * 60 * 60 * 1000), recue_le: vieux - 2 * 24 * 60 * 60 * 1000 }],
      ["d_creneau_proche", { date: dateDe(T - 10 * 24 * 60 * 60 * 1000), recue_le: vieux }],
      ["d_rappel_vieux", { type: "rappel", date: null, debut: null, fin: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" }, recue_le: vieux }],
      ["d_rappel_recent", { type: "rappel", date: null, debut: null, fin: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" }, recue_le: T - 1000 }],
    ];
    for (const [id, o] of cas) {
      await ajouter(depot, nouvelle({ id, jeton: `j_${id}`, ...o }));
      await depot.accuser(id, o.recue_le!);
    }
    await ajouter(voisin, nouvelle({ id: "d_voisin", jeton: "j_voisin", ...cas[0][1] }));
    await voisin.accuser("d_voisin", vieux);
    assert.equal(await purgerTout(base, T), 3);
    assert.equal(await depot.pourEssai("d_creneau_vieux"), null);
    assert.equal(await depot.pourEssai("d_rappel_vieux"), null);
    assert.equal(await voisin.pourEssai("d_voisin"), null, "tous salons confondus");
    assert.notEqual(await depot.pourEssai("d_creneau_proche"), null, "créneau passé depuis moins de 30 jours : gardée");
    assert.notEqual(await depot.pourEssai("d_rappel_recent"), null);
  });

  test(`${nom} : limite par numéro, une demande de créneau passée ne compte plus, même jamais décidée`, async () => {
    const base = fabriquer();
    const depot = new Depot(base, SALON);
    await ajouter(depot, nouvelle({ id: "d_hier", jeton: "j_hier", date: "2026-10-13" }));
    await ajouter(depot, nouvelle({ id: "d_jour", jeton: "j_jour", date: "2026-10-14" }));
    await ajouter(depot, nouvelle({ id: "d_rappel", jeton: "j_rappel", type: "rappel", date: null, debut: null, fin: null, souhait: { jours: ["sam"], moments: ["matin"], precision: "" } }));
    await depot.accuser("d_hier", T);
    assert.equal(await depot.enAttenteParTelephone("e1", "2026-10-14"), 2, "créneau d'hier exclu, celui du jour et le rappel comptent");
    assert.equal(await depot.enAttenteParTelephone("e1", "2026-10-13"), 3);
    assert.equal(await new Depot(base, "voisin").enAttenteParTelephone("e1", "2026-10-01"), 0, "propre au salon");
  });
}

for (const [nom, fabriquer] of bases) {
  test(`${nom} : demande non contrôlée invisible, relevé retenu derrière elle, suivi et accusé introuvables`, async () => {
    const depot = new Depot(fabriquer(), SALON);
    await ajouter(depot, nouvelle({ id: "d_1", jeton: "j_1", recue_le: T }));
    const c2 = await depot.ajouterDemande(nouvelle({ id: "d_2", jeton: "j_2", recue_le: T }));
    await ajouter(depot, nouvelle({ id: "d_3", jeton: "j_3", recue_le: T }));
    assert.deepEqual((await depot.nonAccusees(null, 50, T)).map((d) => d.id), ["d_1"], "d_3 retenue derrière le rang non contrôlé d_2");
    assert.equal(await depot.enAttente(), 2);
    assert.equal(await depot.suivi("j_2"), null);
    assert.equal(await depot.pourEssai("d_2"), null);
    assert.equal(await depot.accuser("d_2", T), false);
    assert.equal((await depot.demandesActives("2026-10-01")).length, 3, "les créneaux comptent aussi la demande non contrôlée");
    assert.equal((await depot.demandesActives("2026-10-01", c2)).length, 1);
    assert.equal(await depot.confirmer("d_2"), true);
    assert.equal(await depot.confirmer("d_inconnue"), false);
    assert.deepEqual((await depot.nonAccusees(null, 50, T)).map((d) => d.id), ["d_1", "d_2", "d_3"]);
  });

  test(`${nom} : demande non contrôlée de plus d'une minute purgée et ne retient plus le relevé`, async () => {
    const base = fabriquer();
    const depot = new Depot(base, SALON);
    const voisin = new Depot(base, "voisin");
    await depot.ajouterDemande(nouvelle({ id: "d_1", jeton: "j_1", recue_le: T }));
    await ajouter(depot, nouvelle({ id: "d_2", jeton: "j_2", recue_le: T }));
    await voisin.ajouterDemande(nouvelle({ id: "d_v", jeton: "j_v", recue_le: T }));
    const plus_tard = T + VERIFICATION_MS + 1;
    assert.deepEqual((await depot.nonAccusees(null, 50, plus_tard)).map((d) => d.id), ["d_2"], "périmée : ne retient plus");
    await depot.purgerNonVerifiees(plus_tard);
    assert.equal((await depot.demandesActives("2026-10-01")).length, 1);
    assert.equal((await voisin.demandesActives("2026-10-01")).length, 1, "l'autre salon n'est pas touché");
    await purgerTout(base, plus_tard);
    assert.equal((await voisin.demandesActives("2026-10-01")).length, 0);
  });
}
