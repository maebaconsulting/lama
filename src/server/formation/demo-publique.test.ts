import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { avecDemoPublique as avecDemo, bundleOf } from "../test-support.ts";
import { manifesteWeb } from "../pwa/manifeste.ts";
import type { TicketRow } from "../caisse/ticket.ts";
import { marquerFormation } from "./marque.ts";
import { estDemoPublique, estFormation } from "./mode.ts";

/** Démonstration publique (démo publique DP-01, DP-04, DP-07, DP-08) : configuration, mode du processus, repères, démarrage. */

// boot.ts importe index.ts, dont les imports internes finissent en .js : on le charge assemblé, comme en production.
const { readConfig, start, shutdown } = await import(await bundleOf("./boot.ts"));

test("configuration : LAMA_DEMO_PUBLIQUE=1 donne la formation dans /data, le port 8080, ni certificat ni écoute http ni disque de sauvegarde", () => {
  const demo = readConfig({ LAMA_DEMO_PUBLIQUE: "1", LAMA_TLS_DIR: "/etc/lama/tls", LAMA_HTTP_PORT: "80", LAMA_BACKUP_DIR: "/mnt/lama-sauvegarde" });
  assert.deepEqual(
    [demo.demoPublique, demo.formation, demo.dataDir, demo.configDir, demo.port, demo.httpPort, demo.tlsDir, demo.usbDir],
    [true, true, "/data", "/data/config", 8080, null, null, "/data/sans-sauvegarde"],
  );
  const ailleurs = readConfig({ LAMA_DEMO_PUBLIQUE: "1", LAMA_DATA_DIR: "/srv/demo", LAMA_PORT: "9000" });
  assert.deepEqual([ailleurs.dataDir, ailleurs.configDir, ailleurs.port], ["/srv/demo", "/srv/demo/config", 9000]);
  assert.equal(readConfig({}).demoPublique, false);
  assert.equal(readConfig({ LAMA_FORMATION: "1" }).demoPublique, false, "la formation de l'institut n'est pas la démonstration publique");
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "0" }).demoPublique, false, "seul 1 active la démonstration publique");
});

test("configuration : LAMA_PROXY_HTTPS=1 n'a d'effet que dans la démonstration publique", () => {
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1", LAMA_PROXY_HTTPS: "1" }).proxyHttps, true);
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1" }).proxyHttps, false, "démonstration sans la variable");
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1", LAMA_PROXY_HTTPS: "true" }).proxyHttps, false, "seul 1 compte");
  for (const env of [{ LAMA_PROXY_HTTPS: "1" }, { LAMA_FORMATION: "1", LAMA_PROXY_HTTPS: "1" }, { LAMA_DEMO_PUBLIQUE: "0", LAMA_PROXY_HTTPS: "1" }, { LAMA_DEV: "1", LAMA_PROXY_HTTPS: "1" }]) {
    assert.equal(readConfig(env).proxyHttps, false, JSON.stringify(env));
  }
});

test("mode du processus : posé par definirDemoPublique, lu par estDemoPublique", async () => {
  await avecDemo(true, () => assert.deepEqual([estDemoPublique(), estFormation()], [true, true]));
  await avecDemo(false, () => assert.deepEqual([estDemoPublique(), estFormation()], [false, false]));
});

test("repères : « DÉMONSTRATION » (« DEMO » en anglais) sur les documents, « lama démo » dans le manifeste", async () => {
  const rows: TicketRow[] = [{ type: "text", text: "FACTURE", style: "titre", align: "center" }];
  const mention = (text: string): TicketRow => ({ type: "text", text, style: "total", align: "center" });
  assert.deepEqual(await avecDemo(true, () => marquerFormation(rows, "fr")), [mention("DÉMONSTRATION"), { type: "rule" }, ...rows, { type: "rule" }, mention("DÉMONSTRATION")]);
  assert.deepEqual((await avecDemo(true, () => marquerFormation(rows, "en")))[0], mention("DEMO"));
  assert.equal(await avecDemo(false, () => marquerFormation(rows, "fr")), rows);
  const manifeste = manifesteWeb({ nom: "Institut Démo", langue: "fr" }, true, true);
  assert.deepEqual([manifeste.name, manifeste.short_name], ["lama démo", "lama démo"]);
  assert.equal(manifesteWeb({ nom: "Institut Démo", langue: "en" }, true, true).name, "lama demo");
  assert.equal(manifesteWeb({ nom: "Institut Démo", langue: "fr" }, true).name, "lama formation", "la formation de l'institut garde son nom");
});

test("démarrage en démonstration publique : clé maîtresse créée si elle manque, page du certificat absente, manifeste « lama démo »", async () => {
  const avant = [process.env.LAMA_FORMATION, process.env.LAMA_DEMO_PUBLIQUE];
  const dir = mkdtempSync(join(tmpdir(), "lama-demo-boot-"));
  const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true, demoPublique: true });
  try {
    assert.deepEqual([process.env.LAMA_DEMO_PUBLIQUE, process.env.LAMA_FORMATION], ["1", "1"]);
    const cle = join(dir, "config", "master.key");
    assert.ok(existsSync(cle));
    assert.equal(statSync(cle).mode & 0o777, 0o600);
    assert.equal(Buffer.from(readFileSync(cle, "utf8").trim(), "base64").length, 32);
    const base = `http://127.0.0.1:${running.port}`;
    for (const chemin of ["/certificat", "/certificat/autorite.crt", "/certificat/ok"]) assert.equal((await fetch(base + chemin)).status, 404, chemin);
    assert.equal(((await (await fetch(`${base}/manifest.webmanifest`)).json()) as { name: string }).name, "lama démo");
  } finally {
    await shutdown(running);
    rmSync(dir, { recursive: true, force: true });
    for (const [nom, valeur] of [["LAMA_FORMATION", avant[0]], ["LAMA_DEMO_PUBLIQUE", avant[1]]] as const) {
      if (valeur === undefined) delete process.env[nom];
      else process.env[nom] = valeur;
    }
  }
});

test("hors démonstration publique, la clé maîtresse n'est jamais créée par le serveur (l'installation réelle exige l'installateur)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lama-demo-sans-cle-"));
  try {
    await assert.rejects(
      start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true }),
      /Clé maîtresse introuvable/,
    );
    assert.ok(!existsSync(join(dir, "config", "master.key")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.LAMA_DEMO_PUBLIQUE;
    delete process.env.LAMA_FORMATION;
  }
});

test("démarrage : la démonstration publique est toujours une formation, même omise par l'appelant ; la vraie base est refusée avant tout accès", async () => {
  try {
    await assert.rejects(
      start({ dataDir: "/var/lib/lama/demo", configDir: "/var/lib/lama/demo/config", port: 0, staticDir: null, dev: false, usbDir: "/tmp/lama-sans-sauvegarde", tlsDir: null, httpPort: null, demoPublique: true }),
      /vraie base|real database/,
    );
  } finally {
    delete process.env.LAMA_DEMO_PUBLIQUE;
    delete process.env.LAMA_FORMATION;
  }
});
