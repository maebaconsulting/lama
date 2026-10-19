import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { documentOpenAPI } from "./openapi.ts";

test("la description OpenAPI publiée est à jour (sinon : pnpm relais:openapi)", () => {
  const publiee = readFileSync(new URL("../../docs/reservation-en-ligne/contrat-v1.openapi.json", import.meta.url), "utf8");
  assert.equal(publiee, `${JSON.stringify(documentOpenAPI(), null, 2)}\n`);
});

test("elle décrit les six échanges et les deux routes d'essai, signées", () => {
  const doc = documentOpenAPI() as { paths: Record<string, Record<string, unknown>>; security: unknown[] };
  assert.deepEqual(Object.keys(doc.paths).sort(), [
    "/demandes", "/demandes/{id}/accuse", "/demandes/{id}/decision", "/disponibilites", "/essai/demande", "/essai/demande/{id}", "/etat", "/offre",
  ]);
  assert.ok(doc.paths["/etat"].get && doc.paths["/offre"].put && doc.paths["/disponibilites"].put && doc.paths["/demandes"].get);
  assert.equal(doc.security.length, 1);
});
