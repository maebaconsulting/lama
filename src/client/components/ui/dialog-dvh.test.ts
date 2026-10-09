import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Garde-fou D12 (audit-responsive.md) : les fenêtres doivent tenir dans
 * l'écran (dvh, pas vh) et défiler en interne ; le pied de fenêtre reste
 * atteignable.
 *
 * Relecture 1 : un pied "sticky bottom-0" au sein d'une grille CSS (`grid`)
 * pouvait recouvrir la fin du corps de la fenêtre (constaté dans
 * create-service.tsx : le libellé « Couleur » et la 1re rangée de pastilles
 * rendus sous le pied, capture 390-prestation-nouvelle.jpg). Le test ne
 * vérifie donc plus la présence de "sticky", mais la structure en colonne :
 * le pied (et l'en-tête) sont des frères de la zone qui défile, jamais des
 * descendants de celle-ci, donc jamais recouverts.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("D12 : la fenêtre de base tient dans l'écran (dvh, avec un repli vh) et défile au besoin", () => {
  const dialog = read("./dialog.tsx");
  assert.match(dialog, /max-h-\[90vh\]/, "repli vh pour les navigateurs sans dvh");
  assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(dialog, /overflow-y-auto/);
});

test("D12 : le pied (et l'en-tête) ne sont jamais à l'intérieur de la zone qui défile", () => {
  const dialog = read("./dialog.tsx");
  // Le corps (seul) est enveloppé dans le conteneur qui défile ...
  const scrollWrapper = dialog.match(/<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">\{body\}<\/div>/);
  assert.ok(scrollWrapper, "le corps doit être seul dans le conteneur qui défile");
  // ... et le pied est rendu juste après, donc hors de ce conteneur (frère, pas descendant).
  assert.match(dialog, /<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">\{body\}<\/div>\s*\{footer\}/);
  // Le pied lui-même n'a plus la classe qui le figeait : sa place dans la mise en page suffit désormais.
  const footerClass = dialog.match(/const DialogFooter[\s\S]{0,400}?flex shrink-0 flex-col-reverse[^"]*"/);
  assert.ok(footerClass, "classe du pied introuvable");
  assert.doesNotMatch(footerClass![0], /sticky-bottom|\bsticky\s/);
});

test("D12 : plus aucune fenêtre ne limite sa hauteur en vh (unité qui varie sous Safari iOS)", () => {
  const files = [
    "../create-service.tsx",
    "../create-appointment.tsx",
    "../create-product.tsx",
    "../reschedule-appointment.tsx",
  ];
  for (const f of files) assert.doesNotMatch(read(f), /90vh/, f);
});

test("D12 (sous-projet 4) : la feuille « Plus » du téléphone tient dans l'écran (dvh) et défile en interne", () => {
  const phone = read("../cadre/telephone.tsx");
  assert.match(phone, /max-h-\[85dvh\]/);
  assert.match(phone, /flex min-h-0 flex-1 flex-col overflow-y-auto/);
});

// Revue impeccable (G1, G2, G5) : au téléphone, la fenêtre occupe tout l'écran avec ses zones
// sûres (sauf `compact`) ; titre à gauche partout ; à l'ouverture, le focus va sur la fenêtre.
test("fenêtre : plein écran sous 768 px, carte centrée au-delà, titre à gauche, pas de focus automatique dans un champ", () => {
  const dialog = read("./dialog.tsx");
  assert.match(dialog, /: "inset-0 pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\] pl-\[max\(1rem,env\(safe-area-inset-left\)\)\] pr-\[max\(1rem,env\(safe-area-inset-right\)\)\] pt-\[calc\(1rem\+env\(safe-area-inset-top\)\)\]"/);
  assert.match(dialog, /\? "inset-x-4 top-\[50%\] max-h-\[calc\(100dvh-2rem\)\] translate-y-\[-50%\] rounded-sm border border-foreground p-6"/);
  assert.match(dialog, /"md:inset-auto md:left-\[50%\] md:top-\[50%\]/);
  assert.match(dialog, /"flex shrink-0 flex-col gap-1\.5 pr-12 text-left /);
  assert.doesNotMatch(dialog, /text-center/);
  assert.match(dialog, /if \(focusChamp\) return;\s*event\.preventDefault\(\);/);
  // Actions empilées au téléphone : un écart entre elles (elles se touchaient).
  assert.match(dialog, /"flex shrink-0 flex-col-reverse gap-2 /);
  // Les largeurs des écrans ne s'appliquent qu'à partir de 768 px (au téléphone, tout l'écran).
  for (const name of ["create-staff", "create-product", "create-client", "create-service"]) {
    assert.match(read(`../${name}.tsx`), /<DialogContent className="md:max-w-md">/, name);
  }
  assert.match(read("../auth/confirmation.tsx"), /<DialogContent compact focusChamp>/, "mot de passe : saisie seule action, champ actif");
});

test("libellés des champs : capitales espacées, encre grise (charte, revue impeccable G3)", () => {
  assert.match(read("./label.tsx"), /"etiquette leading-snug text-encre-grise /);
});
