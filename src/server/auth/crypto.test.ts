import assert from "node:assert/strict";
import { test } from "node:test";
import { hashSecret, hashToken, newToken, openSecret, passwordProblem, pinProblem, sealSecret, verifySecret } from "./crypto.ts";

test("hashSecret produit une empreinte salée vérifiable", async () => {
  const a = await hashSecret("Bonapriso2026!");
  const b = await hashSecret("Bonapriso2026!");
  assert.match(a, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);
  assert.ok(await verifySecret("Bonapriso2026!", a));
  assert.ok(!(await verifySecret("bonapriso2026!", a)));
});

test("verifySecret refuse une empreinte absente ou malformée", async () => {
  assert.equal(await verifySecret("x", null), false);
  assert.equal(await verifySecret("x", undefined), false);
  assert.equal(await verifySecret("x", "md5$abc$def"), false);
});

test("scrypt ne bloque pas la boucle d'événements (calcul asynchrone)", async () => {
  const stored = await hashSecret("Bonapriso2026!");
  const order: string[] = [];
  const pending = Promise.resolve(verifySecret("Bonapriso2026!", stored)).then(() => order.push("scrypt"));
  setImmediate(() => order.push("boucle"));
  await pending;
  await new Promise((ok) => setImmediate(ok));
  assert.deepEqual(order, ["boucle", "scrypt"], "la boucle tourne pendant le calcul");
});

test("les jetons sont longs, uniques, et seule leur empreinte est stockable", () => {
  const t1 = newToken();
  assert.match(t1, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(t1, newToken());
  assert.match(hashToken(t1), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(t1), hashToken(t1));
});

test("règles du mot de passe", () => {
  assert.equal(passwordProblem("court"), "compte.mot_de_passe_court");
  assert.equal(passwordProblem("assez-long-1"), null);
});

test("règles du PIN : 4 à 6 chiffres, pas de code trivial", () => {
  assert.equal(pinProblem("12a4"), "compte.pin_format");
  assert.equal(pinProblem("123"), "compte.pin_format");
  for (const trivial of ["0000", "1111", "1234", "4321", "123456", "987654", "1212", "121212"]) {
    assert.equal(pinProblem(trivial), "compte.pin_simple", trivial);
  }
  for (const ok of ["2580", "7391", "480617"]) assert.equal(pinProblem(ok), null, ok);
});

test("le coffre à secrets chiffre, déchiffre et détecte l'altération", () => {
  const key = new Uint8Array(32).fill(3);
  const sealed = sealSecret("jeton-whatsapp", key);
  assert.match(sealed, /^v1\./);
  assert.ok(!sealed.includes("jeton-whatsapp"));
  assert.equal(openSecret(sealed, key), "jeton-whatsapp");
  assert.throws(() => openSecret(sealed, new Uint8Array(32).fill(4)));
  const parts = sealed.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.throws(() => openSecret(parts.join("."), key));
});
