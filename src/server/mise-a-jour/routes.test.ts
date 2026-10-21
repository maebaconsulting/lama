import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { avecFormation, setupApp } from "../test-support.ts";
import type { MiseAJourEnv } from "./routes.ts";
import { sauvegardeSystemeEnCours, serviceMiseAJourActif } from "./systeme.ts";

/** Rubrique « Mise à jour » côté serveur (spec du 21/10/2026, M-12 à M-17), contre un faux serveur des versions. */

const FR = { "Accept-Language": "fr" };
const PUBLIEE = { tag_name: "v1.2.0", published_at: "2026-11-02T09:00:00Z", body: "Agenda plus rapide.\n---en---\nFaster calendar.\n" };
const MOT_DE_PASSE = "mot-de-passe-test";

type Reponse = { statut?: number; corps?: unknown; jamais?: boolean };
/** Faux serveur des versions : rend `reponse` (lue à chaque appel) et compte les appels. */
function fauxServeur(reponse: Reponse = {}) {
  const appels: string[] = [];
  const fetch = async (url: string) => {
    appels.push(url);
    if (reponse.jamais) return new Promise<Response>(() => {});
    const corps = typeof reponse.corps === "string" ? reponse.corps : JSON.stringify(reponse.corps ?? PUBLIEE);
    return new Response(corps, { status: reponse.statut ?? 200 });
  };
  return { fetch, appels, reponse };
}

async function scene(t: { after: (fn: () => void) => void }, o: { installee?: string; developpement?: boolean; pose?: boolean; serveur?: ReturnType<typeof fauxServeur>; sauvegarde?: boolean; serviceActif?: boolean } = {}) {
  const donnees = mkdtempSync(join(tmpdir(), "lama-maj-donnees-"));
  const dossier = join(donnees, "mise-a-jour");
  if (o.pose !== false) mkdirSync(dossier);
  const serveur = o.serveur ?? fauxServeur();
  const env: MiseAJourEnv = {
    dossier, dataDir: donnees, source: "https://versions.exemple/latest", fetch: serveur.fetch, delai: 50,
    installee: { numero: o.installee ?? "1.1.0", developpement: o.developpement ?? false, installee_le: Date.parse("2026-10-01T10:00:00Z") },
    sauvegardeEnCours: async () => o.sauvegarde === true,
    ...(o.serviceActif === undefined ? {} : { serviceActif: async () => o.serviceActif! }),
  };
  const ctx = await setupApp(t, { demo: false, bindings: { MISE_A_JOUR: env } });
  return { ...ctx, dossier, donnees, serveur };
}

const ETAT_FINI = { operation: "1761000000-42", version_cible: "1.2.0", etape: "termine", resultat: "echec", motif: "signature", debut: 1761000000000, fin: 1761000060000, version_precedente: "1.1.0" };

test("lecture : administrateur et gérante seulement ; la gérante lit les versions, pas l'opération ni le mode (M-2, M-15)", async (t) => {
  const s = await scene(t);
  for (const role of ["reception", "practitioner"] as const) assert.equal((await (await s.as(role))("GET", "/api/mise-a-jour")).status, 403, role);
  const admin = await s.as("admin");
  await admin("POST", "/api/mise-a-jour/verifier");
  const gerante = await s.as("manager");
  const vue = await gerante("GET", "/api/mise-a-jour", undefined, FR);
  assert.equal(vue.status, 200);
  assert.deepEqual(Object.keys(vue.body).sort(), ["aucune_publiee", "disponible", "erreur", "installee", "verifie_le"]);
  assert.deepEqual(vue.body.installee, { version: "1.1.0", developpement: false, installee_le: Date.parse("2026-10-01T10:00:00Z") });
  assert.deepEqual(vue.body.disponible, { version: "1.2.0", publiee_le: Date.parse("2026-11-02T09:00:00Z"), note: "Agenda plus rapide." });
  assert.equal((await gerante("GET", "/api/mise-a-jour", undefined, { "Accept-Language": "en" })).body.disponible.note, "Faster calendar.");
  for (const [methode, chemin] of [["POST", "/api/mise-a-jour"], ["POST", "/api/mise-a-jour/verifier"], ["PUT", "/api/mise-a-jour/mode"]] as const) {
    assert.equal((await gerante(methode, chemin, { mode: "manuel" })).status, 403, chemin);
  }
  const tout = (await admin("GET", "/api/mise-a-jour")).body;
  assert.deepEqual([tout.mecanisme, tout.mode, tout.en_cours, tout.operation], [true, "manuel", false, null]);
});

