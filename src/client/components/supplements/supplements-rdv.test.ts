import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Suppléments d'un rendez-vous à l'écran (spec du 18/10/2026 § 3.3), câblés sur `lib/supplements.ts` (testé en exécution). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const choix = read("./choix.tsx");
const editeur = read("./editeur-rdv.tsx");
const creation = read("../create-appointment.tsx");
const fiche = read("../appointment-detail.tsx");
const grille = read("../agenda/grille.tsx");
const hook = read("../../hooks/use-app.ts");

test("prise de rendez-vous : prestations vendues seules, suppléments sous chaque prestation choisie, totaux et corps envoyé", () => {
  assert.match(creation, /byCategory\(sellableAlone\(services\), lang\)/);
  assert.match(creation, /<ChoixSupplements/);
  assert.match(creation, /bookingTotals\(services, selectedServices, drafts\)/);
  assert.match(creation, /supplements: selectedServices\.flatMap\(\(id, index\) => \(drafts\[id\] \?\? \[\]\)\.map\(\(d\) => \(\{ service_index: index, \.\.\.supplementPayload\(d\) \}\)\)\),/);
});

test("choix : cocher un supplément possible, quantité d'un produit, supplément libre avec ses minutes", () => {
  assert.match(choix, /const choix = choicesFor\(serviceId, catalog, lang\);/);
  assert.match(choix, /onClick=\{\(\) => onChange\(toggleChoice\(list, c\)\)\}/);
  assert.match(choix, /<ChampQuantite[^>]*onChange=\{\(q\) => onChange\(setDraftQuantity\(list, at, q\)\)\}/);
  // Quantité vidable : texte local, pris seulement quand il est lisible, borné en quittant le champ.
  assert.match(choix, /const \[text, setText\] = useState\(String\(value\)\);/);
  assert.match(choix, /onBlur=\{\(\) => \{/);
  assert.match(choix, /<ChampsLibre minutes onAdd=/);
});

test("fiche du rendez-vous : suppléments en retrait ; modification tant qu'il n'est pas encaissé, conflits proposés comme ailleurs", () => {
  assert.match(fiche, /\(svc\.supplements \?\? \[\]\)\.map\(\(s\) =>/);
  assert.match(fiche, /\{commands\.move && !apt\.paid && services\.length > 0 && \(/);
  assert.match(fiche, /<EditeurSupplements apt=\{apt\} onClose=\{\(\) => setSupplements\(false\)\} \/>/);
  assert.match(editeur, /await saveAppointmentSupplements\(apt\.id, body, allowConflict\);/);
  assert.match(editeur, /afterSaveError\(conflictsFrom\(err\), \(err as Error\)\.message\)/);
  assert.match(editeur, /disabled=\{saving \|\| !charge\.data\} onClick=\{\(\) => save\(\)\}/);
  assert.match(editeur, /message=\{charge\.error\}/);
  assert.match(hook, /await api\("PUT", `\/api\/appointments\/\$\{id\}\/supplements`, \{ supplements, \.\.\.\(allowConflict \? \{ allow_conflict: true \} : \{\}\) \}\);/);
});

test("prix absent (praticienne) : aucun prix ni total faux, jamais « 0 »", () => {
  // Fiche : un prix absent ne s'affiche pas.
  assert.match(fiche, /\{s\.price != null && <span className="chiffres whitespace-nowrap">\{formatPrice\(s\.price \* s\.quantity, lang\)\}<\/span>\}/);
});

test("carte de l'agenda : prestations suivies de leurs suppléments", () => {
  assert.match(grille, /const serviceNames = \(apt: Appointment\) => cardText\(apt, lang\);/);
});
