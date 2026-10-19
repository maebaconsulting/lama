import assert from "node:assert/strict";
import { test } from "node:test";
import { chiffrer, dechiffrer, egal, nouvelleCle } from "./coffre.ts";

const MAITRE = "m".repeat(48);

test("coffre : chiffré puis déchiffré, jamais deux fois le même scellé", async () => {
  const a = await chiffrer(MAITRE, "eclat", "secret du salon");
  const b = await chiffrer(MAITRE, "eclat", "secret du salon");
  assert.match(a, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b);
  assert.ok(!a.includes("secret"));
  assert.equal(await dechiffrer(MAITRE, "eclat", a), "secret du salon");
});

test("coffre : mauvaise clé générale, scellé abîmé ou mal formé : null", async () => {
  const a = await chiffrer(MAITRE, "eclat", "secret");
  assert.equal(await dechiffrer("n".repeat(48), "eclat", a), null);
  const [v, iv, ct] = a.split(".");
  const abime = `${v}.${iv}.${ct.slice(0, -4)}AAAA`;
  assert.equal(await dechiffrer(MAITRE, "eclat", abime), null);
  assert.equal(await dechiffrer(MAITRE, "eclat", "v2.x.y"), null);
  assert.equal(await dechiffrer(MAITRE, "eclat", "n'importe quoi"), null);
});

test("nouvelle clé : 64 caractères hexadécimaux, toujours différente", () => {
  const a = nouvelleCle();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, nouvelleCle());
});

test("égalité en temps constant", () => {
  assert.equal(egal("abc", "abc"), true);
  assert.equal(egal("abc", "abd"), false);
  assert.equal(egal("abc", "ab"), false);
  assert.equal(egal("", ""), true);
});

test("coffre : scellé lié à l'identifiant du salon et vecteur de 12 octets exigé", async () => {
  const a = await chiffrer(MAITRE, "eclat", "secret");
  assert.equal(await dechiffrer(MAITRE, "voisin", a), null);
  const [v, , ct] = a.split(".");
  assert.equal(await dechiffrer(MAITRE, "eclat", `${v}.${btoa("court")}.${ct}`), null);
  assert.equal(await dechiffrer(MAITRE, "eclat", `${v}.${btoa("x".repeat(16))}.${ct}`), null);
});
