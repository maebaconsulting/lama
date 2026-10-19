import assert from "node:assert/strict";
import { test } from "node:test";
import * as relais from "../../relais/noyau/theme.ts";
import { MOTIF_SALON as MOTIF_DU_RELAIS } from "../../relais/noyau/motifs.ts";
import { adresseRelaisValide, adresseSansBarre, codeIntegration, MOTIF_SALON, pageSalon, palette, POLICES, problemeTheme, texteSur } from "./en-ligne.ts";

test("même règle de contraste et même palette que le relais, sur 500 couleurs tirées", () => {
  let graine = 7;
  const couleur = () => {
    graine = (graine * 1103515245 + 12345) % 2 ** 31;
    return `#${(graine % 0x1000000).toString(16).padStart(6, "0").toUpperCase()}`;
  };
  assert.deepEqual([...POLICES], [...relais.POLICES]);
  for (let i = 0; i < 500; i++) {
    const t = { fond: couleur(), accent: couleur(), police: POLICES[i % POLICES.length] };
    assert.equal(problemeTheme(t), relais.problemeTheme(t), JSON.stringify(t));
    assert.equal(texteSur(t.fond), relais.texteSur(t.fond));
    assert.deepEqual(palette(t), relais.palette(t));
  }
  assert.equal(MOTIF_SALON.source, MOTIF_DU_RELAIS.source, "même identifiant de salon que le relais");
});

test("adresse du relais : https, ou http sur la machine même ; jamais de requête ni d'ancre", () => {
  for (const v of ["", "https://rdv.exemple.com", "https://rdv.exemple.com/", "http://127.0.0.1:8790", "http://localhost:8790"]) assert.equal(adresseRelaisValide(v), true, v);
  for (const v of ["http://rdv.exemple.com", "ftp://rdv.exemple.com", "rdv.exemple.com", "https://rdv.exemple.com/?a=1", "https://rdv.exemple.com/#x", 12, null]) assert.equal(adresseRelaisValide(v), false, String(v));
  assert.equal(adresseSansBarre("https://rdv.exemple.com/"), "https://rdv.exemple.com");
  for (const v of ["https://u:p@rdv.invalid", "https://u@rdv.invalid", "https://:p@rdv.invalid", "http://u:p@127.0.0.1:8790"]) assert.equal(adresseRelaisValide(v), false, `identifiants dans l'adresse : ${v}`);
});

test("page du salon et code d'intégration : seulement quand l'adresse et le salon sont réglés", () => {
  assert.equal(pageSalon("https://rdv.exemple.com/", "eclat"), "https://rdv.exemple.com/eclat/");
  assert.equal(pageSalon("", "eclat"), null);
  assert.equal(pageSalon("https://rdv.exemple.com", ""), null);
  assert.equal(codeIntegration("https://rdv.exemple.com", "eclat"), '<script src="https://rdv.exemple.com/integrer.js" data-salon="eclat" async></script>');
  assert.equal(codeIntegration("https://rdv.exemple.com", ""), null);
});
