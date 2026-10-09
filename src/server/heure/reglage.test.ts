import assert from "node:assert/strict";
import { test } from "node:test";
import { auditAction } from "../../client/lib/libelles.ts";
import { setupApp } from "../test-support.ts";
import { horlogeTimedatectl, type Executer, type HorlogeSysteme, type ReglageHeure } from "./horloge.ts";
import { instantSecondes } from "./routes.ts";

/**
 * Correction de l'heure du serveur (distribution D-12) : `timedatectl` sous
 * le compte lama (règle polkit), jamais appelé pour de vrai ici ; la route
 * exige l'administrateur et son mot de passe retapé, refuse lisiblement si
 * l'autorisation manque, et inscrit l'ancienne et la nouvelle heure au journal.
 */

const T = Date.parse("2026-10-05T13:00:00Z");
const FR = { "Accept-Language": "fr" };

/** Faux `timedatectl` : réponses données dans l'ordre, appels gardés. */
function fauxExec(reponses: { code: number; stderr?: string; absent?: boolean }[]): { exec: Executer; appels: string[] } {
  const appels: string[] = [];
  const exec: Executer = async (cmd, args) => {
    appels.push([cmd, ...args].join(" "));
    const r = reponses.shift() ?? { code: 0 };
    return { code: r.code, stderr: r.stderr ?? "", absent: r.absent };
  };
  return { exec, appels };
}

test("timedatectl : synchronisation coupée, heure réglée à la seconde, synchronisation rétablie", async () => {
  const { exec, appels } = fauxExec([{ code: 0 }, { code: 0 }, { code: 0 }]);
  assert.deepEqual(await horlogeTimedatectl(exec).regler(T + 499), { ok: true });
  assert.deepEqual(appels, [
    "timedatectl --no-ask-password set-ntp false",
    `timedatectl --no-ask-password set-time @${T / 1000}`,
    "timedatectl --no-ask-password set-ntp true",
  ]);
});

test("timedatectl : refus de polkit (règle absente), commande absente, échec du réglage ; la synchronisation est toujours rétablie", async () => {
  const refus = fauxExec([{ code: 1, stderr: "Failed to set NTP: Access denied\n" }]);
  assert.deepEqual(await horlogeTimedatectl(refus.exec).regler(T), { ok: false, motif: "autorisation", detail: "Failed to set NTP: Access denied" });
  assert.equal(refus.appels.length, 1, "rien d'autre n'est tenté");
  const interactif = fauxExec([{ code: 1, stderr: "Failed to set NTP: Interactive authentication required." }]);
  assert.equal(((await horlogeTimedatectl(interactif.exec).regler(T)) as Extract<ReglageHeure, { ok: false }>).motif, "autorisation");
  const absente = fauxExec([{ code: 1, absent: true }]);
  assert.deepEqual(await horlogeTimedatectl(absente.exec).regler(T), { ok: false, motif: "absente", detail: "timedatectl" });
  const echec = fauxExec([{ code: 0 }, { code: 1, stderr: "Failed to set time: Invalid argument" }, { code: 0 }]);
  assert.deepEqual(await horlogeTimedatectl(echec.exec).regler(T), { ok: false, motif: "echec", detail: "Failed to set time: Invalid argument" });
  assert.equal(echec.appels[2], "timedatectl --no-ask-password set-ntp true", "synchronisation rétablie même après un échec");
});

/** Fausse horloge du système : rend `reponse` et garde les heures demandées. */
function fausseHorloge(reponse: ReglageHeure): HorlogeSysteme & { demandes: number[] } {
  const demandes: number[] = [];
  return { demandes, regler: async (ms) => { demandes.push(ms); return reponse; } };
}

test("POST /api/heure : administrateur seul, mot de passe retapé, heure plausible ; journal avec l'ancienne et la nouvelle heure", async (t) => {
  const horloge = fausseHorloge({ ok: true });
  const ctx = await setupApp(t, { demo: false, bindings: { HORLOGE: horloge } });
  ctx.clock.now = T;
  const admin = await ctx.as("admin");
  const gerante = await ctx.as("manager");
  const nouvelle = T + 12 * 60_000 + 30_000;
  assert.equal((await gerante("POST", "/api/heure", { heure: nouvelle })).status, 403);
  const sans = await admin("POST", "/api/heure", { heure: nouvelle }, FR);
  assert.deepEqual([sans.status, sans.body.code], [403, "confirmation"], "refusée sans confirmation");
  assert.equal(horloge.demandes.length, 0);
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  for (const heure of [undefined, "2026-10-05 14:00", T + 0.5, Date.UTC(2025, 11, 31), Date.UTC(2100, 0, 1)]) {
    const r = await admin("POST", "/api/heure", { heure }, FR);
    assert.deepEqual([r.status, r.body.error], [400, "Heure invalide."], String(heure));
  }
  const fait = await admin("POST", "/api/heure", { heure: nouvelle });
  assert.equal(fait.status, 200, JSON.stringify(fait.body));
  assert.deepEqual(fait.body, { ancienne: T, nouvelle, derniere_facture: null, caisse_bloquee: false });
  assert.deepEqual(horloge.demandes, [nouvelle]);
  const ligne = ctx.db.prepare("SELECT at, action, target FROM audit_log WHERE action = 'heure.reglee'").get() as Record<string, unknown>;
  assert.deepEqual({ ...ligne }, { at: nouvelle, action: "heure.reglee", target: "05/10/2026 14:00:00 → 05/10/2026 14:12:30" });
  assert.equal(instantSecondes(T), "05/10/2026 14:00:00");
  assert.deepEqual([auditAction("heure.reglee", "fr"), auditAction("heure.reglee", "en")], ["Heure du serveur corrigée", "Server time corrected"]);
});

