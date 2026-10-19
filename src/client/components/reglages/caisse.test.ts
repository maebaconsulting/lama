import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Rubrique « Caisse » des Réglages (sous-projet 5 § 5.2) : câblage de l'écran (les règles sont testées dans `lib/reglages-caisse.test.ts`). */

test("rubrique « Caisse » : tous les réglages de la spec, enregistrés un par un avec confirmation au besoin, sans texte en dur", () => {
  const source = readFileSync("src/client/components/reglages/caisse.tsx", "utf8");
  for (const key of ["institut.niu", "institut.rccm", "caisse.tva_active", "caisse.tva_taux", "caisse.mentions_fr", "caisse.mentions_en", "caisse.remises", "caisse.remise_plafond", "caisse.pourboires", "caisse.acomptes", "caisse.avoirs_reception", "caisse.moyens"]) {
    assert.ok(source.includes(`"${key}"`), key);
  }
  assert.match(source, /caisseChanges\(baseline, form\)/);
  assert.match(source, /confirm\(\(\) => api\("PUT", `\/api\/settings\/\$\{key\}`, \{ value \}\)\)/);
  assert.match(source, /PAYMENT_METHODS\.map/);
  assert.match(readFileSync("src/client/components/reglages/reglages.tsx", "utf8"), /caisse: Caisse,/);
});

/**
 * Retouche P1 (critique.md du 1er octobre 2026) : les deux cases qui changent qui touche à
 * l'argent (avoirs émis par la réception, encaissement par la praticienne) ne disaient rien de ce
 * qui se passe sans elles. `Case` reçoit une aide optionnelle, en petit texte sous le libellé.
 */
test("retouche P1 : aide sous les cases « Avoirs émis par la réception » et « Encaissement par la praticienne »", () => {
  const source = readFileSync("src/client/components/reglages/caisse.tsx", "utf8");
  assert.match(source, /<Case id="caisse-avoirs-reception" label=\{t\("reglages_caisse\.avoirs_reception"\)\} hint=\{t\("reglages_caisse\.avoirs_reception_aide"\)\} checked=\{form\["caisse\.avoirs_reception"\] === "oui"\} onChange=\{flag\("caisse\.avoirs_reception"\)\} \/>/);
  assert.match(source, /<Case id="caisse-encaissement-praticienne" label=\{t\("reglages_caisse\.encaissement_praticienne"\)\} hint=\{t\("reglages_caisse\.encaissement_praticienne_aide"\)\} checked=\{form\["caisse\.encaissement_praticienne"\] === "oui"\} onChange=\{flag\("caisse\.encaissement_praticienne"\)\} \/>/);
  // Les autres cases de la rubrique n'ont pas d'aide : l'ajout de la prop ne leur impose rien.
  assert.match(source, /<Case id="caisse-remises" label=\{t\("reglages_caisse\.remises"\)\} checked=\{form\["caisse\.remises"\] === "oui"\} onChange=\{flag\("caisse\.remises"\)\} \/>/);

  const elements = readFileSync("src/client/components/reglages/elements.tsx", "utf8");
  assert.match(elements, /export function Case\(\{ id, label, hint, checked, onChange, disabled \}: \{ id: string; label: string; hint\?: string; checked: boolean; onChange: \(v: boolean\) => void; disabled\?: boolean \}\)/);
  assert.match(elements, /\{hint && <span className="text-xs text-muted-foreground">\{hint\}<\/span>\}/);

  const fr = readFileSync("src/client/i18n/fr.ts", "utf8");
  const en = readFileSync("src/client/i18n/en.ts", "utf8");
  assert.match(fr, /"reglages_caisse\.avoirs_reception_aide": "Sans cette case, seule la gérante émet un avoir\.",/);
  assert.match(en, /"reglages_caisse\.avoirs_reception_aide": "Without this box, only the manager issues credit notes\.",/);
  assert.match(fr, /"reglages_caisse\.encaissement_praticienne_aide": "Sans cette case, seules la réception et la gérante encaissent un rendez-vous\.",/);
  assert.match(en, /"reglages_caisse\.encaissement_praticienne_aide": "Without this box, only reception and the manager charge an appointment\.",/);
});