test("Vérifier maintenant : au plus une fois par minute, de nouveau si l'heure recule (M-12, Review Focus 4)", async (t) => {
  const s = await scene(t);
  const admin = await s.as("admin");
  await admin("POST", "/api/mise-a-jour/verifier");
  await admin("POST", "/api/mise-a-jour/verifier");
  assert.equal(s.serveur.appels.length, 1, "une seule fois dans la minute");
  s.clock.now += 60_000;
  await admin("POST", "/api/mise-a-jour/verifier");
  assert.equal(s.serveur.appels.length, 2);
  s.clock.now -= 3_600_000;
  await admin("POST", "/api/mise-a-jour/verifier");
  assert.equal(s.serveur.appels.length, 3, "heure reculée : jamais bloqué");
});

test("faux serveur des versions : lent, erreur 500, JSON invalide ; la dernière réponse est gardée, rien ne change (M-12, M-16)", async (t) => {
  const serveur = fauxServeur();
  const s = await scene(t, { serveur });
  const admin = await s.as("admin");
  await admin("POST", "/api/mise-a-jour/verifier", undefined, FR);
  const injoignable = "Impossible de joindre le serveur des versions\u00a0: vérifiez internet, puis «\u00a0Vérifier maintenant\u00a0».";
  const inattendue = "Réponse inattendue du serveur des versions\u00a0: réessayez plus tard.";
  for (const [reponse, texte] of [[{ jamais: true }, injoignable], [{ statut: 500, corps: { message: "Server Error" } }, inattendue], [{ corps: "{pas du json" }, inattendue]] as const) {
    serveur.reponse.jamais = false;
    serveur.reponse.statut = undefined;
    serveur.reponse.corps = undefined;
    Object.assign(serveur.reponse, reponse);
    s.clock.now += 60_000;
    const vue = await admin("POST", "/api/mise-a-jour/verifier", undefined, FR);
    assert.equal(vue.status, 200);
    assert.equal(vue.body.erreur, texte);
    assert.equal(vue.body.disponible.version, "1.2.0", "dernière réponse gardée");
    assert.equal(existsSync(join(s.dossier, "demande.json")), false, "rien ne change");
  }
});

test("Mettre à jour : mot de passe redemandé, demande.json écrite telle quelle, inscrite au journal, opération en cours (M-13, M-15)", async (t) => {
  const s = await scene(t);
  const admin = await s.as("admin");
  await admin("POST", "/api/mise-a-jour/verifier");
  const sans = await admin("POST", "/api/mise-a-jour");
  assert.deepEqual([sans.status, sans.body.code], [403, "confirmation"]);
  assert.equal(existsSync(join(s.dossier, "demande.json")), false);
  await admin("POST", "/api/auth/confirm", { password: MOT_DE_PASSE });
  const fait = await admin("POST", "/api/mise-a-jour");
  assert.deepEqual([fait.status, fait.body], [200, { ok: true, version: "1.2.0" }]);
  assert.equal(readFileSync(join(s.dossier, "demande.json"), "utf8"), "{\"version\":\"1.2.0\"}\n");
  const ligne = s.db.prepare("SELECT action, target FROM audit_log WHERE action LIKE 'mise_a_jour%'").get() as Record<string, unknown>;
  assert.deepEqual({ ...ligne }, { action: "mise_a_jour.demandee", target: "1.2.0" });
  const encore = await admin("POST", "/api/mise-a-jour", undefined, FR);
  assert.deepEqual([encore.status, encore.body.code, encore.body.error], [409, "en_cours", "Une mise à jour est déjà en cours."]);
  assert.equal((await admin("GET", "/api/mise-a-jour")).body.en_cours, true);
});

