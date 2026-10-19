import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL("./components/", import.meta.url).pathname;

function tsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsx(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

test("tout montant et toute date passent par les fonctions de format (spec § 3.3)", () => {
  const forbidden = [/\.toFixed\(/, /\.toLocale(Date|Time)?String\(/, /new Intl\./, /"en-US"/, /\$\{?\s*[a-z._]*(price|cost|revenue)/i, /step="0\.01"/];
  const offenders = tsx(ROOT)
    .filter((f) => !f.endsWith("charte.tsx"))
    .flatMap((f) => forbidden.filter((re) => re.test(readFileSync(f, "utf8"))).map((re) => `${relative(ROOT, f)} : ${re}`));
  assert.deepEqual(offenders, []);
});

test("les champs de prix passent par parseAmount", () => {
  for (const name of ["create-service.tsx", "create-product.tsx"]) {
    const text = readFileSync(join(ROOT, name), "utf8");
    assert.match(text, /parseAmount\(/, name);
  }
});

/**
 * Décision du contrôleur (écart 1, tâche 12) : un champ `type="number"` ne
 * transmet jamais une saisie avec espace comme « 15 000 » (la valeur arrive
 * vide et `parseAmount` enregistre 0 sans prévenir). Les champs de montant
 * (prix de la prestation, prix et coût du produit) sont donc du texte
 * (`type="text"`, clavier donné par `modeSaisieMontant()` : décimal pour une devise à centimes, numérique sinon), jamais `type="number"`. La durée et
 * les quantités entières (stock, seuil) restent `type="number"`.
 */
/** Balises `<Input … />` d'un fichier (les attributs peuvent contenir `>` dans une flèche `=>`). */
function inputTags(text: string): string[] {
  return [...text.matchAll(/<Input\b[^]*?\/>/g)].map((m) => m[0]);
}

function inputTag(text: string, id: string): string | undefined {
  return inputTags(text).find((tag) => tag.includes(`id="${id}"`));
}

test("aucun champ de montant n'est type=\"number\" (décision du contrôleur, écart 1)", () => {
  const AMOUNT_FIELDS: Record<string, string[]> = {
    "create-service.tsx": ["fp-prix"],
    "create-product.tsx": ["fpr-prix", "fpr-cout"],
  };
  for (const [name, ids] of Object.entries(AMOUNT_FIELDS)) {
    const text = readFileSync(join(ROOT, name), "utf8");
    for (const id of ids) {
      const tag = inputTag(text, id);
      assert.ok(tag, `${name} : champ ${id} introuvable`);
      assert.doesNotMatch(tag!, /type="number"/, `${name} ${id}`);
      assert.match(tag!, /type="text"/, `${name} ${id}`);
      assert.match(tag!, /inputMode=\{modeSaisieMontant\(\)\}/, `${name} ${id}`);
    }
  }
});

test("la durée d'une prestation reste type=\"number\"", () => {
  const text = readFileSync(join(ROOT, "create-service.tsx"), "utf8");
  const tag = inputTag(text, "fp-duree");
  assert.ok(tag);
  assert.match(tag!, /type="number"/);
});

/**
 * Vérification finale (anomalie a) : un champ natif `type="date"` ou
 * `type="time"` suit la langue du navigateur, jamais celle de l'écran
 * (`lang` est ignoré par Chromium) ; un navigateur en anglais américain
 * affiche `09/27/2026` et `02:30 PM`. Les dates et heures se saisissent donc
 * par `ChampDate` et `ChampHeure` (`27/09/2026`, `14:30`, spec § 3.3).
 */
test("aucun champ natif de date ou d'heure : ChampDate et ChampHeure (spec § 3.3)", () => {
  const offenders = tsx(ROOT)
    .filter((f) => !f.endsWith("charte.tsx"))
    .filter((f) => /type="(date|time|datetime-local)"/.test(readFileSync(f, "utf8")))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
  for (const [name, count] of [["create-appointment.tsx", 2], ["reschedule-appointment.tsx", 2], ["agenda/bloquer-creneau.tsx", 2], ["reglages/journal.tsx", 2]] as const) {
    const text = readFileSync(join(ROOT, name), "utf8");
    assert.equal((text.match(/<Champ(Date|Heure)\b/g) ?? []).length, count, name);
  }
});
