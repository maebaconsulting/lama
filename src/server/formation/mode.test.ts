import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, symlinkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { avecFormation, bundleOf, setupApp } from "../test-support.ts";
import { manifesteWeb } from "../pwa/manifeste.ts";
import { definirFormation, estFormation, garderContre, garderContreVraieBase, nomCookie } from "./mode.ts";

/** Base de formation (distribution D-14, D-15, PWA P-01) : configuration, mode du processus, cookies propres, état public, manifeste. */

// boot.ts importe index.ts, dont les imports internes finissent en .js : on le charge assemblé, comme en production.
// Chemin relatif à test-support.ts (src/server), comme dans les autres essais.
const { readConfig, start } = await import(await bundleOf("./boot.ts"));

/** Noms des cookies posés par une réponse. */
const noms = (headers: Headers) => headers.getSetCookie().map((c) => c.slice(0, c.indexOf("=")));

test("configuration : LAMA_FORMATION=1 donne ses dossiers, le port 8443, le même certificat, jamais d'écoute http ni de disque de sauvegarde", () => {
  const formation = readConfig({ LAMA_FORMATION: "1", LAMA_HTTP_PORT: "80", LAMA_BACKUP_DIR: "/mnt/lama-sauvegarde" });
  assert.deepEqual(
    [formation.formation, formation.dataDir, formation.configDir, formation.port, formation.httpPort, formation.tlsDir, formation.usbDir],
    [true, "/var/lib/lama-formation", "/etc/lama-formation", 8443, null, "/etc/lama/tls", "/var/lib/lama-formation/sans-sauvegarde"],
  );
  const vraie = readConfig({});
  assert.deepEqual([vraie.formation, vraie.dataDir, vraie.configDir, vraie.port, vraie.httpPort, vraie.usbDir], [false, "/var/lib/lama", "/etc/lama", 443, 80, "/mnt/lama-sauvegarde"]);
  assert.equal(readConfig({ LAMA_FORMATION: "0" }).formation, false, "seul 1 active la formation");
});

test("mode du processus : posé par definirFormation, lu par estFormation ; noms de cookies propres à la formation", async () => {
  await avecFormation(false, () => {
    definirFormation(true);
    assert.equal(estFormation(), true);
    assert.deepEqual([nomCookie("lama_session"), nomCookie("lama_poste")], ["lama_formation_session", "lama_formation_poste"]);
    definirFormation(false);
    assert.equal(estFormation(), false);
    assert.deepEqual([nomCookie("lama_session"), nomCookie("lama_poste")], ["lama_session", "lama_poste"]);
  });
});

test("cookies : lama_formation_session en http, __Host-lama_formation_session en https ; le cookie de la vraie base est ignoré", async (t) => {
  await avecFormation(true, async () => {
    const ctx = await setupApp(t, { demo: false });
    const { login, password } = await ctx.seedAccount("manager", "formation.gerante");
    const http = await ctx.raw("POST", "/api/auth/login", { login, password }, { "X-Lama": "1" });
    assert.equal(http.status, 200);
    assert.deepEqual(noms(http.headers), ["lama_formation_session"]);
    const https = await ctx.raw("POST", "/api/auth/login", { login, password }, { "X-Lama": "1", "x-lama-https": "1" });
    assert.deepEqual(noms(https.headers), ["__Host-lama_formation_session"]);
    assert.match(https.headers.getSetCookie()[0], /;\s*Secure/i);
    const jeton = https.headers.getSetCookie()[0].split(";")[0].split("=")[1];
    const vraie = await ctx.raw("GET", "/api/auth/me", undefined, { cookie: `__Host-lama_session=${jeton}`, "x-lama-https": "1" });
    assert.equal(vraie.status, 401, "un cookie au nom de la vraie base n'ouvre rien en formation");
    const propre = await ctx.raw("GET", "/api/auth/me", undefined, { cookie: `__Host-lama_formation_session=${jeton}`, "x-lama-https": "1" });
    assert.equal(propre.status, 200);
  });
});

test("état public : formation vrai ou faux ; en formation, l'écran d'installation est refusé (comptes créés par le technicien)", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  await avecFormation(false, async () => assert.equal((await ctx.raw("GET", "/api/auth/state")).body.formation, false));
  await avecFormation(true, async () => assert.equal((await ctx.raw("GET", "/api/auth/state")).body.formation, true));
  await avecFormation(true, async () => {
    const install = await ctx.raw("POST", "/api/auth/install", { display_name: "Dan", login: "dan", password: "assez-long-1" }, { "X-Lama": "1", "accept-language": "fr" });
    assert.equal(install.status, 409);
    assert.equal(install.body.code, "formation");
    assert.match(install.body.error, /sudo lama-formation --comptes/);
  });
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n, 0);
});

test("manifeste : « lama formation » (« lama training » en anglais) pour la base de formation, nom de l'institut inchangé ailleurs", () => {
  const formation = manifesteWeb({ nom: "Institut Démo", langue: "fr" }, true);
  assert.deepEqual([formation.name, formation.short_name, formation.start_url], ["lama formation", "lama formation", "/"]);
  assert.equal(manifesteWeb({ nom: "Institut Démo", langue: "en" }, true).name, "lama training");
  assert.equal(manifesteWeb({ nom: "Institut Démo", langue: "fr" }).name, "lama, Institut Démo");
});

