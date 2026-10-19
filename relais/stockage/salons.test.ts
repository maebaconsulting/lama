import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { IdSalon, Origine } from "../noyau/salon.ts";
import type { Base } from "./base.ts";
import { baseD1 } from "./d1.ts";
import { d1Simule } from "./d1-simule.ts";
import { Depot } from "./depot.ts";
import { APPEL_NOTE_MS, Salons } from "./salons.ts";
import { baseSqlite, migrerSqlite } from "./sqlite.ts";

const MAITRE = "m".repeat(48);
const T = 1_792_000_000_000;

const bases: [string, () => Base][] = [
  ["node:sqlite", () => { const db = new DatabaseSync(":memory:"); migrerSqlite(db); return baseSqlite(db); }],
  ["D1 simulée", () => { const db = new DatabaseSync(":memory:"); migrerSqlite(db); return baseD1(d1Simule(db)); }],
];

test("identifiant de salon : minuscules, chiffres, tirets ; adresses du relais réservées", () => {
  for (const ok of ["eclat", "a", "institut-eclat-2", "x".repeat(32)]) assert.equal(IdSalon.safeParse(ok).success, true, ok);
  for (const ko of ["", "Eclat", "-eclat", "eclat-", "é", "un salon", "x".repeat(33), "api", "gestion", "lama", "assets", "a.b"]) {
    assert.equal(IdSalon.safeParse(ko).success, false, ko);
  }
});

test("origine autorisée : schéma, hôte et port, sans chemin", () => {
  for (const ok of ["https://www.eclat.cm", "http://localhost:5173", "https://eclat.cm"]) assert.equal(Origine.safeParse(ok).success, true, ok);
  for (const ko of ["www.eclat.cm", "https://eclat.cm/", "https://eclat.cm/reserver", "ftp://eclat.cm", "*"]) assert.equal(Origine.safeParse(ko).success, false, ko);
});

