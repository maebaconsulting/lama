import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { decode } from "../messages.ts";
import { runMigrations } from "../migrations.ts";
import { lireBase } from "./base.ts";
import { consultationDue, consulter, depotConfigure, JOUR_MS, noterConsultation, separerNotes, sourceDesVersions } from "./consultation.ts";

/** Consultation du serveur des versions (spec du 21/10/2026, M-12, M-16), contre un faux serveur. */

const REPONSE = { tag_name: "v1.2.0", published_at: "2026-11-02T09:00:00Z", body: "Agenda plus rapide.\r\n---en---\r\nFaster calendar.\r\n", assets: [] };
const repondre = (statut: number, corps: string) => async () => new Response(corps, { status: statut });

test("note : le français puis l'anglais après ---en---, fins de ligne Windows ; sans séparateur, le même texte (M-3, M-14)", () => {
  assert.deepEqual(separerNotes(REPONSE.body), { fr: "Agenda plus rapide.", en: "Faster calendar." });
  assert.deepEqual(separerNotes("Seulement en français."), { fr: "Seulement en français.", en: "Seulement en français." });
  assert.equal(separerNotes(`${"é".repeat(5000)}\n---en---\nx`).fr.length, 4000);
});

test("dépôt et adresse : maebaconsulting/lama, ou la ligne DEPOT= du fichier de recette ; faux serveur seulement en développement (M-12)", () => {
  assert.equal(depotConfigure(null), "maebaconsulting/lama");
  assert.equal(depotConfigure("# recette\nDEPOT=essai-lama/lama-recette\n"), "essai-lama/lama-recette");
  assert.equal(depotConfigure("DEPOT=a/b/c\nDEPOT=https://x/y\n"), "maebaconsulting/lama");
  assert.equal(sourceDesVersions({}, false, "maebaconsulting/lama"), "https://api.github.com/repos/maebaconsulting/lama/releases/latest");
  assert.equal(sourceDesVersions({ LAMA_MISE_A_JOUR_SOURCE: "http://127.0.0.1:9999/latest" }, false, "a/b"), "https://api.github.com/repos/a/b/releases/latest", "refusée hors développement");
  assert.equal(sourceDesVersions({ LAMA_MISE_A_JOUR_SOURCE: "http://127.0.0.1:9999/latest" }, true, "a/b"), "http://127.0.0.1:9999/latest");
});

test("consultation : réponse lue ; 404, JSON invalide, étiquette hors X.Y.Z, réponse lente, réseau coupé : erreur codée, jamais d'exception (M-12, M-16)", async () => {
  const ok = await consulter({ source: "https://versions.exemple/latest", fetch: repondre(200, JSON.stringify(REPONSE)) });
  assert.deepEqual(ok, { ok: true, publiee: { version: "1.2.0", publiee_le: Date.parse("2026-11-02T09:00:00Z"), note_fr: "Agenda plus rapide.", note_en: "Faster calendar." } });
  const invalide = { ok: false, erreur: "@mise_a_jour.reponse_invalide" };
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(404, "{\"message\":\"Not Found\"}") }), invalide);
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(200, "{pas du json") }), invalide);
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(200, JSON.stringify({ ...REPONSE, tag_name: "v1.2.0-essai" })) }), invalide);
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(200, "null") }), invalide);
  assert.deepEqual(await consulter({ source: "x", delai: 30, fetch: () => new Promise<Response>(() => {}) }), { ok: false, erreur: "@mise_a_jour.injoignable" });
  assert.deepEqual(await consulter({ source: "x", fetch: async () => { throw new TypeError("fetch failed"); } }), { ok: false, erreur: "@mise_a_jour.injoignable" });
  assert.equal(decode("fr", "@mise_a_jour.injoignable"), "Impossible de joindre le serveur des versions\u00a0: vérifiez internet, puis «\u00a0Vérifier maintenant\u00a0».");
  assert.equal(decode("en", "@mise_a_jour.reponse_invalide"), "Unexpected answer from the version server: try again later.");
});

test("consultation : corps trop gros (annoncé ou lu), brouillon et préversion refusés (M-12)", async () => {
  const invalide = { ok: false, erreur: "@mise_a_jour.reponse_invalide" };
  const gros = JSON.stringify({ ...REPONSE, body: "x".repeat(1_100_000) });
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(200, gros) }), invalide);
  const annonce = async () => new Response(JSON.stringify(REPONSE), { status: 200, headers: { "content-length": "2000000" } });
  assert.deepEqual(await consulter({ source: "x", fetch: annonce }), invalide);
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(200, JSON.stringify({ ...REPONSE, draft: true })) }), invalide);
  assert.deepEqual(await consulter({ source: "x", fetch: repondre(200, JSON.stringify({ ...REPONSE, prerelease: true })) }), invalide);
  assert.equal((await consulter({ source: "x", fetch: repondre(200, JSON.stringify({ ...REPONSE, draft: false, prerelease: false })) })).ok, true);
});

test("consultation quotidienne : due une fois par jour, et tout de suite si l'heure a reculé (M-12, Review Focus 4)", () => {
  const t0 = Date.parse("2026-11-02T09:00:00Z");
  assert.equal(consultationDue(null, t0), true);
  assert.equal(consultationDue(t0, t0 + JOUR_MS - 1), false);
  assert.equal(consultationDue(t0, t0 + JOUR_MS), true);
  assert.equal(consultationDue(t0, t0 - 60_000), true);
});

test("dernière réponse notée ; un échec garde la version connue et note l'erreur (M-12)", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  noterConsultation(db, 1000, { ok: true, publiee: { version: "1.2.0", publiee_le: 900, note_fr: "a", note_en: "b" } });
  noterConsultation(db, 2000, { ok: false, erreur: "@mise_a_jour.injoignable" });
  assert.deepEqual({ ...lireBase(db) }, { verifie_le: 2000, version: "1.2.0", publiee_le: 900, note_fr: "a", note_en: "b", erreur: "@mise_a_jour.injoignable", operation_journalisee: null });
  noterConsultation(db, 3000, { ok: true, publiee: { version: "1.3.0", publiee_le: null, note_fr: "", note_en: "" } });
  assert.equal(lireBase(db).erreur, null);
});