test("taux de TVA et plafond de remise en erreur : champ signalé (aria-invalid, aria-describedby, bordure), message sous le champ, focus à l'envoi (retouche R3)", () => {
  const source = readFileSync("src/client/components/reglages/caisse.tsx", "utf8");
  assert.match(source, /aria-invalid=\{tvaError \? true : undefined\}/, "aria-invalid du taux de TVA");
  assert.match(source, /aria-describedby=\{tvaError \? "caisse-tva-taux-erreur" : undefined\}/, "aria-describedby du taux de TVA");
  assert.match(source, /aria-invalid=\{plafondError \? true : undefined\}/, "aria-invalid du plafond");
  assert.match(source, /aria-describedby=\{plafondError \? "caisse-plafond-erreur" : undefined\}/, "aria-describedby du plafond");
  assert.match(source, /id="caisse-tva-taux-erreur" className="text-sm text-encre-rouge"/, "message sous le taux de TVA, sans role=\"alert\" (le focus et aria-describedby suffisent, correctif final)");
  assert.match(source, /id="caisse-plafond-erreur" className="text-sm text-encre-rouge"/, "message sous le plafond, sans role=\"alert\" (correctif final)");
  assert.doesNotMatch(source, /id="caisse-tva-taux-erreur"[^]*?role="alert"/, "pas de role=\"alert\" sous le taux (déjà lu par le focus + aria-describedby)");
  assert.doesNotMatch(source, /id="caisse-plafond-erreur"[^]*?role="alert"/, "pas de role=\"alert\" sous le plafond");
  assert.match(source, /border-encre-rouge/, "bordure rouge du champ fautif");
  assert.match(source, /getElementById\(fieldId\)\?\.focus\(\)/, "le champ fautif reçoit le focus à l'envoi");
  assert.match(source, /fieldError\?\.key === key\) setFieldError\(null\)/, "l'erreur du champ disparaît dès qu'il est modifié");
});

test("préfixe des factures (distribution D-01) : rubrique réduite au préfixe pour l'administrateur, lecture seule pour la gérante, PUT confirmé", () => {
  const caisse = readFileSync("src/client/components/reglages/caisse.tsx", "utf8");
  assert.match(caisse, /return account\.role === "admin" \? <CaisseAdministrateur \/> : <CaisseGerante \/>;/);
  assert.equal(caisse.match(/<PrefixeFactures setting=\{data\??\.settings\.find\(\(s\) => s\.key === "caisse\.prefixe"\)\} onSaved=\{reload\} \/>/g)?.length, 2, "dans les deux rubriques");
  assert.equal(caisse.match(/<DeviseInstitut settings=\{data(\?\.settings \?\? \[\]|\.settings)\} onSaved=\{reload\} \/>/g)?.length, 2, "rubrique Devise dans les deux rubriques Caisse");
  const bloc = readFileSync("src/client/components/reglages/prefixe-factures.tsx", "utf8");
  assert.match(bloc, /confirm\(\(\) => api\("PUT", "\/api\/settings\/caisse\.prefixe", \{ value: result\.value \}\)\)/);
  assert.match(bloc, /if \(!etat\.modifiable\) \{/, "figé ou gérante : texte seul, aucun formulaire imbriqué");
  assert.match(bloc, /t\("reglages_caisse\.prefixe_fige", \{ numero: etat\.fige \}\)/);
  assert.match(bloc, /aria-invalid=\{fieldError \? true : undefined\}/);
  assert.match(bloc, /yearAt\(Date\.now\(\)\)/, "année de Douala pour l'exemple de numéro");
});

test("préfixe des factures (rulings T2-1) : la première vente le fige sans signal « settings », l'écran se recharge aussi sur « invoices » (deux rubriques)", () => {
  const caisse = readFileSync("src/client/components/reglages/caisse.tsx", "utf8");
  assert.equal(caisse.match(/useLoad\(\(\) => api<\{ settings: Setting\[\] \}>\("GET", "\/api\/settings"\), \["settings", "invoices"\]\)/g)?.length, 2);
});

test("rubrique Devise : pas de formulaire imbriqué, boutons sans submit, réglages d'affichage confirmés", () => {
  const bloc = readFileSync("src/client/components/reglages/devise-institut.tsx", "utf8");
  assert.doesNotMatch(bloc, /<form/, "le formulaire de la gérante enveloppe déjà la rubrique");
  assert.match(bloc, /<Button type="button" onClick=\{changer\}/, "le bouton de changement ne soumet pas le parent");
  assert.doesNotMatch(bloc, /<Button(?![^>]*type="button")/, "aucun bouton sans type=\"button\"");
  assert.match(bloc, /confirm\(\(\) => api\("PUT", `\/api\/settings\/\$\{key\}`, \{ value \}\)\)/, "PUT des réglages d'affichage confirmé");
});
