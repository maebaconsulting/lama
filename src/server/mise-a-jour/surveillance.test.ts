import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initDB } from "@clawnify/db";
import { isMaintenance, setMaintenance } from "../auth/middleware.ts";
import { runMigrations } from "../migrations.ts";
import { subscribeMaintenance } from "../realtime.ts";
import { setMasterKey, setSetting } from "../settings.ts";
import { registerFunctions, sqliteStorage } from "../storage.ts";
import { creerSurveillance, MAINTENANCE_MAX_MS } from "./surveillance.ts";

/** Suivi de l'opération du service root par lama (spec du 21/10/2026, M-13 à M-15). */

const DEBUT = Date.parse("2026-11-03T02:30:00Z");

function scene(t: { after: (fn: () => void) => void }, o: { version?: string; demarreLe?: number } = {}) {
  const db = new DatabaseSync(":memory:");
  registerFunctions(db);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  const storage = sqliteStorage(db);
  initDB({ STORAGE: storage });
  setMasterKey(new Uint8Array(32).fill(7));
  t.after(() => setMaintenance(false));
  const dossier = mkdtempSync(join(tmpdir(), "lama-surveillance-"));
  const signaux: number[] = [];
  const diffusions: number[] = [];
  t.after(subscribeMaintenance(() => diffusions.push(1)));
  const horloge = { t: DEBUT + 60_000 };
  const nouvelle = () => creerSurveillance({
    dossier, storage, installee: { numero: o.version ?? "1.1.0", developpement: false, installee_le: null },
    demarreLe: o.demarreLe ?? DEBUT - 86_400_000, maintenant: () => horloge.t, signaler: () => signaux.push(1),
  });
  const ecrire = (champs: Record<string, unknown>) => writeFileSync(join(dossier, "etat.json"), JSON.stringify({
    operation: `${DEBUT / 1000}-42`, version_cible: "1.2.0", etape: "telechargement", resultat: null, motif: null, debut: DEBUT, fin: null, version_precedente: "1.1.0", ...champs,
  }));
  const journal = () => db.prepare("SELECT account_id, action, target FROM audit_log WHERE action LIKE 'mise_a_jour.%' ORDER BY id").all().map((r) => ({ ...r }));
  return { db, storage, dossier, s: nouvelle(), nouvelle, signaux, diffusions, horloge, ecrire, journal };
}

test("opération terminée : inscrite au journal une seule fois, même après un redémarrage (M-15)", async (t) => {
  const x = scene(t);
  x.ecrire({ etape: "termine", resultat: "reussie", fin: DEBUT + 300_000 });
  await x.s.tour();
  await x.s.tour();
  await x.nouvelle().tour();
  assert.deepEqual(x.journal(), [{ account_id: null, action: "mise_a_jour.reussie", target: "1.1.0 → 1.2.0" }]);
  x.ecrire({ operation: `${DEBUT / 1000 + 1}-43`, etape: "termine", resultat: "echec", motif: "demarrage", fin: DEBUT + 400_000 });
  await x.s.tour();
  assert.deepEqual(x.journal().at(-1), { account_id: null, action: "mise_a_jour.echec", target: "1.2.0 (demarrage)" });
});

test("chaque changement de etat.json est signalé aux écrans, une fois (M-14)", async (t) => {
  const x = scene(t);
  await x.s.tour();
  const avant = x.signaux.length;
  x.ecrire({ etape: "telechargement" });
  await x.s.tour();
  await x.s.tour();
  x.ecrire({ etape: "verification" });
  await x.s.tour();
  assert.equal(x.signaux.length, avant + 2);
});

test("ancienne version : maintenance dès l'installation, diffusée une fois, levée à la fin de l'opération (M-14)", async (t) => {
  const x = scene(t);
  x.ecrire({ etape: "sauvegarde" });
  await x.s.tour();
  assert.equal(isMaintenance(), false, "pas pendant la sauvegarde");
  x.ecrire({ etape: "installation" });
  await x.s.tour();
  assert.equal(isMaintenance(), true);
  x.ecrire({ etape: "controle" });
  await x.s.tour();
  assert.equal(x.diffusions.length, 1, "une seule diffusion");
  x.ecrire({ etape: "termine", resultat: "echec", motif: "installation", fin: DEBUT + 120_000 });
  await x.s.tour();
  assert.equal(isMaintenance(), false, "échec avant le redémarrage : l'ancienne version reprend la main");
});

