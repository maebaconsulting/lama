import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./http.ts";
import { createSharedRequest, isConfirmationRequired, withConfirmation } from "./confirmation.ts";

const required = () => new ApiError("Confirmation par mot de passe requise.", 403, "confirmation", null);

test("sans demande du serveur, l'action passe sans mot de passe", async () => {
  let asked = 0;
  assert.equal(await withConfirmation(async () => "fait", async () => { asked++; return true; }), "fait");
  assert.equal(asked, 0);
});

test("confirmation demandée puis donnée : l'action est rejouée une fois", async () => {
  let calls = 0;
  const action = async () => { if (calls++ === 0) throw required(); return "fait"; };
  assert.equal(await withConfirmation(action, async () => true), "fait");
  assert.equal(calls, 2);
});

test("confirmation annulée : rien n'est rejoué, résultat null", async () => {
  let calls = 0;
  const action = async () => { calls++; throw required(); };
  assert.equal(await withConfirmation(action, async () => false), null);
  assert.equal(calls, 1);
});

test("autre refus : transmis tel quel, sans demander de mot de passe", async () => {
  let asked = 0;
  await assert.rejects(
    withConfirmation(async () => { throw new ApiError("Accès refusé.", 403, null, null); }, async () => { asked++; return true; }),
    /Accès refusé/,
  );
  assert.equal(asked, 0);
  assert.equal(isConfirmationRequired(new ApiError("x", 403, null, null)), false);
  assert.equal(isConfirmationRequired(required()), true);
});

test("deux demandes avant la réponse partagent la même promesse, résolues ensemble", async () => {
  let opens = 0;
  const shared = createSharedRequest(() => { opens++; });
  const a = shared.request();
  const b = shared.request();
  assert.equal(a, b);
  assert.equal(opens, 1);
  shared.settle(true);
  assert.equal(await a, true);
  assert.equal(await b, true);
});

test("après la réponse, une nouvelle demande rouvre", async () => {
  let opens = 0;
  const shared = createSharedRequest(() => { opens++; });
  const a = shared.request();
  shared.settle(false);
  assert.equal(await a, false);
  const b = shared.request();
  assert.equal(opens, 2);
  shared.settle(true);
  assert.equal(await b, true);
});

test("répondre sans demande en cours ne fait rien", () => {
  let opens = 0;
  const shared = createSharedRequest(() => { opens++; });
  assert.doesNotThrow(() => shared.settle(true));
  assert.equal(opens, 0);
});
