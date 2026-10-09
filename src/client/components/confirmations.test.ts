import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Vague C de la passe V 1.0 (décision 5) : confirmation compacte en deux temps
 * avant chaque suppression des listes et de la grille, vérifiée par la source
 * (pas de DOM dans ces essais) ; le verrou qui empêche le double envoi est
 * testé en exécution dans `lib/verrou.test.ts`.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("ConfirmerSuppression : fenêtre compacte alertdialog, « Annuler » puis bouton rouge, un seul envoi, fermeture bloquée pendant la requête", () => {
  const c = read("./confirmer-suppression.tsx");
  assert.match(c, /<DialogContent compact role="alertdialog">/);
  assert.match(c, /const envoi = useEnvoi\(\);/);
  assert.match(c, /envoi\.lancer\("suppression", onConfirm\)/);
  assert.match(c, /onOpenChange=\{\(open: boolean\) => \{ if \(!open && !envoi\.occupe\) onClose\(\); \}\}/, "Échap, croix et clic dehors ignorés pendant la requête");
  assert.match(c, /<Button type="button" variant="outline" disabled=\{envoi\.occupe\} onClick=\{onClose\}>\{t\("commun\.annuler"\)\}<\/Button>/);
  assert.match(c, /<Button type="button" variant="destructive" disabled=\{envoi\.occupe\} onClick=\{\(\) => void confirmer\(\)\}>\{action\}<\/Button>/);
});

test("V1-22 : la corbeille de la liste demande confirmation et disparaît sur un rendez-vous facturé", () => {
  const liste = read("./appointment-list.tsx");
  assert.doesNotMatch(liste, /onClick=\{\(\) => deleteAppointment\(apt\.id\)/, "plus de suppression d'un toucher (téléphone)");
  assert.doesNotMatch(liste, /e\.stopPropagation\(\); deleteAppointment\(apt\.id\);/, "plus de suppression d'un toucher (tableau)");
  assert.equal((liste.match(/setASupprimer\(apt\)/g) ?? []).length, 2, "les deux corbeilles ouvrent la confirmation");
  assert.match(liste, /\{commands\.remove && !apt\.invoiced && <button/, "carte du téléphone : pas de corbeille sur un rendez-vous facturé");
  assert.match(liste, /\{!apt\.invoiced && <Button aria-label=\{t\("rdv\.supprimer", \{ ref: apt\.identifier \}\)\}/, "tableau : pas de corbeille sur un rendez-vous facturé");
  assert.match(liste, /\{commands\.remove && aSupprimer && \(\s*<ConfirmerSuppression/);
  assert.match(liste, /onConfirm=\{\(\) => supprimer\(aSupprimer\.id\)\}/);
  assert.match(liste, /const supprimer = \(id: number\) => deleteAppointment\(id\)\.catch\(\(err: Error\) => setError\(err\.message\)\);/, "le refus de l'API (V1-14) reste affiché");
});

test("V1-23 : la croix d'un créneau bloqué demande confirmation, ne déborde pas, et se grise pendant la requête", () => {
  const grille = read("./agenda/grille.tsx");
  const at = grille.indexOf('aria-label={t("agenda.retirer_blocage")}');
  assert.ok(at > 0, "croix introuvable");
  const croix = grille.slice(at - 400, at + 400);
  assert.doesNotMatch(croix, /-inset-4/, "plus de zone de toucher qui déborde sur les blocs voisins");
  assert.match(croix, /className="-mr-2 flex h-full w-11 shrink-0 items-center justify-center/, "44 px de large dans le bloc");
  assert.match(croix, /disabled=\{aRetirer !== null\}/);
  assert.match(croix, /onClick=\{\(e: Event\) => \{ e\.stopPropagation\(\); setARetirer\(block\); \}\}/);
  assert.match(grille, /\{aRetirer && \(\s*<ConfirmerSuppression/);
  assert.match(grille, /onConfirm=\{\(\) => deleteBlockedSlot\(aRetirer\.id\)\.catch\(\(err: Error\) => setError\(err\.message\)\)\}/);
});

test("V1-24 : « Supprimer la note » demande confirmation et se grise ; un seul envoi", () => {
  const fiche = read("./appointment-detail.tsx");
  assert.doesNotMatch(fiche, /onClick=\{\(\) => deleteAppointmentNote\(note\.id\)/, "plus de suppression d'un toucher");
  assert.match(fiche, /disabled=\{noteASupprimer !== null\} onClick=\{\(\) => setNoteASupprimer\(\{ id: note\.id, content: note\.content \}\)\}/);
  assert.match(fiche, /\{commands\.deleteNote && noteASupprimer && \(\s*<ConfirmerSuppression/);
  assert.match(fiche, /onConfirm=\{\(\) => deleteAppointmentNote\(noteASupprimer\.id\)\.catch\(\(err: Error\) => setError\(err\.message\)\)\}/);
});

test("V1-29 : « Retirer » la photo d'un produit passe par ConfirmerSuppression (rouge, alertdialog, fermée après la requête)", () => {
  const photo = read("./produits/photo-produit.tsx");
  assert.match(photo, /import \{ ConfirmerSuppression \} from "\.\.\/confirmer-suppression";/);
  assert.match(photo, /\{confirmer && \(\s*<ConfirmerSuppression\s*titre=\{t\("produit\.photo_retirer_confirmer"\)\}\s*detail=\{nom\}\s*action=\{t\("produit\.photo_retirer"\)\}\s*onConfirm=\{retirer\}\s*onClose=\{\(\) => setConfirmer\(false\)\}/);
  assert.doesNotMatch(photo, /<Dialog\b/, "plus de fenêtre maison qui se fermait au premier clic");
  const retirer = photo.slice(photo.indexOf("const retirer = async"), photo.indexOf("return (", photo.indexOf("const retirer = async")));
  assert.doesNotMatch(retirer, /setConfirmer\(false\)/, "la fenêtre ne se ferme pas avant la fin de la requête");
  const confirmer = read("./confirmer-suppression.tsx");
  assert.match(confirmer, /<DialogContent compact role="alertdialog">/);
  assert.match(confirmer, /variant="destructive" disabled=\{envoi\.occupe\}/);
});
