import assert from "node:assert/strict";
import { test } from "node:test";
import { smsStatusText } from "./sms.ts";

test("état de la passerelle SMS, dans les deux langues", () => {
  assert.equal(smsStatusText({ provider: "aucun" }, "fr"), "Aucune passerelle SMS.");
  assert.equal(smsStatusText({ provider: "passerelle", state: "joignable" }, "fr"), "Passerelle joignable.");
  assert.equal(smsStatusText({ provider: "passerelle", state: "identifiants" }, "fr"), "Identifiant ou mot de passe refusé.");
  assert.equal(smsStatusText({ provider: "passerelle", state: "injoignable" }, "en"), "Gateway unreachable.");
});