test("POST /api/heure : refus lisible si la règle polkit manque, si timedatectl manque, ou si le système refuse", async (t) => {
  for (const [reponse, status, code, texte] of [
    [{ ok: false, motif: "autorisation", detail: "Access denied" }, 503, "autorisation", /^Le serveur n'a pas le droit de changer son heure \(règle polkit absente\)/],
    [{ ok: false, motif: "absente", detail: "timedatectl" }, 503, "indisponible", /^Ce serveur ne sait pas changer son heure/],
    [{ ok: false, motif: "echec", detail: "Invalid argument" }, 502, "echec", /^Le serveur n'a pas pu changer son heure\u00a0: Invalid argument$/],
  ] as const) {
    const ctx = await setupApp(t, { demo: false, bindings: { HORLOGE: fausseHorloge(reponse) } });
    const admin = await ctx.as("admin");
    await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
    const r = await admin("POST", "/api/heure", { heure: T }, FR);
    assert.deepEqual([r.status, r.body.code], [status, code]);
    assert.match(r.body.error, texte);
    assert.equal(ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'heure.reglee'").get()!.n, 0, "rien au journal");
    const refus = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'heure.refus'").all() as { target: string }[];
    assert.deepEqual(refus.map((l) => l.target), [`05/10/2026 14:00:00 (${reponse.ok ? "" : reponse.motif})`], "refus journalisé");
  }
  const sansHorloge = await setupApp(t, { demo: false });
  const admin = await sansHorloge.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  assert.equal((await admin("POST", "/api/heure", { heure: T })).body.code, "indisponible");
  const refus = sansHorloge.db.prepare("SELECT target FROM audit_log WHERE action = 'heure.refus'").all() as { target: string }[];
  assert.deepEqual(refus.map((l) => l.target), ["05/10/2026 14:00:00 (absente)"], "refus journalisé sans horloge aussi");
});

test("timedatectl : synchro non rétablie, heure réglée quand même, signalée", async () => {
  const { exec } = fauxExec([{ code: 0 }, { code: 0 }, { code: 1, stderr: "Failed to set NTP" }]);
  assert.deepEqual(await horlogeTimedatectl(exec).regler(T), { ok: true, synchro: false });
});

test("POST /api/heure : synchro non rétablie au journal ; heure reculée avant le dernier document : caisse bloquée", async (t) => {
  const ctx = await setupApp(t, { demo: false, bindings: { HORLOGE: fausseHorloge({ ok: true, synchro: false }) } });
  ctx.clock.now = T;
  const admin = await ctx.as("admin");
  await admin("POST", "/api/auth/confirm", { password: "mot-de-passe-test" });
  ctx.db.exec("PRAGMA foreign_keys = OFF");
  ctx.db.exec("INSERT INTO sequences (series, year, last) VALUES ('AC', 2026, 1)");
  ctx.db.prepare("INSERT INTO deposits (number, series, year, seq, appointment_id, amount, issued_at, account_id, fiscal, lang, request_id) VALUES ('AC-2026-000001', 'AC', 2026, 1, 1, 100, ?, 1, '{}', 'fr', 'heure-ac-01')").run(T);
  const r = await admin("POST", "/api/heure", { heure: T - 10 * 60_000 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ancienne: T, nouvelle: T - 10 * 60_000, synchro: false, derniere_facture: T, caisse_bloquee: true });
  const ligne = ctx.db.prepare("SELECT target FROM audit_log WHERE action = 'heure.reglee'").get() as { target: string };
  assert.match(ligne.target, /; synchro non rétablie$/);
});

test("timedatectl : une exception pendant le réglage ou le rétablissement ne laisse pas la synchronisation coupée ni ne devient une erreur 500", async () => {
  const appels: string[] = [];
  const leve: Executer = async (cmd, args) => {
    appels.push(args.slice(1).join(" "));
    if (args[1] === "set-time") throw new Error("boum");
    return { code: 0, stderr: "" };
  };
  const r = await horlogeTimedatectl(leve).regler(T);
  assert.deepEqual([r.ok, r.ok ? "" : r.motif, r.ok ? "" : r.detail], [false, "echec", "boum"]);
  assert.equal(appels[2], "set-ntp true", "synchronisation rétablie malgré l'exception");
  const leveNtp: Executer = async (_cmd, args) => {
    if (args[1] === "set-ntp" && args[2] === "true") throw new Error("boum");
    return { code: 0, stderr: "" };
  };
  assert.deepEqual(await horlogeTimedatectl(leveNtp).regler(T), { ok: true, synchro: false });
});
