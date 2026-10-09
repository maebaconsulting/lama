import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./http.ts";
import { lostSaleVerdict, saleLookupPath } from "./reprise-vente.ts";

/**
 * Reprise d'une vente dont la réponse s'est perdue (sous-projet 5 § 7, report
 * de la vague 2) : l'écran demande au serveur, sans rien renvoyer, si la
 * facture existe ; seule une réponse « absente » explicite dégèle le ticket.
 */

test("adresse de la reprise : la vente par son request_id", () => {
  assert.equal(saleLookupPath("v-0123456789abcdef01234567"), "/api/sales/v-0123456789abcdef01234567");
});

test("verdict : 404 « absente » seulement dégèle ; réseau, serveur, autre refus : issue toujours inconnue", () => {
  assert.equal(lostSaleVerdict(new ApiError("Aucune facture émise pour cette vente.", 404, "absente", null)), "absente");
  assert.equal(lostSaleVerdict(new ApiError("Réseau", 0, "reseau", null)), "inconnue");
  assert.equal(lostSaleVerdict(new ApiError("Erreur du serveur.", 500, null, null)), "inconnue");
  assert.equal(lostSaleVerdict(new ApiError("Introuvable", 404, null, null)), "inconnue", "un 404 sans le code (ancienne version du serveur) ne dégèle pas");
  // Correctif final (point 4) : facture existante mais droit refusé (403) : jamais dégelé non plus.
  assert.equal(lostSaleVerdict(new ApiError("Accès refusé.", 403, null, null)), "inconnue", "403 (droits) : issue toujours inconnue");
  assert.equal(lostSaleVerdict(new Error("autre")), "inconnue");
});
