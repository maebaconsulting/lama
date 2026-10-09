import assert from "node:assert/strict";
import { test } from "node:test";
import { auditQuery, dayEnd, dayStart } from "./journal.ts";

test("bornes d'une journée à Douala (UTC+1, sans heure d'été)", () => {
  assert.equal(dayStart("2026-09-28"), Date.parse("2026-09-27T23:00:00Z"));
  assert.equal(dayEnd("2026-09-28"), Date.parse("2026-09-28T22:59:59.999Z"));
  assert.equal(dayStart(""), null);
  assert.equal(dayStart("28/09/2026"), null);
});

test("filtre du journal : personne, période, limite", () => {
  assert.equal(auditQuery({ accountId: "", from: "", to: "" }), "limit=200");
  const q = new URLSearchParams(auditQuery({ accountId: "3", from: "2026-09-01", to: "2026-09-28" }, 50));
  assert.equal(q.get("account_id"), "3");
  assert.equal(q.get("from"), String(Date.parse("2026-08-31T23:00:00Z")));
  assert.equal(q.get("to"), String(Date.parse("2026-09-28T22:59:59.999Z")));
  assert.equal(q.get("limit"), "50");
});
