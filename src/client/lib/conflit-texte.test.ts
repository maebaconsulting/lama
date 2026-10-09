import assert from "node:assert/strict";
import { test } from "node:test";
import { conflictSentence, describeConflict } from "./conflit-texte.ts";

/** Texte d'un conflit composé par l'écran, dans sa langue (sous-projet 4 § 7.3) : le serveur ne fige plus aucun mot. */

test("conflit sans cliente ni motif : texte composé dans la langue de l'écran", () => {
  const appt = { kind: "appointment" as const, start_time: "10:00", end_time: "11:00", label: "" };
  const block = { kind: "blocked" as const, start_time: "13:00", end_time: "14:00", label: "" };
  assert.equal(describeConflict(appt, "fr"), "10:00–11:00 déjà réservé");
  assert.equal(describeConflict(appt, "en"), "10:00–11:00 already booked");
  assert.equal(describeConflict(block, "fr"), "13:00–14:00 bloqué");
  assert.equal(describeConflict(block, "en"), "13:00–14:00 blocked");
});

test("conflit avec cliente ou motif : la donnée est gardée telle quelle", () => {
  assert.equal(describeConflict({ kind: "appointment", start_time: "10:00", end_time: "11:00", label: "Aïcha Mbarga" }, "fr"), "10:00–11:00 réservé pour Aïcha Mbarga");
  assert.equal(describeConflict({ kind: "blocked", start_time: "13:00", end_time: "14:00", label: "Pause" }, "en"), "13:00–14:00 Pause");
  assert.equal(
    conflictSentence("fr", "", [{ kind: "appointment", start_time: "10:00", end_time: "11:00", label: "" }]),
    "Ce membre de l'équipe n'est pas disponible\u00a0: 10:00–11:00 déjà réservé.",
  );
});
