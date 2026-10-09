import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Relecture finale (constat 2) : l'onglet « Plus » actif ne recevait pas le
 * fond `bg-sidebar-accent`, contrairement aux autres onglets actifs de
 * `OngletsTelephone` (:137). La praticienne sur Réglages, Produits ou
 * Rendez-vous ne voyait alors aucun onglet marqué comme actif.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const telephone = read("./telephone.tsx");

test("constat 2 : l'onglet « Plus » actif reçoit le même fond que les autres onglets actifs", () => {
  const plus = telephone.slice(telephone.indexOf("function Plus("), telephone.indexOf("export function OngletsTelephone"));
  assert.match(
    plus,
    /className=\{cn\(TAB, active \? "bg-sidebar-accent text-sidebar-foreground" : "text-sidebar-foreground\/70"\)\}/,
    "l'onglet « Plus » actif doit recevoir bg-sidebar-accent, comme les autres onglets actifs",
  );
});
