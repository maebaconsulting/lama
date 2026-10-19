import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { chaineASigner, ECART_MAX_MS, sha256Hex, signer, verifierSignature } from "./signature.ts";

const CLE = "0123456789abcdef".repeat(4);
const H = "1792170000000";

test("chaîne à signer : horodatage, MÉTHODE, chemin avec requête, SHA-256 du corps, séparés par des retours à la ligne", async () => {
  const corps = '{"a":1}';
  const empreinte = createHash("sha256").update(corps).digest("hex");
  assert.equal(await chaineASigner(H, "put", "/lama/v1/offre", corps), `${H}\nPUT\n/lama/v1/offre\n${empreinte}`);
  assert.equal(await sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});

test("signature : HMAC-SHA256 hexadécimal minuscule, identique à celle de node:crypto", async () => {
  const chemin = "/lama/v1/demandes?apres=000000000012&limite=50";
  const attendue = createHmac("sha256", CLE).update(`${H}\nGET\n${chemin}\n${createHash("sha256").update("").digest("hex")}`).digest("hex");
  assert.equal(await signer(CLE, H, "GET", chemin, ""), attendue);
});

test("vérification : bonne signature acceptée ; clé, corps ou chemin changés refusés", async () => {
  const signature = await signer(CLE, H, "PUT", "/lama/v1/offre", "{}");
  const base = { cle: CLE, horodatage: H, signature, methode: "PUT", chemin: "/lama/v1/offre", corps: "{}", maintenant: Number(H) };
  assert.equal(await verifierSignature(base), "ok");
  assert.equal(await verifierSignature({ ...base, cle: `${CLE}x` }), "signature");
  assert.equal(await verifierSignature({ ...base, corps: "{ }" }), "signature");
  assert.equal(await verifierSignature({ ...base, chemin: "/lama/v1/disponibilites" }), "signature");
  assert.equal(await verifierSignature({ ...base, signature: signature.toUpperCase() }), "signature");
  assert.equal(await verifierSignature({ ...base, signature: null }), "signature");
  assert.equal(await verifierSignature({ ...base, signature: "zz" }), "signature");
});

test("vérification : horodatage à 5 minutes accepté, au-delà refusé, absent ou mal formé refusé", async () => {
  const signature = await signer(CLE, H, "GET", "/lama/v1/etat", "");
  const base = { cle: CLE, horodatage: H, signature, methode: "GET", chemin: "/lama/v1/etat", corps: "" };
  assert.equal(await verifierSignature({ ...base, maintenant: Number(H) + ECART_MAX_MS }), "ok");
  assert.equal(await verifierSignature({ ...base, maintenant: Number(H) - ECART_MAX_MS }), "ok");
  assert.equal(await verifierSignature({ ...base, maintenant: Number(H) + ECART_MAX_MS + 1 }), "horodatage");
  assert.equal(await verifierSignature({ ...base, horodatage: null, maintenant: Number(H) }), "horodatage");
  assert.equal(await verifierSignature({ ...base, horodatage: "12a", maintenant: Number(H) }), "horodatage");
});
