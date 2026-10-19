import assert from "node:assert/strict";
import { test } from "node:test";
import { lireCoordonnees } from "./memoire.ts";
import { clienteEnvoyee, controler, memoriser, NOM_MAX, PRENOM_MAX, saisieInitiale, type Saisie } from "./saisie.ts";

function stockage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const INSTITUT = { telephone: "+237 600 00 00 00" };
const saisie = (o: Partial<Saisie> = {}): Saisie => ({
  prenom: "Bertille", nom: "Essai", telephone: "690 00 01 01", langue: "fr", note: "", accord: true, memoriser: false, piege: "", ...o,
});

test("contrôle : prénom puis nom obligatoires, puis téléphone et accord", () => {
  assert.deepEqual(controler(saisie({ prenom: "  " }), INSTITUT), { erreur: "erreur.prenom" });
  for (const prenom of ["Awa\nappelez", "www.x.com", "http://x.cm", "Awa 2", "Marie Claire Anne Ngo"]) {
    assert.deepEqual(controler(saisie({ prenom }), INSTITUT), { erreur: "erreur.prenom" }, JSON.stringify(prenom));
  }
  for (const prenom of ["Marie-Claire", "N'Dri", "Ngo  Bassa"]) assert.deepEqual(controler(saisie({ prenom }), INSTITUT), { telephone: "+237690000101" }, prenom);
  assert.deepEqual(controler(saisie({ nom: "" }), INSTITUT), { erreur: "erreur.nom" });
  assert.deepEqual(controler(saisie({ telephone: "12" }), INSTITUT), { erreur: "erreur.telephone" });
  assert.deepEqual(controler(saisie({ accord: false }), INSTITUT), { erreur: "erreur.accord" });
  assert.deepEqual(controler(saisie(), INSTITUT), { telephone: "+237690000101" });
});

test("contrôle du nom : une ligne de lettres, sans lien ni caractère caché ; le nom complet envoyé reste dans la forme du contrat", () => {
  for (const nom of ["Awa\nappelez", "www.x.com", "http://x.cm", "Awa\u202eNgo", "Awa\u200bNgo", "Ngo 2", "a b c d e f g h i"]) {
    assert.deepEqual(controler(saisie({ nom }), INSTITUT), { erreur: "erreur.nom" }, JSON.stringify(nom));
  }
  assert.deepEqual(controler(saisie({ prenom: "Marie Claire Anne", nom: "a b c d e f" }), INSTITUT), { erreur: "erreur.nom" }, "9 mots une fois le prénom devant");
  for (const nom of ["Ngo Bassa", "N'Dri Kouassi", "Marie-Claire Ébodé", "Ébodé  Ngo"]) assert.deepEqual(controler(saisie({ nom }), INSTITUT), { telephone: "+237690000101" }, nom);
});

test("cliente envoyée : prénom à part, nom complet « Prénom Nom », espaces réduits", () => {
  assert.deepEqual(clienteEnvoyee(saisie({ prenom: " Bertille ", nom: "Essai  Mballa " }), "+237690000101"),
    { prenom: "Bertille", nom: "Bertille Essai Mballa", telephone: "+237690000101", langue: "fr" });
  assert.ok(PRENOM_MAX + 1 + NOM_MAX <= 120, "le nom complet tient dans les 120 caractères du contrat");
});

test("mémoire : prénom et nom gardés à part, puis relus ; case décochée : oubliés", () => {
  const s = stockage();
  memoriser(saisie({ memoriser: true, prenom: " Bertille " }), s);
  assert.deepEqual(lireCoordonnees(s), { prenom: "Bertille", nom: "Essai", telephone: "690 00 01 01", langue: "fr" });
  const initiale = saisieInitiale("en", s);
  assert.deepEqual([initiale.prenom, initiale.nom, initiale.langue, initiale.memoriser, initiale.accord], ["Bertille", "Essai", "fr", true, false]);
  memoriser(saisie({ memoriser: false }), s);
  assert.equal(lireCoordonnees(s), null);
  const vierge = saisieInitiale("en", s);
  assert.deepEqual([vierge.prenom, vierge.nom, vierge.langue, vierge.memoriser], ["", "", "en", false]);
});
