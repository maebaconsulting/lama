import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bundleOf } from "../test-support.ts";
import { requeteHttps } from "./proxy.ts";

/** Démonstration publique derrière un proxy (démo publique DP-07) : X-Forwarded-Proto cru avec LAMA_PROXY_HTTPS=1 seulement ; cookies sécurisés. */

const BOOT = await bundleOf("./boot.ts");
const { readConfig } = await import(BOOT);

test("requeteHttps : écoute https toujours ; X-Forwarded-Proto seulement derrière un proxy de confiance, dernière valeur", () => {
  assert.equal(requeteHttps({ ecouteHttps: true, proxyHttps: false, forwardedProto: undefined }), true);
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: false, forwardedProto: "https" }), false, "sans LAMA_PROXY_HTTPS, l'en-tête est ignoré");
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: true, forwardedProto: "https" }), true);
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: true, forwardedProto: "HTTPS" }), true);
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: true, forwardedProto: "http" }), false);
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: true, forwardedProto: undefined }), false);
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: true, forwardedProto: "https, http" }), false, "valeur écrite par le client devant celle du proxy");
  assert.equal(requeteHttps({ ecouteHttps: false, proxyHttps: true, forwardedProto: "http, https" }), true);
});

test("configuration : LAMA_PROXY_HTTPS=1 seulement", () => {
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1", LAMA_PROXY_HTTPS: "1" }).proxyHttps, true);
  assert.equal(readConfig({ LAMA_DEMO_PUBLIQUE: "1" }).proxyHttps, false);
  assert.equal(readConfig({ LAMA_PROXY_HTTPS: "oui" }).proxyHttps, false);
});

/** Démarre une démonstration publique (exemplaire neuf du module) et rend les cookies posés par la connexion de la gérante sous `entetes`. */
async function cookiesDeConnexion(proxyHttps: boolean, essais: Record<string, string>[]): Promise<string[][]> {
  const avant = [process.env.LAMA_FORMATION, process.env.LAMA_DEMO_PUBLIQUE];
  const { start, shutdown } = await import(`${BOOT}#proxy-${proxyHttps}`);
  const dir = mkdtempSync(join(tmpdir(), "lama-proxy-"));
  const running = await start({ dataDir: dir, configDir: join(dir, "config"), port: 0, staticDir: null, dev: false, usbDir: join(dir, "sans-sauvegarde"), tlsDir: null, httpPort: null, formation: true, demoPublique: true, proxyHttps });
  try {
    const sorties: string[][] = [];
    for (const entetes of essais) {
      const reponse = await fetch(`http://127.0.0.1:${running.port}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Lama": "1", ...entetes },
        body: JSON.stringify({ login: "gerante", password: "gerante-demo" }),
      });
      assert.equal(reponse.status, 200);
      sorties.push(reponse.headers.getSetCookie());
    }
    return sorties;
  } finally {
    await shutdown(running);
    rmSync(dir, { recursive: true, force: true });
    for (const [nom, valeur] of [["LAMA_FORMATION", avant[0]], ["LAMA_DEMO_PUBLIQUE", avant[1]]] as const) {
      if (valeur === undefined) delete process.env[nom];
      else process.env[nom] = valeur;
    }
  }
}

test("derrière le proxy (LAMA_PROXY_HTTPS=1) : session de la démonstration en __Host-, Secure, HttpOnly, SameSite=Strict, Path=/, sans Domain ; en http, nom nu sans Secure", async () => {
  const [https, http, imite] = await cookiesDeConnexion(true, [{ "X-Forwarded-Proto": "https" }, {}, { "x-lama-https": "1" }]);
  assert.equal(https.length, 1);
  const [paire, ...attributs] = https[0].split(";").map((a) => a.trim());
  assert.match(paire, /^__Host-lama_formation_session=[^;]+$/);
  for (const attendu of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(attributs.includes(attendu), `${attendu} dans ${https[0]}`);
  assert.ok(!attributs.some((a) => /^domain=/i.test(a)), "jamais de Domain");
  assert.match(http[0], /^lama_formation_session=/);
  assert.doesNotMatch(http[0], /Secure/);
  assert.match(imite[0], /^lama_formation_session=/, "l'en-tête interne envoyé par le client est toujours écrasé");
});

test("sans LAMA_PROXY_HTTPS : X-Forwarded-Proto ignoré, jamais de cookie Secure sur une requête http", async () => {
  const [https] = await cookiesDeConnexion(false, [{ "X-Forwarded-Proto": "https" }]);
  assert.match(https[0], /^lama_formation_session=/);
  assert.doesNotMatch(https[0], /Secure/);
});
