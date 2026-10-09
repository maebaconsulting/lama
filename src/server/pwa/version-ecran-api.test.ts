import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/** Écran trop ancien refusé par l'API (PWA, P-05) ; tout autre appel inchangé. */
test("API : un écran annonçant une version plus ancienne que la minimale reçoit 409 « ecran_perime », traduit", async (t) => {
  const { raw } = await setupApp(t);
  const vieux = await raw("GET", "/api/auth/state", undefined, { "X-Lama-Ecran": "0", "Accept-Language": "fr" });
  assert.equal(vieux.status, 409);
  assert.deepEqual(vieux.body, { error: "Cet écran date d'une version précédente de lama\u00a0: rechargez la page.", code: "ecran_perime" });
  const vieuxEn = await raw("POST", "/api/auth/login", { login: "x", password: "y" }, { "X-Lama-Ecran": "0" });
  assert.deepEqual([vieuxEn.status, vieuxEn.body.code, vieuxEn.body.error], [409, "ecran_perime", "This screen is from a previous version of lama: reload the page."]);
  assert.equal((await raw("GET", "/api/auth/state", undefined, { "X-Lama-Ecran": "1" })).status, 200);
  assert.equal((await raw("GET", "/api/auth/state")).status, 200, "sans en-tête : curl, agents IA");
});
