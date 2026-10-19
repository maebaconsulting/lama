import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

type Cadre = { src?: string; title?: string; style: { cssText?: string } };

/** Exécute integrer.js dans un faux navigateur et rend les cadres placés (aucun réseau, aucun DOM réel). */
function integrer(dataset: Record<string, string>, navigateur = "fr-FR"): Cadre[] {
  const cadres: Cadre[] = [];
  const script = { src: "https://rdv.exemple.com/integrer.js", dataset, parentNode: { insertBefore: (c: Cadre) => cadres.push(c) } };
  const document = {
    currentScript: script,
    head: {},
    body: { contains: () => true, appendChild: (c: Cadre) => cadres.push(c) },
    createElement: (): Cadre => ({ style: {} }),
    addEventListener: () => {},
  };
  const source = readFileSync(new URL("./statique/integrer.js", import.meta.url), "utf8");
  runInNewContext(source, { document, window: { addEventListener: () => {} }, navigator: { language: navigateur }, URL, URLSearchParams });
  return cadres;
}

test("intégration : un cadre vers la page du salon, langue passée seulement si elle est fr ou en", () => {
  assert.deepEqual(integrer({ salon: "eclat" }).map((c) => c.src), ["https://rdv.exemple.com/eclat/"]);
  assert.equal(integrer({ salon: "eclat", lang: "en" })[0].src, "https://rdv.exemple.com/eclat/?lang=en");
  assert.equal(integrer({ salon: "eclat", lang: "de" })[0].src, "https://rdv.exemple.com/eclat/");
  assert.equal(integrer({ salon: "eclat" }, "en-GB")[0].title, "Appointment");
  assert.equal(integrer({ salon: "eclat", titre: "Demande de rendez-vous" })[0].title, "Demande de rendez-vous");
});

test("intégration : prestation choisie d'avance passée à la page, identifiant mal formé ignoré", () => {
  assert.equal(integrer({ salon: "eclat", lang: "fr", prestation: "s12" })[0].src, "https://rdv.exemple.com/eclat/?lang=fr&prestation=s12");
  assert.equal(integrer({ salon: "eclat", prestation: "p_1-a" })[0].src, "https://rdv.exemple.com/eclat/?prestation=p_1-a");
  for (const prestation of ["", "s12&lang=en", "../gestion", "s12\"><script>", "é", "x".repeat(65)]) {
    assert.equal(integrer({ salon: "eclat", prestation })[0].src, "https://rdv.exemple.com/eclat/", prestation);
  }
});

test("intégration : salon absent ou mal formé, aucun cadre", () => {
  assert.deepEqual(integrer({}), []);
  assert.deepEqual(integrer({ salon: "Eclat" }), []);
  assert.deepEqual(integrer({ salon: "eclat/../gestion" }), []);
});