test("démarrage en formation : clé maîtresse propre, aucune clé de sauvegarde demandée, manifeste « lama formation », mode posé", async () => {
  await avecFormation(true, async () => {
    const dir = mkdtempSync(join(tmpdir(), "lama-formation-boot-"));
    mkdirSync(join(dir, "config"));
    writeFileSync(join(dir, "config", "master.key"), randomBytes(32).toString("base64"), { mode: 0o600 });
    const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true });
    try {
      assert.equal(process.env.LAMA_FORMATION, "1");
      const manifeste = (await (await fetch(`http://127.0.0.1:${running.port}/manifest.webmanifest`)).json()) as { name: string };
      assert.equal(manifeste.name, "lama formation");
      assert.equal(((await (await fetch(`http://127.0.0.1:${running.port}/api/auth/state`)).json()) as { formation: boolean }).formation, true);
    } finally {
      running.stopWorker();
      running.server.close();
      running.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("garde : un dossier de données dans la vraie base est refusé (chemins résolus, sous-dossiers, barre finale)", () => {
  for (const dataDir of ["/var/lib/lama", "/var/lib/lama/", "/var/lib/lama/sous/dossier", "/var/lib/formation/../lama"]) {
    assert.throws(() => garderContreVraieBase(dataDir, "/tmp/lama-formation-ok", "fr"), /vraie base/, dataDir);
  }
  assert.throws(() => garderContreVraieBase("/var/lib/lama", "/tmp/lama-formation-ok", "en"), /real database/);
});

test("garde : un dossier de configuration dans la vraie base est refusé", () => {
  for (const configDir of ["/etc/lama", "/etc/lama/tls", "/etc/lama/tls/../formation"]) {
    assert.throws(() => garderContreVraieBase("/tmp/lama-formation-ok", configDir, "fr"), /vraie base/, configDir);
  }
});

test("garde : les dossiers de la formation sont acceptés (lama-formation n'est pas dans lama)", () => {
  assert.doesNotThrow(() => garderContreVraieBase("/var/lib/lama-formation", "/etc/lama-formation", "fr"));
  assert.doesNotThrow(() => garderContreVraieBase("/tmp/lama-formation-ok", "/tmp/lama-formation-ok/config", "fr"));
});

test("garde : start refuse avant de créer ou d'ouvrir quoi que ce soit, par données comme par configuration", async () => {
  await avecFormation(true, async () => {
    const base = { port: 0, staticDir: null, dev: false, usbDir: "/tmp/lama-sans-sauvegarde", tlsDir: null, httpPort: null, formation: true };
    await assert.rejects(start({ ...base, dataDir: "/var/lib/lama", configDir: "/tmp/lama-formation-ok" }), /vraie base|real database/);
    await assert.rejects(start({ ...base, dataDir: "/tmp/lama-formation-ok", configDir: "/etc/lama" }), /vraie base|real database/);
  });
});

test("démarrage en formation et en développement : ni disque simulé ni clés de sauvegarde de développement", async () => {
  await avecFormation(true, async () => {
    const dir = mkdtempSync(join(tmpdir(), "lama-formation-dev-"));
    mkdirSync(join(dir, "config"));
    writeFileSync(join(dir, "config", "master.key"), randomBytes(32).toString("base64"), { mode: 0o600 });
    const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: true, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true });
    try {
      assert.equal(existsSync(join(dir, "sans-sauvegarde")), false, "aucun disque simulé");
      assert.equal(existsSync(join(dir, "config", "sauvegarde.pub")), false, "aucune clé de sauvegarde de développement");
    } finally {
      running.stopWorker();
      running.server.close();
      running.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

test("garde : liens symboliques, référence qui est un lien, candidat lien vers la référence, candidat inexistant sous un parent lien", () => {
  const racine = mkdtempSync(join(tmpdir(), "lama-garde-"));
  try {
    const vraie = join(racine, "vraie");
    const ailleurs = join(racine, "srv-lama");
    mkdirSync(join(vraie, "sous"), { recursive: true });
    mkdirSync(ailleurs);
    const ok = join(racine, "formation");
    mkdirSync(ok);
    // Référence qui est elle-même un lien vers un autre dossier : le candidat tapé en clair ou en réel est refusé.
    const lienReference = join(racine, "ref-lien");
    symlinkSync(ailleurs, lienReference);
    assert.throws(() => garderContre([lienReference], lienReference, ok, "fr"), /vraie base/, "référence lien, candidat identique");
    assert.throws(() => garderContre([lienReference], ailleurs, ok, "fr"), /vraie base/, "référence lien, candidat sur la cible");
    // Candidat qui est un lien vers la référence.
    const lienCandidat = join(racine, "cand-lien");
    symlinkSync(vraie, lienCandidat);
    assert.throws(() => garderContre([vraie], lienCandidat, ok, "fr"), /vraie base/, "candidat lien");
    assert.throws(() => garderContre([vraie], ok, join(lienCandidat, "sous"), "fr"), /vraie base/, "configuration sous un lien");
    // Candidat inexistant sous un parent qui est un lien vers la vraie base.
    assert.throws(() => garderContre([vraie], join(lienCandidat, "neuf", "profond"), ok, "fr"), /vraie base/, "inexistant sous un parent lien");
    // Cas accepté : dossier voisin, existant ou non.
    assert.doesNotThrow(() => garderContre([vraie, lienReference], ok, join(racine, "autre", "neuf"), "fr"));
    assert.doesNotThrow(() => garderContre([vraie], join(racine, "vraie-formation"), ok, "fr"), "préfixe de nom sans être dessous");
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