/** Demande refusée : rend le code du refus ; jamais de demande.json. */
async function refus(t: { after: (fn: () => void) => void }, o: Parameters<typeof scene>[1], avant: (s: Awaited<ReturnType<typeof scene>>) => void = () => undefined, verifier = true): Promise<string> {
  const s = await scene(t, o);
  const admin = await s.as("admin");
  if (verifier) await admin("POST", "/api/mise-a-jour/verifier");
  avant(s);
  await admin("POST", "/api/auth/confirm", { password: MOT_DE_PASSE });
  const r = await admin("POST", "/api/mise-a-jour", undefined, FR);
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(existsSync(join(s.dossier, "demande.json")), false);
  return r.body.code as string;
}

test("Mettre à jour : refusée sans version plus récente, en développement, sans mécanisme, pendant une sauvegarde, une restauration ou une autre mise à jour (M-13, M-16)", async (t) => {
  assert.equal(await refus(t, {}, () => undefined, false), "pas_de_version", "jamais vérifiée");
  assert.equal(await refus(t, { installee: "1.2.0" }), "pas_de_version", "déjà à jour");
  assert.equal(await refus(t, { developpement: true, installee: "20261021-1030-abc" }), "developpement");
  assert.equal(await refus(t, { pose: false }), "non_pose");
  assert.equal(await refus(t, { sauvegarde: true }), "sauvegarde_en_cours");
  assert.equal(await refus(t, {}, (s) => writeFileSync(join(s.donnees, "lama.db.restauration"), "")), "restauration_en_cours");
  assert.equal(await refus(t, {}, (s) => writeFileSync(join(s.dossier, "etat.json"), JSON.stringify({ ...ETAT_FINI, etape: "sauvegarde", resultat: null, motif: null, fin: null }))), "en_cours");
});

test("etat.json sans fin, service root arrêté : opération abandonnée, ni « en cours » ni refus (revue finale 1b)", async (t) => {
  const abandonne = JSON.stringify({ ...ETAT_FINI, etape: "installation", resultat: null, motif: null, fin: null });
  const actif = await scene(t, { serviceActif: true });
  writeFileSync(join(actif.dossier, "etat.json"), abandonne);
  assert.equal((await (await actif.as("admin"))("GET", "/api/mise-a-jour")).body.en_cours, true, "service actif : en cours");
  const s = await scene(t, { serviceActif: false });
  const admin = await s.as("admin");
  await admin("POST", "/api/mise-a-jour/verifier");
  writeFileSync(join(s.dossier, "etat.json"), abandonne);
  assert.equal((await admin("GET", "/api/mise-a-jour")).body.en_cours, false, "service arrêté : abandonnée");
  await admin("POST", "/api/auth/confirm", { password: MOT_DE_PASSE });
  const r = await admin("POST", "/api/mise-a-jour");
  assert.deepEqual([r.status, r.body], [200, { ok: true, version: "1.2.0" }]);
  assert.equal((await admin("GET", "/api/mise-a-jour")).body.en_cours, true, "nouvelle demande déposée");
});

test("état : dernière opération et son motif traduit ; etat.json malformé ou lien, rien ne casse (M-14, M-17)", async (t) => {
  const s = await scene(t);
  const admin = await s.as("admin");
  writeFileSync(join(s.dossier, "etat.json"), JSON.stringify(ETAT_FINI));
  const vue = (await admin("GET", "/api/mise-a-jour", undefined, FR)).body;
  assert.equal(vue.en_cours, false);
  assert.deepEqual(vue.operation, { ...ETAT_FINI, motif_texte: "La signature de la version est refusée\u00a0: rien n'a été installé. Prévenez le technicien." });
  for (const contenu of ["{", "[]", JSON.stringify({ ...ETAT_FINI, etape: "pirate" }), "x".repeat(10_000)]) {
    writeFileSync(join(s.dossier, "etat.json"), contenu);
    const r = await admin("GET", "/api/mise-a-jour");
    assert.deepEqual([r.status, r.body.operation], [200, null], contenu.slice(0, 40));
  }
  rmSync(join(s.dossier, "etat.json"));
  const ailleurs = join(s.donnees, "ailleurs.json");
  writeFileSync(ailleurs, JSON.stringify(ETAT_FINI));
  symlinkSync(ailleurs, join(s.dossier, "etat.json"));
  assert.equal((await admin("GET", "/api/mise-a-jour")).body.operation, null, "lien jamais suivi");
});

