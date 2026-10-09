import assert from "node:assert/strict";
import { test } from "node:test";
import { issueNotice, keepOutcome, takeOutcome } from "./impression.ts";

test("message après l'émission : imprimé, raison de l'échec, ou rien si l'impression n'était pas demandée", () => {
  assert.deepEqual(issueNotice({ printed: true }), { ok: "impression.imprime" });
  assert.deepEqual(issueNotice({ print_error: "Plus de papier dans l'imprimante." }), { error: "Plus de papier dans l'imprimante." });
  assert.equal(issueNotice({}), null);
  assert.equal(issueNotice(undefined), null);
});

test("résultat gardé entre le formulaire et la fiche : rendu une seule fois, rien gardé sans impression demandée", () => {
  keepOutcome("credit", 7, { printed: true });
  assert.deepEqual(takeOutcome("credit", 7), { printed: true, print_error: undefined });
  assert.equal(takeOutcome("credit", 7), undefined);
  keepOutcome("deposit", 3, {});
  assert.equal(takeOutcome("deposit", 3), undefined);
});
