import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { pathFor } from "../../lib/routes.ts";

/** Rubrique « Heure » des Réglages (distribution D-12) : câblage de l'écran (les règles sont dans `lib/heure.test.ts`). */

const source = readFileSync(new URL("./heure.tsx", import.meta.url), "utf8");

test("heure du serveur réglée par l'administrateur, mot de passe retapé, heure prise au moment de l'envoi", () => {
  assert.match(source, /confirm\(\(\) => api<ReponseReglage>\("POST", "\/api\/heure", \{ heure: heure\(\) \}\)\)/);
  assert.match(source, /onClick=\{\(\) => void envoyer\(\(\) => Date\.now\(\)\)\}/, "« Mettre le serveur à l'heure de cet appareil »");
  assert.match(source, /avertissementsReglage\(fait\)/, "avertissements après réglage");
  assert.match(source, /heureSaisie\(date, texteHeure\)/);
  assert.match(source, /<ChampDate id="heure-date"/);
  assert.match(source, /api<EtatHeure>\("GET", "\/api\/heure"\)/);
  assert.match(source, /dernierEcart\(\)/, "écart lu sur l'en-tête Date (D-11)");
  assert.match(readFileSync(new URL("./reglages.tsx", import.meta.url), "utf8"), /heure: Heure,/);
  assert.deepEqual([pathFor("reglages", "fr", "heure"), pathFor("reglages", "en", "heure")], ["/reglages/heure", "/settings/time"]);
});

test("l'en-tête Date de chaque réponse est noté par api()", () => {
  const api = readFileSync(new URL("../../api.ts", import.meta.url), "utf8");
  assert.match(api, /noterDate\(response\.headers\.get\("date"\), Date\.now\(\)\);/);
});
