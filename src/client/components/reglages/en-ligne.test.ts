import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fr } from "../../i18n/fr.ts";
import { en } from "../../i18n/en.ts";
import { TEXTES } from "../../../../relais/public/textes.ts";

/** Rubrique « Réservation en ligne » (spec § 4.6 et § 9.4). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const rubrique = read("./en-ligne.tsx");
const apercu = read("./apercu-theme.tsx");

test("gérante : interrupteur, horizon, délai, adresse, textes d'accord, enregistrés champ par champ", () => {
  assert.match(rubrique, /CLES_GERANTE/);
  assert.match(rubrique, /changedKeys\(baseline, form\)/);
  assert.match(rubrique, /valeurReglage\(cle, form\[cle\]\)/);
  assert.match(rubrique, /id="en-ligne-active"/);
});

test("thème : contrôle avant l'envoi, aperçu aux couleurs exactes, retour à la charte de lama", () => {
  assert.match(rubrique, /problemeAffiche\(theme\)/);
  assert.match(rubrique, /\{ value: actif \? theme : null \}/);
  assert.match(rubrique, /<ApercuTheme theme=\{theme\}/);
  assert.match(apercu, /const p = palette\(theme\);/);
  assert.match(apercu, /background: p\.accent, color: p\.surAccent/);
});

test("liaison : état relu, « Tester la liaison », page, code d'intégration à copier, QR code à télécharger ; salon et clé à l'administrateur, mot de passe retapé", () => {
  assert.match(rubrique, /api<EtatLiaison>\("GET", "\/api\/en-ligne\/etat"\)/);
  assert.match(rubrique, /api<\{ ok: boolean; message: string \}>\("POST", "\/api\/en-ligne\/tester", \{\}\)/);
  assert.match(rubrique, /navigator\.clipboard\.writeText/);
  assert.match(rubrique, /download="qr-reservation\.svg"/);
  assert.match(rubrique, /confirm\(\(\) => api\("PUT", `\/api\/settings\/\$\{cle\}`, \{ value: valeur \}\)\)/);
  assert.match(rubrique, /type="password"/);
});

test("textes de la rubrique : mêmes clés en français et en anglais", () => {
  const cles = [...(rubrique + apercu).matchAll(/\bt\("([a-z_.]+)"/g)].map((m) => m[1]);
  assert.ok(cles.length > 20);
  for (const cle of cles) {
    assert.ok(cle in fr, `fr : ${cle}`);
    assert.ok(cle in en, `en : ${cle}`);
  }
});

test("thème : « Enregistrer » grisé par la règle pure", () => {
  assert.match(rubrique, /disabled=\{!peutEnregistrerTheme\(actif, theme, envoi\.occupe\)\}/);
});

test("clé du relais : jamais affichée, saisie vidée après succès, seul l'indicateur « set » est lu", () => {
  assert.match(rubrique, /setCleSaisie\(""\);\n\s+setOk/);
  assert.match(rubrique, /find\(\(s\) => s\.key === "en_ligne\.cle"\)\?\.set/);
  assert.equal([...rubrique.matchAll(/"en_ligne\.cle"/g)].length, 3, "en_ligne.cle : lue par .set, écrite à l'enregistrement, et son libellé");
  assert.doesNotMatch(rubrique, /value=\{String\(settings\.find\(\(s\) => s\.key === "en_ligne\.cle"/);
  assert.match(rubrique, /placeholder=\{cleReglee \? t\("en_ligne\.cle_enregistree"\) : ""\}/);
  assert.match(rubrique, /value=\{cleSaisie\}/);
});

test("aide de l'interrupteur : le texte exact de la page du relais quand la réservation est coupée", () => {
  const ferme = TEXTES["refus.ferme"];
  assert.ok(fr["en_ligne.active_aide"].includes(`«\u00a0${ferme.fr.replace(/\.$/, "")}\u00a0»`), fr["en_ligne.active_aide"]);
  assert.ok(en["en_ligne.active_aide"].includes(`“${ferme.en.replace(/\.$/, "")}”`), en["en_ligne.active_aide"]);
});

test("QR code : demandé seulement quand l'état de la liaison donne une page, et seulement par la gérante", () => {
  const partage = rubrique.slice(rubrique.indexOf("function PartageEnLigne()"), rubrique.indexOf("function LiaisonAdmin("));
  assert.doesNotMatch(partage, /useLoad\([^\n]*\/api\/en-ligne\/qr/, "jamais chargé d'office, ni relu à chaque signal");
  assert.match(partage, /useEffect\(\(\) => \{\n {4}if \(!page\) \{/);
  assert.match(partage, /api<\{ image: string; page: string \}>\("GET", "\/api\/en-ligne\/qr"\)/);
  assert.match(partage, /\}, \[page\]\);/);
  assert.match(rubrique, /\{gerante && <PartageEnLigne \/>\}/);
});

test("état de la liaison : le nombre de demandes en attente dans la police du texte voisin", () => {
  assert.match(rubrique, /<dd>\{e\.attente_relais \?\? t\("en_ligne\.etat\.inconnu"\)\}<\/dd>/);
  assert.doesNotMatch(rubrique, /<dd className="chiffres">/);
});
