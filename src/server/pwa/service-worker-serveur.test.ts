import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleOf } from "../test-support.ts";

/** Service par le serveur des fichiers de l'application installable (PWA, P-03, P-05). */
test("serveur : /sw.js en JavaScript toujours revalidé, page d'entrée revalidée, fichiers à empreinte laissés au cache du navigateur", async () => {
  const { start } = await import(await bundleOf("./boot.ts"));
  const dir = mkdtempSync(join(tmpdir(), "lama-sw-"));
  const dist = join(dir, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(join(dist, "index.html"), "<!DOCTYPE html><title>lama</title>");
  writeFileSync(join(dist, "sw.js"), "\"use strict\";");
  writeFileSync(join(dist, "assets", "index-abc123.js"), "console.log(1);");
  const { server, port, db, stopWorker } = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: dist, dev: true, usbDir: join(dir, "usb") });
  const base = `http://127.0.0.1:${port}`;
  try {
    const sw = await fetch(`${base}/sw.js`);
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get("content-type") ?? "", /^text\/javascript/);
    assert.equal(sw.headers.get("cache-control"), "no-cache");
    for (const chemin of ["/", "/index.html", "/agenda", "/fr/caisse"]) {
      const page = await fetch(`${base}${chemin}`);
      assert.equal(page.status, 200, chemin);
      assert.match(page.headers.get("content-type") ?? "", /^text\/html/, chemin);
      assert.equal(page.headers.get("cache-control"), "no-cache", chemin);
      await page.arrayBuffer();
    }
    const script = await fetch(`${base}/assets/index-abc123.js`);
    assert.equal(script.headers.get("cache-control"), null, "nom à empreinte : aucune revalidation imposée");
    await script.arrayBuffer();
    const api = await fetch(`${base}/api/auth/state`);
    assert.match(api.headers.get("content-type") ?? "", /json/, "l'API reste à l'API");
    await api.arrayBuffer();
  } finally {
    stopWorker();
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
