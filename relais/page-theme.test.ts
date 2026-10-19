import assert from "node:assert/strict";
import { test } from "node:test";
import { MAINTENANT, offreEssai } from "./essais/donnees.ts";
import { relaisEssai } from "./essais/relais.ts";
import { Offre } from "./noyau/contrat.ts";
import { Depot } from "./stockage/depot.ts";

const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="theme-color" content="#161514" /><title>t</title></head><body><div id="app"></div></body></html>';

test("page d'un salon : à ses couleurs et à sa police avec un thème, charte de lama sans thème, l'autre salon jamais touché", async () => {
  const r = await relaisEssai({ etat: "actif", page: async (nom) => (nom === "index.html" ? PAGE : null) });
  const depot = new Depot(r.base, "eclat");
  await depot.ecrireDocument("offre", 1, offreEssai(1), MAINTENANT);
  assert.equal(await (await r.app.request("/eclat/")).text(), PAGE);
  const o = offreEssai(2);
  await depot.ecrireDocument("offre", 2, Offre.parse({ ...o, institut: { ...o.institut, theme: { fond: "#141312", accent: "#F3EDE3", police: "moderne" } } }), MAINTENANT);
  const avec = await r.app.request("/eclat/");
  assert.equal(avec.status, 200);
  assert.equal(avec.headers.get("cache-control"), "no-cache");
  const html = await avec.text();
  assert.match(html, /<html lang="fr" data-police="moderne">/);
  assert.match(html, /--fond:#141312;--texte:#FFFFFF;--accent:#F3EDE3;--sur-accent:#000000;/);
  assert.match(html, /color-scheme:dark/);
  assert.match(html, /<meta name="theme-color" content="#141312" \/>/);
  assert.equal(await (await r.app.request("/voisin/")).text(), PAGE, "l'autre salon garde la charte");
  assert.equal((await r.app.request("/inconnu/")).status, 404);
});
