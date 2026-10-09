import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { bundleOf } from "../test-support.ts";
import { isMaintenance, setMaintenance } from "../auth/middleware.ts";
import { subscribeMaintenance } from "../realtime.ts";
import { message } from "../messages.ts";
import { DEMANDE_REMISE_A_ZERO } from "./remise-a-zero.ts";
import { programmerRemiseNocturne, prochaineRemise, remettreCetteNuit, type Minuterie } from "./remise-nocturne.ts";

/** Remise à zéro de chaque nuit de la démonstration publique (démo publique DP-05) : 3 h de Douala, demande, maintenance, arrêt. */

const { start, shutdown } = await import(await bundleOf("./boot.ts"));
const heureDouala = (ms: number) => new Intl.DateTimeFormat("fr-CM", { timeZone: "Africa/Douala", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

test("prochaine remise : 3 h de Douala (2 h UTC), le jour même avant 3 h, le lendemain dès 3 h ; passage d'année", () => {
  assert.equal(prochaineRemise(Date.parse("2026-10-08T01:59:59Z")), Date.parse("2026-10-08T02:00:00Z"), "2 h 59 à Douala : dans une seconde");
  assert.equal(prochaineRemise(Date.parse("2026-10-08T02:00:00Z")), Date.parse("2026-10-09T02:00:00Z"), "3 h pile : la suivante est demain");
  assert.equal(prochaineRemise(Date.parse("2026-10-08T02:00:03Z")), Date.parse("2026-10-09T02:00:00Z"), "relancé juste après la remise : demain, jamais deux fois la même nuit");
  assert.equal(prochaineRemise(Date.parse("2026-10-08T22:30:00Z")), Date.parse("2026-10-09T02:00:00Z"), "23 h 30 à Douala");
  assert.equal(prochaineRemise(Date.parse("2026-12-31T23:30:00Z")), Date.parse("2027-01-01T02:00:00Z"), "0 h 30 à Douala le 1er janvier");
  for (const now of [Date.parse("2026-03-29T12:00:00Z"), Date.parse("2026-07-01T00:00:00Z"), Date.parse("2026-10-25T12:00:00Z")]) {
    const echeance = prochaineRemise(now);
    assert.equal(heureDouala(echeance), "03:00", new Date(now).toISOString());
    assert.ok(echeance > now && echeance - now <= 86_400_000);
  }
});

test("programmation : minuterie posée pour le délai exact, geste fait à l'échéance, annulée à l'arrêt", () => {
  const poses: { fn: () => void; ms: number }[] = [];
  let annulees = 0;
  const minuterie: Minuterie = { poser: (fn, ms) => { poses.push({ fn, ms }); return () => { annulees++; }; } };
  let remises = 0;
  let now = Date.parse("2026-10-08T20:00:00Z");
  const { echeance, arreter } = programmerRemiseNocturne({ now: () => now, remettre: () => { remises++; }, minuterie });
  assert.equal(echeance, Date.parse("2026-10-09T02:00:00Z"));
  assert.deepEqual(poses.map((p) => p.ms), [6 * 3_600_000]);
  assert.equal(remises, 0);
  now = echeance;
  poses[0].fn();
  assert.equal(remises, 1);
  arreter();
  assert.equal(annulees, 1);
});

test("programmation : minuterie partie en avance, reposée pour le reste, jamais de remise avant 3 h ; l'arrêt annule la dernière posée", () => {
  const poses: { fn: () => void; ms: number; annulee: boolean }[] = [];
  const minuterie: Minuterie = {
    poser: (fn, ms) => {
      const pose = { fn, ms, annulee: false };
      poses.push(pose);
      return () => { pose.annulee = true; };
    },
  };
  let remises = 0;
  let now = Date.parse("2026-10-08T20:00:00Z");
  const { echeance, arreter } = programmerRemiseNocturne({ now: () => now, remettre: () => { remises++; }, minuterie });
  now = echeance - 90_000;
  poses[0].fn();
  assert.equal(remises, 0, "en avance : pas de remise");
  assert.deepEqual(poses.map((p) => p.ms), [6 * 3_600_000, 90_000], "reposée pour le reste");
  now = echeance - 1;
  poses[1].fn();
  assert.equal(remises, 0);
  assert.equal(poses[2].ms, 1);
  now = echeance + 5;
  poses[2].fn();
  assert.equal(remises, 1, "à l'échéance (ou après) : la remise");
  assert.equal(poses.length, 3, "rien de reposé après la remise");
  arreter();
  assert.deepEqual(poses.map((p) => p.annulee), [false, false, true], "l'arrêt annule la minuterie en cours");
});

test("geste de 3 h : demande de remise déposée, maintenance annoncée à tous les écrans, arrêt demandé ; jamais sur la vraie base, échec écrit au journal", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "lama-remise-nuit-"));
  t.after(() => { setMaintenance(false); rmSync(dir, { recursive: true, force: true }); });
  let annonces = 0;
  const fin = subscribeMaintenance(() => { annonces++; });
  t.after(fin);
  let arrets = 0;
  // Demande impossible (ici, la vraie base, toujours refusée) : rien ne lève, le journal le dit, ni maintenance ni arrêt.
  const erreurs = mock.method(console, "error", () => {});
  try {
    remettreCetteNuit("/var/lib/lama", () => { arrets++; });
  } finally {
    erreurs.mock.restore();
  }
  assert.deepEqual([arrets, isMaintenance(), annonces], [0, false, 0], "vraie base : ni maintenance ni arrêt");
  assert.equal(erreurs.mock.callCount(), 1);
  const ligne = String(erreurs.mock.calls[0].arguments[0]);
  const debuts = (["fr", "en"] as const).map((l) => message(l, "demo.remise_nocturne_echec", { detail: "" }).split("()")[0]);
  assert.ok(debuts.some((d) => ligne.startsWith(d)), ligne);
  assert.match(ligne, /vraie base|real database/, "le détail de l'erreur est au journal");
  remettreCetteNuit(dir, () => { arrets++; });
  assert.ok(existsSync(join(dir, DEMANDE_REMISE_A_ZERO)));
  assert.deepEqual([arrets, isMaintenance(), annonces], [1, true, 1]);
});

test("démarrage : remise de la nuit programmée dans la démonstration publique seulement, annulée à l'arrêt", async () => {
  const avant = [process.env.LAMA_FORMATION, process.env.LAMA_DEMO_PUBLIQUE];
  const dir = mkdtempSync(join(tmpdir(), "lama-remise-nuit-boot-"));
  const config = { configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true };
  try {
    const debut = Date.now();
    const demo = await start({ ...config, dataDir: join(dir, "demo"), demoPublique: true });
    const fin = Date.now();
    await shutdown(demo);
    assert.ok([prochaineRemise(debut), prochaineRemise(fin)].includes(demo.remiseNocturne), String(demo.remiseNocturne));
    const formation = await start({ ...config, dataDir: join(dir, "formation") });
    await shutdown(formation);
    assert.equal(formation.remiseNocturne, null, "formation de l'institut : aucune remise de nuit");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const [nom, valeur] of [["LAMA_FORMATION", avant[0]], ["LAMA_DEMO_PUBLIQUE", avant[1]]] as const) {
      if (valeur === undefined) delete process.env[nom];
      else process.env[nom] = valeur;
    }
  }
});
