import assert from "node:assert/strict";
import { test } from "node:test";
import { setupApp } from "../test-support.ts";

/**
 * Réglages de la caisse (sous-projet 5 § 5.2) : acomptes et avoirs par la
 * réception, désactivés par défaut ; gérante seulement ; valeurs contrôlées ;
 * chaque changement au journal. Écran : rubrique « Caisse ».
 */

test("acomptes et avoirs par la réception : non par défaut, oui ou non seulement, gérante seulement, journal", async (t) => {
  const ctx = await setupApp(t, { demo: false });
  const g = await ctx.as("manager");
  const settings = (await g("GET", "/api/settings")).body.settings as { key: string; value: unknown }[];
  const value = (key: string) => settings.find((s) => s.key === key)?.value;
  assert.deepEqual([value("caisse.acomptes"), value("caisse.avoirs_reception")], [false, false]);
  assert.equal((await g("PUT", "/api/settings/caisse.acomptes", { value: true })).status, 200);
  assert.equal((await g("PUT", "/api/settings/caisse.avoirs_reception", { value: "oui" })).status, 400);
  const r = await ctx.as("reception");
  assert.equal((await r("PUT", "/api/settings/caisse.avoirs_reception", { value: true })).status, 403);
  const journal = ctx.db.prepare("SELECT action, target FROM audit_log WHERE action = 'reglage'").all().map((row) => ({ ...row }));
  assert.deepEqual(journal, [{ action: "reglage", target: "caisse.acomptes" }]);
});
