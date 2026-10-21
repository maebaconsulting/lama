import assert from "node:assert/strict";
import { test } from "node:test";
import { auditTarget } from "./libelles.ts";
import { connexionTexte, GUIDE_META, nomInvalide, nomsAEnregistrer, numeroVariable, statutTexte, typeTexte, type LigneModele } from "./whatsapp-business.ts";

/** WhatsApp Business à l'écran de l'administrateur (spec du 21/10/2026, W-11, W-13, W-14). */

const ligne = (kind: LigneModele["kind"], nom: string): LigneModele => ({
  kind, categorie: "utilitaire", entete: "aucun", nom, nom_defaut: `lama_${kind}`, statut: { fr: "non_verifie", en: "non_verifie" }, depot: {} as LigneModele["depot"],
});

test("noms des modèles : règle de Meta, vide permis ; rien à enregistrer sans changement ni avec un nom invalide", () => {
  assert.equal(nomInvalide("lama_rappel_2"), false);
  assert.equal(nomInvalide(""), false);
  for (const nom of ["Rappel", "rappel-ebene", "rappel ebene", "é"]) assert.equal(nomInvalide(nom), true, nom);
  const lignes = [ligne("confirmation", "lama_confirmation"), ligne("rappel", "lama_rappel")];
  assert.equal(nomsAEnregistrer(lignes, {}), null);
  assert.equal(nomsAEnregistrer(lignes, { rappel: " lama_rappel " }), null, "espaces autour : même nom");
  assert.deepEqual(nomsAEnregistrer(lignes, { rappel: "ebene_rappel" }), { confirmation: "lama_confirmation", rappel: "ebene_rappel" });
  assert.equal(nomsAEnregistrer(lignes, { rappel: "Ebene" }), null);
});

test("connexion établie dite en clair (W-11) : numéro, nom vérifié, qualité ; états, types et variables traduits", () => {
  assert.equal(connexionTexte({ numero: "+237 6 99 00 00 00", nom: "Institut Ébène", qualite: "GREEN" }, "fr"), "Connexion établie\u00a0: numéro +237 6 99 00 00 00, Institut Ébène, qualité élevée.");
  assert.equal(connexionTexte({ numero: "+237 6 99 00 00 00", nom: "", qualite: "RED" }, "en"), "Connection established: number +237 6 99 00 00 00, name not verified, quality low.");
  assert.equal(connexionTexte({ numero: "1", nom: "X", qualite: "UNKNOWN" }, "fr"), "Connexion établie\u00a0: numéro 1, X, qualité inconnue.");
  assert.equal(statutTexte("en_attente", "fr"), "en attente");
  assert.equal(statutTexte("non_verifie", "en"), "not checked");
  assert.equal(typeTexte("absence", "fr"), "Vous nous manquez");
  assert.equal(typeTexte("ticket", "en"), "Receipt, credit note or deposit receipt");
  assert.equal(numeroVariable(0), "{{1}}");
  assert.equal(auditTarget("whatsapp.meta.noms", "fr"), "Noms des modèles WhatsApp Business");
  assert.equal(auditTarget("whatsapp.meta.numero", "en"), "WhatsApp Business phone number ID");
});

test("guide pas à pas (W-14) : section « WhatsApp Business » du guide du technicien, dans la langue de l'écran", () => {
  assert.match(GUIDE_META.fr, /^https:\/\/github\.com\/maebaconsulting\/lama\/blob\/main\/deploy\/LISEZMOI\.md#whatsapp-business$/);
  assert.match(GUIDE_META.en, /^https:\/\/github\.com\/maebaconsulting\/lama\/blob\/main\/deploy\/README\.md#whatsapp-business$/);
});