for (const [nom, fabriquer] of bases) {
  test(`${nom} : création, clé rendue une fois et gardée chiffrée, identifiant déjà pris`, async () => {
    const base = fabriquer();
    const salons = new Salons(base, MAITRE);
    const cree = await salons.creer("eclat", "Institut Éclat", T);
    assert.notEqual(cree, "existe");
    if (cree === "existe") return;
    assert.match(cree.cle, /^[0-9a-f]{64}$/);
    assert.deepEqual(cree.salon, { id: "eclat", nom: "Institut Éclat", etat: "actif", origines: [], cree_le: T, dernier_appel_le: null });
    const brut = await base.premier<{ cle: string }>("SELECT cle FROM salons WHERE id = 'eclat'");
    assert.ok(brut && !brut.cle.includes(cree.cle), "la clé n'est jamais gardée en clair");
    assert.equal(await salons.cle("eclat"), cree.cle);
    assert.equal(await salons.creer("eclat", "Autre", T), "existe");
    assert.equal(await salons.cle("inconnu"), null);
    assert.equal(await new Salons(base, "n".repeat(48)).cle("eclat"), null, "mauvaise clé générale");
  });

  test(`${nom} : liste, modification, appel noté, clé remplacée`, async () => {
    const salons = new Salons(fabriquer(), MAITRE);
    await salons.creer("voisin", "Salon voisin", T);
    const cree = await salons.creer("eclat", "Institut Éclat", T);
    assert.deepEqual((await salons.lister()).map((s) => s.id), ["eclat", "voisin"]);
    const modifie = await salons.modifier("eclat", { etat: "suspendu", origines: ["https://www.eclat.cm"] });
    assert.deepEqual([modifie?.nom, modifie?.etat, modifie?.origines], ["Institut Éclat", "suspendu", ["https://www.eclat.cm"]]);
    assert.equal(await salons.modifier("inconnu", { nom: "x" }), null);
    await salons.noterAppel("eclat", T + 5);
    assert.equal((await salons.lire("eclat"))?.dernier_appel_le, T + 5);
    const nouvelle = await salons.remplacerCle("eclat");
    assert.ok(nouvelle && cree !== "existe" && nouvelle !== cree.cle);
    assert.equal(await salons.cle("eclat"), nouvelle);
    assert.equal(await salons.remplacerCle("inconnu"), null);
  });

  test(`${nom} : dernier appel noté au plus une fois par minute, aucune ligne écrite entre-temps (budget de D1)`, async () => {
    const base = fabriquer();
    const ecrites: number[] = [];
    const espion: Base = {
      ...base,
      async executer(sql, params) {
        const r = await base.executer(sql, params);
        if (sql.startsWith("UPDATE salons SET dernier_appel_le")) ecrites.push(r.changements);
        return r;
      },
    };
    const salons = new Salons(espion, MAITRE);
    await salons.creer("eclat", "Institut Éclat", T);
    await salons.noterAppel("eclat", T);
    await salons.noterAppel("eclat", T + 30_000);
    await salons.noterAppel("eclat", T + APPEL_NOTE_MS - 1);
    assert.equal((await salons.lire("eclat"))?.dernier_appel_le, T, "moins d'une minute après : rien d'écrit");
    await salons.noterAppel("eclat", T + APPEL_NOTE_MS);
    assert.equal((await salons.lire("eclat"))?.dernier_appel_le, T + APPEL_NOTE_MS);
    assert.deepEqual(ecrites, [1, 0, 0, 1]);
    assert.equal(APPEL_NOTE_MS, 60_000);
  });

  test(`${nom} : horloge reculée, un dernier appel situé dans le futur est réécrit`, async () => {
    const base = fabriquer();
    const ecrites: number[] = [];
    const espion: Base = {
      ...base,
      async executer(sql, params) {
        const r = await base.executer(sql, params);
        if (sql.startsWith("UPDATE salons SET dernier_appel_le")) ecrites.push(r.changements);
        return r;
      },
    };
    const salons = new Salons(espion, MAITRE);
    await salons.creer("eclat", "Institut Éclat", T);
    await salons.noterAppel("eclat", T + 10 * APPEL_NOTE_MS);
    await salons.noterAppel("eclat", T);
    assert.equal((await salons.lire("eclat"))?.dernier_appel_le, T);
    assert.deepEqual(ecrites, [1, 1]);
  });

  test(`${nom} : suppression du salon et de toutes ses données, l'autre salon intact`, async () => {
    const base = fabriquer();
    const salons = new Salons(base, MAITRE);
    await salons.creer("eclat", "Institut Éclat", T);
    await salons.creer("voisin", "Salon voisin", T);
    await new Depot(base, "eclat").ecrireDocument("offre", 1, { a: 1 }, T);
    await new Depot(base, "voisin").ecrireDocument("offre", 1, { b: 1 }, T);
    assert.equal(await salons.supprimer("eclat"), true);
    assert.equal(await salons.lire("eclat"), null);
    assert.equal(await new Depot(base, "eclat").lireDocument("offre"), null);
    assert.deepEqual(await new Depot(base, "voisin").lireDocument("offre"), { b: 1 });
    assert.equal(await salons.supprimer("eclat"), false);
  });

  test(`${nom} : clé d'un salon copiée dans un autre : illisible ; identifiant réservé refusé`, async () => {
    const base = fabriquer();
    const salons = new Salons(base, MAITRE);
    await salons.creer("a", "Salon A", T);
    await salons.creer("b", "Salon B", T);
    const scelle = await base.premier<{ cle: string }>("SELECT cle FROM salons WHERE id = 'a'");
    await base.executer("UPDATE salons SET cle = ? WHERE id = 'b'", [scelle!.cle]);
    assert.equal(await salons.cle("b"), null);
    assert.ok(await salons.cle("a"));
    await assert.rejects(() => salons.creer("api", "Réservé", T));
    assert.equal(await salons.lire("api"), null);
  });

  test(`${nom} : restes d'un salon supprimé à moitié : création propre, suppression qui s'achève`, async () => {
    const base = fabriquer();
    const salons = new Salons(base, MAITRE);
    await new Depot(base, "eclat").ecrireDocument("offre", 1, { vieux: 1 }, T);
    assert.equal(await salons.lire("eclat"), null);
    await salons.creer("eclat", "Institut Éclat", T);
    assert.equal(await new Depot(base, "eclat").lireDocument("offre"), null, "repart de zéro");
    await new Depot(base, "eclat").ecrireDocument("offre", 1, { a: 1 }, T);
    // Panne simulée : les données sont parties, la ligne reste ; la relance finit le travail.
    await new Depot(base, "eclat").effacerTout();
    assert.equal(await salons.supprimer("eclat"), true);
    assert.equal(await salons.lire("eclat"), null);
    // Création refusée si le salon existe, sans toucher à ses données.
    await salons.creer("eclat", "Institut Éclat", T);
    await new Depot(base, "eclat").ecrireDocument("offre", 1, { a: 1 }, T);
    assert.equal(await salons.creer("eclat", "Autre", T), "existe");
    assert.deepEqual(await new Depot(base, "eclat").lireDocument("offre"), { a: 1 });
  });
}
