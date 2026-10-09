import assert from "node:assert/strict";
import { test } from "node:test";
import { clientCommands, catalogCommands, isOpen, productCommands, stockAfter, telHref } from "./fiches.ts";

/**
 * Règles des fiches de la vague 4 (sous-projet 4 § 6) : commandes montrées
 * selon le rôle, mêmes droits que le serveur (`src/server/auth/permissions.ts`),
 * stock ajusté, lien d'appel.
 */

test("clientes : créer, modifier et supprimer pour la gérante et la réception ; la praticienne lit et écrit la note et les préférences", () => {
  for (const role of ["manager", "reception"] as const) {
    assert.deepEqual(clientCommands(role), { create: true, edit: true, editNotes: true, editPreferences: true, remove: true, book: true }, role);
  }
  assert.deepEqual(clientCommands("practitioner"), { create: false, edit: false, editNotes: true, editPreferences: true, remove: false, book: false });
  assert.deepEqual(clientCommands("admin"), { create: false, edit: false, editNotes: false, editPreferences: false, remove: false, book: false });
});

test("équipe et prestations : seule la gérante crée, modifie, désactive et supprime", () => {
  assert.deepEqual(catalogCommands("manager"), { manage: true });
  for (const role of ["reception", "practitioner", "admin"] as const) assert.deepEqual(catalogCommands(role), { manage: false }, role);
});

test("produits : la gérante gère tout, la réception ajuste le stock, la praticienne lit", () => {
  assert.deepEqual(productCommands("manager"), { manage: true, adjustStock: true, photo: true });
  assert.deepEqual(productCommands("reception"), { manage: false, adjustStock: true, photo: false });
  assert.deepEqual(productCommands("practitioner"), { manage: false, adjustStock: false, photo: false });
  assert.deepEqual(productCommands("admin"), { manage: false, adjustStock: false, photo: false });
});

test("stock ajusté par − et + : jamais sous zéro, entier", () => {
  assert.equal(stockAfter(3, 1), 4);
  assert.equal(stockAfter(3, -1), 2);
  assert.equal(stockAfter(0, -1), 0, "pas de stock négatif");
  assert.equal(stockAfter(Number.NaN, 1), 1, "stock illisible : repart de zéro");
});

test("lien d'appel : chiffres et « + » gardés, espaces et tirets retirés ; rien sans numéro plausible", () => {
  assert.equal(telHref("+237 6 77 12 34 56"), "tel:+237677123456");
  assert.equal(telHref("677-12-34-56"), "tel:677123456");
  assert.equal(telHref(""), null);
  assert.equal(telHref("  "), null);
  assert.equal(telHref("12"), null, "trop court pour être appelé");
  assert.equal(telHref(null), null);
});

test("ligne marquée : seulement l'élément de la même sorte ouvert dans le panneau", () => {
  assert.equal(isOpen({ kind: "staff", id: "3" }, "staff", 3), true);
  assert.equal(isOpen({ kind: "client", id: "3" }, "staff", 3), false, "cliente 3 ouverte, pas le membre 3");
  assert.equal(isOpen({ kind: "staff", id: "3" }, "staff", 4), false);
  assert.equal(isOpen(null, "staff", 3), false);
});
