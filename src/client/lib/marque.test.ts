import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "../i18n/en.ts";
import { fr } from "../i18n/fr.ts";
import { affichageMarque, AFFICHAGES_MARQUE, contenuMarque, initiales, marqueEtat, motVisible, PLACES_MARQUE, tailleSigne, type PlaceMarque } from "./marque.ts";

/**
 * Marque du cadre (renommage lama, § 1) : signe et mot « lama » à l'entrée,
 * dans le rail ouvert et en tête du téléphone ; signe seul dans le rail replié.
 */

test("marque du cadre : quatre places, mot lama partout sauf dans le rail replié", () => {
  assert.deepEqual(Object.keys(PLACES_MARQUE).sort(), ["entree", "rail", "replie", "telephone"]);
  for (const place of ["entree", "rail", "telephone"] as PlaceMarque[]) assert.ok(PLACES_MARQUE[place].mot, place);
  assert.equal(PLACES_MARQUE.replie.mot, null, "rail replié : le signe seul");
  assert.deepEqual(
    (Object.keys(PLACES_MARQUE) as PlaceMarque[]).map((p) => [p, PLACES_MARQUE[p].disposition]),
    [["entree", "colonne"], ["rail", "colonne"], ["replie", "signe"], ["telephone", "ligne"]],
  );
  // Le signe du rail replié tient dans ses 64 px moins 8 px de chaque côté (48 px, w-12).
  const largeur = Number(PLACES_MARQUE.replie.signe.match(/\bw-(\d+)\b/)?.[1]);
  assert.ok(largeur > 0 && largeur <= 12, PLACES_MARQUE.replie.signe);
});

test("libellés de la marque : « lama » dans les deux langues (l'ancien nom : garde-fou de neutralite.test.ts)", () => {
  assert.equal(fr["marque.nom"], "lama");
  assert.equal(en["marque.nom"], "lama");
  assert.match(fr["marque.titre"], /^lama, /);
  assert.match(en["marque.titre"], /^lama, /);
  assert.ok(!("marque.sigle" in fr) && !("marque.sigle" in en), "le sigle en capitales n'a plus d'usage");
});

test("réglage marque.ecran : « Logo et nom » écrit le mot lama, « Logo seul » ne garde que le signe ; le rail replié, toujours le signe seul", () => {
  assert.deepEqual(AFFICHAGES_MARQUE, ["logo_nom", "logo"]);
  assert.equal(affichageMarque("logo"), "logo");
  for (const autre of ["logo_nom", undefined, null, "nom", 1]) assert.equal(affichageMarque(autre), "logo_nom", String(autre));
  for (const place of ["entree", "rail", "telephone"] as PlaceMarque[]) {
    assert.equal(motVisible(place, "logo_nom"), true, place);
    assert.equal(motVisible(place, "logo"), false, place);
  }
  assert.equal(motVisible("replie", "logo_nom"), false);
  assert.equal(motVisible("replie", "logo"), false);
  assert.equal(fr["marque.affichage.logo_nom"], "Logo et nom");
  assert.equal(fr["marque.affichage.logo"], "Logo seul");
  assert.equal(en["marque.affichage.logo_nom"], "Logo and name");
  assert.equal(en["marque.affichage.logo"], "Logo only");
});

test("taille du signe dans le rail : 72 px quand le réglage masque le mot, 56 px sinon", () => {
  assert.equal(tailleSigne("rail", "logo"), "h-18 w-18", "rail ouvert, signe seul");
  assert.equal(tailleSigne("rail", "logo_nom"), "h-14 w-14", "rail ouvert, signe + mot");
  for (const place of ["entree", "replie", "telephone"] as PlaceMarque[]) {
    assert.equal(tailleSigne(place, "logo"), tailleSigne(place, "logo_nom"), place);
    assert.equal(tailleSigne(place, "logo"), PLACES_MARQUE[place].signe, place);
  }
});

test("initiales : deux premiers mots, majuscules ; un mot ; vide", () => {
  assert.equal(initiales("Institut Démo"), "ID");
  assert.equal(initiales("institut belle peau"), "IB");
  assert.equal(initiales("Aïcha"), "A");
  assert.equal(initiales("  "), "");
});

test("état public lu prudemment : valeurs inconnues ramenées aux défauts", () => {
  assert.deepEqual(marqueEtat({ ecran: "x", nom: 3, logos: { sombre: "2" } }), { ecran: "logo_nom", nom: "", clair: null, sombre: null });
  assert.deepEqual(marqueEtat({ ecran: "logo", nom: "Institut Démo", logos: { clair: 1, sombre: 4 } }), { ecran: "logo", nom: "Institut Démo", clair: 1, sombre: 4 });
  assert.deepEqual(marqueEtat(undefined), { ecran: "logo_nom", nom: "", clair: null, sombre: null });
});

test("contenu de la marque selon la place, les logos déposés et le réglage", () => {
  const rien = { ecran: "logo_nom" as const, nom: "Institut Démo", clair: null, sombre: null };
  const clairSeul = { ...rien, clair: 1 };
  const avec = { ...rien, clair: 1, sombre: 4 };
  assert.deepEqual(contenuMarque("entree", rien, false), { kind: "lama" }, "aucun logo déposé : lama, même avec un nom");
  assert.deepEqual(contenuMarque("replie", rien, false), { kind: "lama" });
  assert.deepEqual(contenuMarque("entree", clairSeul, false), { kind: "nom", nom: "Institut Démo" }, "logo clair seulement : le nom en blanc");
  assert.deepEqual(contenuMarque("entree", avec, false), { kind: "logo", src: "/api/institut/logos/sombre?v=4", nom: "Institut Démo" });
  assert.deepEqual(contenuMarque("rail", { ...avec, ecran: "logo" }, false), { kind: "logo", src: "/api/institut/logos/sombre?v=4", nom: null });
  assert.deepEqual(contenuMarque("replie", avec, false), { kind: "initiales", texte: "ID" });
  assert.deepEqual(contenuMarque("replie", { ...avec, nom: "" }, false), { kind: "lama" });
  assert.deepEqual(contenuMarque("entree", { ...avec, nom: "" }, false), { kind: "logo", src: "/api/institut/logos/sombre?v=4", nom: null });
  assert.deepEqual(contenuMarque("entree", avec, true), { kind: "nom", nom: "Institut Démo" }, "logo en échec de chargement : le nom");
  assert.deepEqual(contenuMarque("entree", { ...avec, nom: "" }, true), { kind: "lama" }, "échec et nom vide : lama");
});
