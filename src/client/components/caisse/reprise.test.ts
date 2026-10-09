import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Reports de la vague 2 (sous-projet 5 § 7) : reprise d'une vente dont la
 * réponse s'est perdue par `GET /api/sales/:request_id`, et « Préparation du
 * ticket… » annoncé au lecteur d'écran (le bouton désactivé ne l'est pas).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const paiement = read("./paiement.tsx");
const boutons = read("./boutons-ticket.tsx");

test("reprise : le serveur est interrogé avant tout renvoi, au remontage de l'écran comme à « Réessayer »", () => {
  assert.match(paiement, /api<\{ invoice: Invoice \}>\("GET", saleLookupPath\(ticket\.request_id\)\)/);
  assert.match(paiement, /const verdict = lostSaleVerdict\(err\);/);
  assert.match(paiement, /if \(verdict === "absente"\) \{/);
  assert.match(paiement, /useEffect\(\(\) => \{\s*if \(resume\) void lookup\(\);/, "écran rouvert pendant une issue inconnue : vérification tout de suite");
  assert.match(paiement, /if \(\(await lookup\(\)\) === "absente"\) await send\(\);/, "« Réessayer » ne renvoie la vente que si elle n'a pas été émise");
  assert.match(paiement, /onClick=\{\(\) => \(error\?\.retry \? retry\(\) : send\(\)\)\}/);
  assert.match(paiement, /checking \? t\("caisse\.verification"\)/);
});

test("vente absente : ticket dégelé et phrase qui le dit ; issue inconnue : le gel reste", () => {
  assert.match(paiement, /onPending\(false\);\s*setError\(\{ message: t\("caisse\.vente_absente"\), retry: false \}\);/);
});

test("« Préparation du ticket… » annoncé par une zone d'état lue, le bouton désactivé ne l'étant pas", () => {
  assert.match(boutons, /<p role="status" className="sr-only">\{busy \? t\("caisse\.preparation_ticket"\) : ""\}<\/p>/);
});
