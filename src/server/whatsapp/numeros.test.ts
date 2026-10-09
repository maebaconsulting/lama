import assert from "node:assert/strict";
import { test } from "node:test";
import { appointmentAt, inSilence, normalizePhone, silenceEnd } from "./numeros.ts";

test("numéros : format international en chiffres seuls, 237 ajouté s'il manque", () => {
  const cases: [string, string | null][] = [
    ["699 12 34 56", "237699123456"],
    ["699-12-34-56", "237699123456"],
    ["(699) 12.34.56", "237699123456"],
    ["237699123456", "237699123456"],
    ["+237 699 12 34 56", "237699123456"],
    ["00237 699 12 34 56", "237699123456"],
    ["+33 6 12 34 56 78", "33612345678"],
    ["0033612345678", "33612345678"],
    ["  699123456  ", "237699123456"],
  ];
  for (const [raw, expected] of cases) assert.equal(normalizePhone(raw, "237"), expected, raw);
});

test("numéros impossibles à normaliser : null", () => {
  for (const raw of ["", "   ", "12345", "abc", "699 12 34 5x", "+", "+1234567890123456", "06 99"]) assert.equal(normalizePhone(raw, "237"), null, raw);
});

test("autre indicatif par défaut (réglage whatsapp.indicatif)", () => {
  assert.equal(normalizePhone("612345678", "33"), "33612345678");
  assert.equal(normalizePhone("0612345678", "33"), "33612345678", "le 0 national est retiré");
});

const at = (iso: string) => Date.parse(iso);

test("heure d'un rendez-vous : date et heure de Douala (UTC+1, sans heure d'été)", () => {
  assert.equal(appointmentAt("2026-10-02", "10:00"), at("2026-10-02T09:00:00Z"));
  assert.equal(appointmentAt("2026-10-02", "10:00:00"), at("2026-10-02T09:00:00Z"));
});

test("heure à un seul chiffre (« 9:30 ») : complétée sur deux chiffres, instant valide (pas NaN)", () => {
  assert.equal(appointmentAt("2026-10-02", "9:30"), at("2026-10-02T08:30:00Z"));
  assert.ok(!Number.isNaN(appointmentAt("2026-10-02", "9:05")));
});

test("fenêtre de silence de 21:00 à 08:00 (heure de Douala) : fin de la fenêtre, ou null hors fenêtre", () => {
  assert.equal(silenceEnd(at("2026-10-01T19:59:00Z"), "21:00", "08:00"), null, "20:59 à Douala");
  assert.equal(silenceEnd(at("2026-10-01T20:00:00Z"), "21:00", "08:00"), at("2026-10-02T07:00:00Z"), "21:00 : jusqu'au lendemain 08:00");
  assert.equal(silenceEnd(at("2026-10-01T23:30:00Z"), "21:00", "08:00"), at("2026-10-02T07:00:00Z"), "00:30 : jusqu'à 08:00 le jour même");
  assert.equal(silenceEnd(at("2026-10-02T06:59:00Z"), "21:00", "08:00"), at("2026-10-02T07:00:00Z"), "07:59");
  assert.equal(silenceEnd(at("2026-10-02T07:00:00Z"), "21:00", "08:00"), null, "08:00 pile : fin du silence");
  assert.equal(silenceEnd(at("2026-10-02T11:30:00Z"), "13:00", "14:00"), null, "12:30 à Douala : avant la fenêtre de la journée");
  assert.equal(silenceEnd(at("2026-10-02T12:30:00Z"), "12:00", "14:00"), at("2026-10-02T13:00:00Z"), "13:30 à Douala : pendant");
  assert.equal(silenceEnd(at("2026-10-02T12:30:00Z"), "08:00", "08:00"), null, "début égal à la fin : aucun silence");
  assert.equal(inSilence(at("2026-10-01T20:00:00Z"), "21:00", "08:00"), true);
});
