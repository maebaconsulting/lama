import assert from "node:assert/strict";
import { test } from "node:test";
import { peutEnregistrerTheme, POLICES_APERCU, problemeAffiche, rapport, THEME_DEPART, valeurReglage } from "./reglages-en-ligne.ts";

test("valeurs envoyées : interrupteur en booléen, horizon et délai en nombres, textes sans espaces autour", () => {
  assert.equal(valeurReglage("en_ligne.active", "true"), true);
  assert.equal(valeurReglage("en_ligne.active", "false"), false);
  assert.equal(valeurReglage("en_ligne.horizon_jours", "45"), 45);
  assert.equal(valeurReglage("en_ligne.delai_minimal_heures", "0"), 0);
  assert.equal(valeurReglage("en_ligne.adresse", " https://rdv.exemple.com "), "https://rdv.exemple.com");
});

test("thème : départ dans la charte de lama, refus expliqué avant l'envoi (même règle que le serveur et le relais)", () => {
  assert.equal(problemeAffiche(THEME_DEPART), null);
  assert.equal(problemeAffiche({ fond: "#F3EDE3", accent: "#E0D5C5", police: "lama" }), "en_ligne.theme.probleme_accent");
  assert.equal(problemeAffiche({ fond: "ivoire", accent: "#141312", police: "lama" }), "en_ligne.theme.probleme_couleur");
  assert.equal(problemeAffiche({ fond: "#F3EDE3", accent: "#141312", police: "lama" }), null);
});

test("rapport de contraste écrit dans la langue, arrondi vers le bas (jamais 4,5:1 affiché pour 4,49:1)", () => {
  assert.equal(rapport("#000000", "#FFFFFF", "fr"), "21,0:1");
  assert.equal(rapport("#767676", "#FFFFFF", "en"), "4.5:1");
  assert.equal(rapport("#777777", "#FFFFFF", "fr"), "4,4:1");
  assert.deepEqual(Object.keys(POLICES_APERCU), ["lama", "classique", "elegante", "moderne"]);
});

test("« Enregistrer » du thème : grisé si le thème est refusé ou la couleur illisible, ou pendant un envoi ; le retour à la charte reste possible", () => {
  assert.equal(peutEnregistrerTheme(true, { fond: "#F3EDE3", accent: "#E0D5C5", police: "lama" }, false), false);
  assert.equal(peutEnregistrerTheme(true, { fond: "ivoire", accent: "#141312", police: "lama" }, false), false);
  assert.equal(peutEnregistrerTheme(true, THEME_DEPART, false), true);
  assert.equal(peutEnregistrerTheme(true, THEME_DEPART, true), false);
  assert.equal(peutEnregistrerTheme(false, { fond: "ivoire", accent: "#E0D5C5", police: "lama" }, false), true);
});
