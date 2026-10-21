import assert from "node:assert/strict";
import { test } from "node:test";
import { DICTIONARIES } from "../i18n/translate.ts";
import { derniereOperation, ETAPE_KEYS, etapeKey, operationEnCours, pastilleMiseAJour, peutMettreAJour, texteSansVersion, type EtatMiseAJour, type OperationMiseAJour } from "./mise-a-jour-reseau.ts";

/** Rubrique « Mise à jour », règles de l'écran (spec du 21/10/2026, M-13 à M-16). */

const OP: OperationMiseAJour = { operation: "1-2", version_cible: "1.2.0", etape: "installation", resultat: null, motif: null, motif_texte: null, debut: 1, fin: null, version_precedente: "1.1.0" };
const ADMIN: EtatMiseAJour = {
  installee: { version: "1.1.0", developpement: false, installee_le: 1 },
  disponible: { version: "1.2.0", publiee_le: 2, note: "Agenda plus rapide." },
  verifie_le: 3, erreur: null, aucune_publiee: false, mecanisme: true, mode: "manuel", en_cours: false, operation: null,
};
const GERANTE: EtatMiseAJour = { installee: ADMIN.installee, disponible: ADMIN.disponible, verifie_le: 3, erreur: null, aucune_publiee: false };

test("bouton « Mettre à jour » : mécanisme posé, version publiée installée, version plus récente annoncée, rien en cours (M-13, M-16)", () => {
  assert.equal(peutMettreAJour(ADMIN), true);
  assert.equal(peutMettreAJour({ ...ADMIN, mecanisme: false }), false, "mécanisme non posé : bouton absent");
  assert.equal(peutMettreAJour({ ...ADMIN, installee: { ...ADMIN.installee, developpement: true } }), false);
  assert.equal(peutMettreAJour({ ...ADMIN, disponible: null }), false);
  assert.equal(peutMettreAJour({ ...ADMIN, en_cours: true }), false);
  assert.equal(peutMettreAJour(GERANTE), false, "la gérante lit seulement");
});

test("pastille : version disponible en mode manuel seulement, jamais pour la gérante (M-15)", () => {
  assert.equal(pastilleMiseAJour(ADMIN), true);
  assert.equal(pastilleMiseAJour({ ...ADMIN, mode: "automatique" }), false);
  assert.equal(pastilleMiseAJour({ ...ADMIN, disponible: null }), false);
  assert.equal(pastilleMiseAJour(GERANTE), false);
  assert.equal(pastilleMiseAJour(null), false);
});

test("opération : étape lue dans etat.json, préparation, dernière terminée ; chaque étape traduite (M-14, M-17)", () => {
  assert.equal(operationEnCours(ADMIN), null);
  assert.equal(operationEnCours({ ...ADMIN, en_cours: true, operation: OP }), OP);
  const finie: OperationMiseAJour = { ...OP, etape: "termine", resultat: "reussie", fin: 9 };
  assert.equal(operationEnCours({ ...ADMIN, en_cours: true, operation: finie }), "preparation", "demande déposée, opération précédente finie");
  assert.equal(operationEnCours({ ...ADMIN, en_cours: true, operation: null }), "preparation");
  assert.equal(derniereOperation({ ...ADMIN, operation: finie }), finie);
  assert.equal(derniereOperation({ ...ADMIN, operation: OP }), null);
  for (const cle of Object.values(ETAPE_KEYS)) for (const lang of ["fr", "en"] as const) assert.ok(DICTIONARIES[lang][cle], `${lang}.${cle}`);
  assert.equal(DICTIONARIES.fr["mise_a_jour.mode.automatique"], "Automatique la nuit (3 h 30)");
  assert.equal(DICTIONARIES.fr["reglages.rubrique.mise_a_jour"], "Mise à jour");
  assert.equal(DICTIONARIES.en["reglages.rubrique.mise_a_jour"], "Updates");
});

test("combinaisons incohérentes : ni en cours ni terminée ; champ absent = null", () => {
  const en = (operation: unknown) => ({ ...ADMIN, en_cours: true, operation } as EtatMiseAJour);
  const sansFin = (({ fin: _f, ...r }) => r)(OP);
  const cas: Array<[string, Partial<OperationMiseAJour>]> = [
    ["fin null + etape termine", { etape: "termine" }],
    ["fin null + resultat posé", { resultat: "echec" }],
    ["fin posée + resultat null", { fin: 9 }],
  ];
  for (const [nom, patch] of cas) {
    const o = { ...OP, ...patch };
    assert.equal(operationEnCours(en(o)), "preparation", nom);
    assert.equal(derniereOperation(en(o)), null, nom);
  }
  assert.equal(operationEnCours(en(sansFin)), sansFin, "fin absente = en cours");
  assert.equal(derniereOperation(en(sansFin)), null);
});

test("etapeKey : étape connue traduite, inconnue retombe sur la préparation", () => {
  assert.equal(etapeKey("sauvegarde"), "mise_a_jour.etape.sauvegarde");
  assert.equal(etapeKey("inconnue"), "mise_a_jour.preparation");
  assert.equal(etapeKey("toString"), "mise_a_jour.preparation");
});

test("version disponible absente : « à jour » seulement après une vérification réussie ; aucune version publiée dite comme telle (mini-PC d'essai, 21/10/2026)", () => {
  const rien = { ...ADMIN, disponible: null };
  assert.equal(texteSansVersion(rien), "mise_a_jour.a_jour");
  assert.equal(texteSansVersion({ ...rien, aucune_publiee: true }), "mise_a_jour.aucune_publiee");
  assert.equal(texteSansVersion({ ...rien, verifie_le: null }), null, "jamais vérifiée : rien n'est affirmé");
  assert.equal(texteSansVersion({ ...rien, erreur: "Réponse inattendue" }), null, "vérification en échec : pas de « à jour »");
  assert.equal(texteSansVersion({ ...rien, installee: { ...rien.installee, developpement: true } }), null, "version de développement : jamais proposée");
  for (const lang of ["fr", "en"] as const) assert.ok(DICTIONARIES[lang]["mise_a_jour.aucune_publiee"], lang);
});
