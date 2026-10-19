import assert from "node:assert/strict";
import { test } from "node:test";
import { ecrireCoordonnees, ecrireLangue, lireCoordonnees, lireLangue } from "./memoire.ts";

function stockage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const bloque = { getItem: () => { throw new Error("bloqué"); }, setItem: () => { throw new Error("bloqué"); }, removeItem: () => { throw new Error("bloqué"); } };

test("coordonnées gardées sur le téléphone, puis oubliées", () => {
  const s = stockage();
  assert.equal(lireCoordonnees(s), null);
  ecrireCoordonnees({ prenom: "Mireille", nom: "Ngo", telephone: "699 12 34 56", langue: "fr" }, s);
  assert.deepEqual(lireCoordonnees(s), { prenom: "Mireille", nom: "Ngo", telephone: "699 12 34 56", langue: "fr" });
  ecrireCoordonnees(null, s);
  assert.equal(lireCoordonnees(s), null);
});

test("mémoire d'avant le 18/10/2026 (un seul « Nom et prénom ») : rien n'est deviné, téléphone et langue repris", () => {
  const s = stockage();
  s.m.set("lama-relais-coordonnees", JSON.stringify({ nom: "Essai Bertille", telephone: "690 00 01 01", langue: "en" }));
  assert.deepEqual(lireCoordonnees(s), { prenom: "", nom: "", telephone: "690 00 01 01", langue: "en" });
});

test("stockage abîmé, bloqué ou absent : rien n'échoue", () => {
  const s = stockage();
  s.m.set("lama-relais-coordonnees", "{pas du json");
  assert.equal(lireCoordonnees(s), null);
  s.m.set("lama-relais-coordonnees", JSON.stringify({ nom: 1 }));
  assert.equal(lireCoordonnees(s), null);
  assert.equal(lireCoordonnees(bloque), null);
  assert.doesNotThrow(() => ecrireCoordonnees({ prenom: "A", nom: "B", telephone: "1", langue: "fr" }, bloque));
  assert.equal(lireCoordonnees(null), null);
});

test("langue retenue sur le téléphone : valeur valide seulement, stockage bloqué sans effet", () => {
  const s = stockage();
  assert.equal(lireLangue(s), null);
  ecrireLangue("en", s);
  assert.equal(lireLangue(s), "en");
  s.m.set("lama-relais-langue", "de");
  assert.equal(lireLangue(s), null);
  assert.doesNotThrow(() => ecrireLangue("fr", bloque));
  assert.equal(lireLangue(bloque), null);
});