test("mode : administrateur, mot de passe redemandé, recopié dans le fichier mode, inscrit au journal ; la route générique le refuse (M-13, M-15)", async (t) => {
  const s = await scene(t);
  const admin = await s.as("admin");
  assert.equal((await admin("PUT", "/api/mise-a-jour/mode", { mode: "automatique" })).body.code, "confirmation");
  await admin("POST", "/api/auth/confirm", { password: MOT_DE_PASSE });
  assert.equal((await admin("PUT", "/api/mise-a-jour/mode", { mode: "souvent" }, FR)).body.error, "Mode attendu\u00a0: manuel ou automatique.");
  assert.equal((await admin("PUT", "/api/mise-a-jour/mode", { mode: "automatique" })).status, 200);
  assert.equal(readFileSync(join(s.dossier, "mode"), "utf8"), "automatique\n");
  assert.equal((await admin("GET", "/api/mise-a-jour")).body.mode, "automatique");
  const generique = await admin("PUT", "/api/settings/mise_a_jour.mode", { value: "manuel" }, FR);
  assert.deepEqual([generique.status, generique.body.error], [409, "Le mode de mise à jour se change dans la rubrique «\u00a0Mise à jour\u00a0»."]);
  const ligne = s.db.prepare("SELECT action, target FROM audit_log WHERE action = 'mise_a_jour.mode'").get() as Record<string, unknown>;
  assert.deepEqual({ ...ligne }, { action: "mise_a_jour.mode", target: "automatique" });
});

test("mode choisi avant que le mécanisme soit posé : gardé en réglage, sans fichier (recopié au démarrage, tâche 15)", async (t) => {
  const s = await scene(t, { pose: false });
  const admin = await s.as("admin");
  await admin("POST", "/api/auth/confirm", { password: MOT_DE_PASSE });
  assert.equal((await admin("PUT", "/api/mise-a-jour/mode", { mode: "automatique" })).status, 200);
  assert.equal(existsSync(join(s.dossier, "mode")), false);
  assert.equal((await admin("GET", "/api/mise-a-jour")).body.mode, "automatique");
});

test("base de formation : vérification, demande et mode refusés ; sans liaison, rubrique indisponible (M-16)", async (t) => {
  // Toute la scène en formation (cookies de la formation, comme les essais des coupures).
  await avecFormation(true, async () => {
    const s = await scene(t);
    const admin = await s.as("admin");
    for (const [methode, chemin] of [["POST", "/api/mise-a-jour"], ["POST", "/api/mise-a-jour/verifier"], ["PUT", "/api/mise-a-jour/mode"]] as const) {
      const r = await admin(methode, chemin, { mode: "manuel" });
      assert.deepEqual([r.status, r.body.code], [409, "formation"], chemin);
    }
  });
  const sansLiaison = await setupApp(t, { demo: false });
  assert.equal((await (await sansLiaison.as("admin"))("GET", "/api/mise-a-jour")).status, 404);
});

test("sauvegarde de nuit vue par systemd ; faux sans systemd ni unité active", async () => {
  assert.equal(await sauvegardeSystemeEnCours(), false);
  if (spawnSync("systemctl", ["--version"]).error) assert.equal(await serviceMiseAJourActif(), true, "systemctl absent : état illisible, opération tenue pour en cours");
  const routes = readFileSync(new URL("../backup/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /sauvegardesManuelles\+\+;/);
  assert.match(routes, /finally \{\n      sauvegardesManuelles--;/);
});

test("dépôt sans version publiée (404) : ni erreur ni version annoncée, « aucune version publiée » (mini-PC d'essai, 21/10/2026)", async (t) => {
  const serveur = fauxServeur({ statut: 404, corps: { message: "Not Found" } });
  const s = await scene(t, { serveur });
  const admin = await s.as("admin");
  const vue = await admin("POST", "/api/mise-a-jour/verifier", undefined, FR);
  assert.equal(vue.status, 200);
  assert.deepEqual([vue.body.erreur, vue.body.disponible, vue.body.aucune_publiee], [null, null, true]);
  const gerante = await s.as("manager");
  assert.equal((await gerante("GET", "/api/mise-a-jour")).body.aucune_publiee, true, "la gérante lit le même état");
});
