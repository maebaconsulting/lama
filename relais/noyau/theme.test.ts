import assert from "node:assert/strict";
import { test } from "node:test";
import { contraste, COULEUR, melange, pageAvecTheme, palette, POLICES, problemeTheme, styleTheme, texteSur } from "./theme.ts";

test("contraste : noir sur blanc 21:1, une couleur sur elle-même 1:1, gris WCAG de référence 4,54:1", () => {
  assert.equal(Math.round(contraste("#000000", "#FFFFFF") * 100) / 100, 21);
  assert.equal(contraste("#777777", "#777777"), 1);
  assert.equal(Math.round(contraste("#767676", "#FFFFFF") * 100) / 100, 4.54);
  assert.equal(contraste("#141312", "#F3EDE3"), contraste("#F3EDE3", "#141312"), "symétrique");
});

test("texteSur : noir sur un fond clair, blanc sur un fond sombre, au moins 4,5:1 même sur le gris le plus difficile", () => {
  assert.equal(texteSur("#F3EDE3"), "#000000");
  assert.equal(texteSur("#141312"), "#FFFFFF");
  for (const fond of ["#777777", "#767676", "#808080", "#2F5D62", "#FF0000"]) assert.ok(contraste(texteSur(fond), fond) >= 4.5, fond);
});

test("problemeTheme : thème de la spec accepté ; couleur, police et accent refusés chacun par son nom", () => {
  assert.deepEqual([...POLICES], ["lama", "classique", "elegante", "moderne"]);
  assert.equal(problemeTheme({ fond: "#F3EDE3", accent: "#141312", police: "elegante" }), null);
  assert.equal(problemeTheme({ fond: "#f3ede3", accent: "#141312", police: "lama" }), null, "minuscules acceptées");
  assert.equal(problemeTheme({ fond: "#F3EDE", accent: "#141312", police: "lama" }), "couleur");
  assert.equal(problemeTheme({ fond: "F3EDE3", accent: "#141312", police: "lama" }), "couleur");
  assert.equal(problemeTheme({ fond: "#F3EDE3", accent: 12, police: "lama" }), "couleur");
  assert.equal(problemeTheme({ fond: "#F3EDE3", accent: "#141312", police: "gothique" }), "police");
  assert.equal(problemeTheme({ fond: "#F3EDE3", accent: "#E0D5C5", police: "lama" }), "contraste_accent");
  assert.equal(problemeTheme({ fond: "#141312", accent: "#F3EDE3", police: "moderne" }), null, "fond sombre, accent clair");
});

test("palette : texte déduit du fond, texte discret lisible à 4,5:1 sur le fond et sur les cartes", () => {
  for (const fond of ["#F3EDE3", "#141312", "#777777", "#2F5D62", "#FFFFFF", "#000000"]) {
    const p = palette({ fond, accent: texteSur(fond), police: "lama" });
    assert.ok(contraste(p.texte, p.fond) >= 4.5, fond);
    assert.ok(contraste(p.grise, p.fond) >= 4.5 && contraste(p.grise, p.papier) >= 4.5, `${fond} : ${p.grise}`);
    for (const c of [p.fond, p.texte, p.accent, p.surAccent, p.papier, p.grise, p.filet, p.rouge, p.vert]) assert.match(c, COULEUR);
    for (const c of [p.rouge, p.vert]) assert.ok(contraste(c, p.fond) >= 4.5 && contraste(c, p.papier) >= 4.5, `${fond} : ${c}`);
  }
  assert.equal(melange("#000000", "#FFFFFF", 0.5), "#808080");
});

test("pageAvecTheme : variables, police et couleur du navigateur posées dans la page ; sans thème, la page telle quelle", () => {
  const html = '<!doctype html><html lang="fr"><head><meta name="theme-color" content="#161514" /></head><body></body></html>';
  assert.equal(pageAvecTheme(html, undefined), html);
  assert.equal(pageAvecTheme(html, null), html);
  const avec = pageAvecTheme(html, { fond: "#F3EDE3", accent: "#141312", police: "elegante" });
  assert.match(avec, /<html lang="fr" data-police="elegante">/);
  assert.match(avec, /<meta name="theme-color" content="#F3EDE3" \/>/);
  assert.match(avec, /<style id="theme-salon">:root\{--fond:#F3EDE3;--texte:#000000;--accent:#141312;--sur-accent:#FFFFFF;--papier:#[0-9A-F]{6};--encre-grise:#[0-9A-F]{6};--filet:#[0-9A-F]{6};--encre-rouge:#7A1F1F;--vert-confirme:#3F5E4A;color-scheme:light\}<\/style><\/head>/);
  assert.match(styleTheme({ fond: "#141312", accent: "#F3EDE3", police: "moderne" }), /color-scheme:dark/);
});
