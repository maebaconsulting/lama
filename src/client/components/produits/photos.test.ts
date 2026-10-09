import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Écrans des photos de produits (images des produits, spec du 04/10/2026, § 2) : vignette, vue en grand, fiche, liste, caisse. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const photo = read("./photo.tsx");
const bloc = read("./photo-produit.tsx");
const liste = read("../product-list.tsx");
const ligne = read("../fiches/liste-fiches.tsx");
const catalogue = read("../caisse/catalogue.tsx");
const fiche = read("../fiches/fiche-produit.tsx");

test("vue en grand : fenêtre plein écran sur fond blanc, titre lu à voix haute ; croix et Échap de la fenêtre commune (Radix)", () => {
  assert.match(photo, /const PLEIN_ECRAN = "[^"]*\bbg-white\b[^"]*\bmd:inset-0\b[^"]*"/);
  assert.match(photo, /<DialogContent className=\{PLEIN_ECRAN\} onCloseAutoFocus=/);
  assert.match(photo, /<DialogTitle className="sr-only">\{nom\}<\/DialogTitle>/);
  assert.match(photo, /<img src=\{url\} alt=\{nom\} onError=\{\(\) => setBroken\(url\)\} className="max-h-full max-w-full object-contain" \/>/);
});

test("vignette de 40 px : photo versionnée sur fond blanc ; sans photo ou photo qui ne se charge pas, pastille neutre avec l'initiale", () => {
  assert.match(photo, /taille = "h-10 w-10"/);
  assert.match(photo, /onError=\{\(\) => setBroken\(url\)\}/);
  assert.match(photo, /\{productInitial\(nom\)\}/);
});

test("liste Produits : vignette devant le nom (le nom reste toujours écrit), touchable vers la vue en grand, hors du bouton de la ligne", () => {
  assert.match(liste, /titre=\{nom\}/);
  assert.match(liste, /avant=\{productImageUrl\(p\) \? <PhotoTouchable product=\{p\} nom=\{nom\} \/> : undefined\}/);
  assert.match(liste, /pastille=\{productImageUrl\(p\) \? undefined : <Vignette product=\{p\} nom=\{nom\} \/>\}/);
  assert.match(ligne, /\{avant \? <div className="[^"]*">\{avant\}\{bouton\}<\/div> : bouton\}/);
});

test("caisse : même vignette ; la loupe ouvre la vue en grand sans ajouter au ticket, à côté du bouton de la tuile, jamais dedans", () => {
  assert.match(catalogue, /vignette=\{<Vignette product=\{i\.p!\} nom=\{pickText\(lang, i\.name, i\.name_en\)\} \/>\}/);
  assert.match(catalogue, /onZoom=\{productImageUrl\(i\.p!\) \? \(\) => setZoom\(i\.p!\) : undefined\}/);
  assert.match(catalogue, /<\/button>\s*\{onZoom && \(/, "la loupe suit le bouton de la tuile");
  assert.match(catalogue, /<ZoomIn className="h-5 w-5" aria-hidden="true" \/>/);
});

test("fiche produit : bloc Photo ; dépôt et retrait par la gérante seulement, poids contrôlé avant l'envoi, retrait confirmé dans une fenêtre compacte", () => {
  assert.match(fiche, /<PhotoProduit product=\{product\} nom=\{name\} gerer=\{commands\.photo\} \/>/);
  assert.match(bloc, /if \(file\.size > PRODUCT_IMAGE_MAX_BYTES\) \{/);
  assert.match(bloc, /await apiUpload\("PUT", `\/api\/products\/\$\{product\.id\}\/image`, file\);/);
  assert.match(bloc, /await api\("DELETE", `\/api\/products\/\$\{product\.id\}\/image`\);/);
  // Fenêtre compacte commune des boutons rouges (vérification au navigateur, V1-29).
  assert.match(bloc, /<ConfirmerSuppression\s*titre=\{t\("produit\.photo_retirer_confirmer"\)\}/);
  assert.match(bloc, /\{gerer && !demo && \(/);
  assert.match(bloc, /accept="image\/png,image\/jpeg"/);
});

test("focus rendu à l'élément d'ouverture à la fermeture (vue en grand, confirmation) ; photo introuvable : nom et mention, jamais d'image cassée", () => {
  assert.match(photo, /useRef<Element \| null>\(typeof document === "undefined" \? null : document\.activeElement\)/);
  assert.match(photo, /<DialogContent className=\{PLEIN_ECRAN\} onCloseAutoFocus=\{retourFocus\}>/);
  assert.match(photo, /e\.preventDefault\(\);\s*if \(opener\.current instanceof HTMLElement/);
  assert.match(photo, /t\("produit\.photo_indisponible"\)/);
  // Confirmation : ConfirmerSuppression, sans Dialog.Trigger ; Radix rend le focus à « Retirer », l'élément actif à l'ouverture.
  assert.match(bloc, /<ConfirmerSuppression/);
});

test("tuile de la caisse : vignette au-dessus du nom, qui garde toute la largeur ; la loupe ne réserve aucune marge au contenu", () => {
  assert.match(catalogue, /vignette \? "flex-col items-start gap-2"/);
  assert.doesNotMatch(catalogue, /pr-14/);
});
