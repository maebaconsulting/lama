import assert from "node:assert/strict";
import { test } from "node:test";
import { PAD_KEYS, press } from "./pin-pad.ts";

test("chiffres ajoutés jusqu'à 6, effacer retire le dernier", () => {
  let value = "";
  for (const k of "1234567") value = press(value, k).value;
  assert.equal(value, "123456");
  assert.equal(press(value, "effacer").value, "12345");
  assert.equal(press("", "effacer").value, "");
});

test("valider n'envoie qu'à partir de 4 chiffres", () => {
  assert.deepEqual(press("258", "valider"), { value: "258", submit: false });
  assert.deepEqual(press("2580", "valider"), { value: "2580", submit: true });
  assert.deepEqual(press("2580", "x"), { value: "2580", submit: false });
});

test("pavé de téléphone : 1 à 9, puis effacer, 0, valider", () => {
  assert.deepEqual([...PAD_KEYS], ["1", "2", "3", "4", "5", "6", "7", "8", "9", "effacer", "0", "valider"]);
});