test("retour arrière : la version relancée après le début de l'opération ne se met jamais en maintenance (Review Focus 1)", async (t) => {
  for (const o of [{ version: "1.1.0", demarreLe: DEBUT + 90_000 }, { version: "1.2.0", demarreLe: DEBUT + 90_000 }]) {
    const x = scene(t, o);
    x.ecrire({ etape: "controle" });
    await x.s.tour();
    assert.equal(isMaintenance(), false, JSON.stringify(o));
  }
});

test("maintenance levée d'office après 30 minutes sans fin d'opération, jamais reposée pour la même (M-14)", async (t) => {
  const x = scene(t);
  await x.s.tour();
  x.ecrire({ etape: "installation" });
  await x.s.tour();
  assert.equal(isMaintenance(), true);
  x.horloge.t += MAINTENANCE_MAX_MS + 1;
  await x.s.tour();
  assert.equal(isMaintenance(), false);
  await x.s.tour();
  assert.equal(isMaintenance(), false);
});

test("mode recopié au premier tour : choisi avant la pose du mécanisme, il atteint le service root (Review Focus 5)", async (t) => {
  const x = scene(t);
  await setSetting("mise_a_jour.mode", "automatique", null, 0);
  await x.s.tour();
  assert.equal(readFileSync(join(x.dossier, "mode"), "utf8"), "automatique\n");
});

test("démarrage : branché hors formation seulement ; consultation automatique hors développement, sauf faux serveur ; arrêts compris (M-2, M-12, M-16)", () => {
  const boot = readFileSync(new URL("../boot.ts", import.meta.url), "utf8");
  assert.match(boot, /if \(!config\.formation\) \{\n    const miseAJour: MiseAJourEnv = \{/);
  assert.match(boot, /installee: lireVersionInstallee\(realpathSync\(process\.cwd\(\)\)\)/);
  assert.match(boot, /demarreLe: Date\.now\(\)/);
  assert.match(boot, /if \(!config\.dev \|\| process\.env\.LAMA_MISE_A_JOUR_SOURCE\) \{/);
  assert.match(boot, /stopMiseAJour\(\);/);
});

test("processus démarré en pleine installation : jamais de maintenance, même si l'horloge le dit plus ancien que le début (Review Focus 1)", async (t) => {
  const x = scene(t, { demarreLe: DEBUT - 3_600_000 });
  x.ecrire({ etape: "controle" });
  await x.s.tour();
  assert.equal(isMaintenance(), false);
  x.ecrire({ etape: "installation" });
  await x.s.tour();
  assert.equal(isMaintenance(), false);
});

test("journal en panne : la maintenance est quand même levée à la fin, et plafonnée à 30 minutes", async (t) => {
  const x = scene(t);
  const casse = creerSurveillance({
    dossier: x.dossier, storage: { ...x.storage, transaction: () => { throw new Error("SQLITE_FULL"); } },
    installee: { numero: "1.1.0", developpement: false, installee_le: null }, demarreLe: DEBUT - 86_400_000,
    maintenant: () => x.horloge.t, signaler: () => undefined,
  });
  await casse.tour();
  x.ecrire({ etape: "installation" });
  await casse.tour();
  assert.equal(isMaintenance(), true);
  x.ecrire({ etape: "termine", resultat: "echec", motif: "installation", fin: DEBUT + 120_000 });
  await assert.rejects(casse.tour(), /SQLITE_FULL/);
  assert.equal(isMaintenance(), false, "levée à la fin malgré le journal en panne");
  const y = scene(t);
  const casse2 = creerSurveillance({
    dossier: y.dossier, storage: { ...y.storage, transaction: () => { throw new Error("SQLITE_FULL"); } },
    installee: { numero: "1.1.0", developpement: false, installee_le: null }, demarreLe: DEBUT - 86_400_000,
    maintenant: () => y.horloge.t, signaler: () => undefined,
  });
  await casse2.tour();
  y.ecrire({ etape: "installation" });
  await casse2.tour();
  assert.equal(isMaintenance(), true);
  y.horloge.t += MAINTENANCE_MAX_MS + 1;
  y.ecrire({ etape: "termine", resultat: "echec", motif: "installation", fin: DEBUT + 120_000 });
  await assert.rejects(casse2.tour());
  assert.equal(isMaintenance(), false);
});
