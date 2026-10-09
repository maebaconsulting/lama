import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Prestations (sous-projet 4 § 6) : par catégorie, fiche avec la bascule « Active » en grand. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liste = read("../service-list.tsx");
const fiche = read("./fiche-prestation.tsx");

test("liste : regroupée par catégorie (byCategory), inactives gardées et grisées, recherche dans les deux langues", () => {
  assert.match(liste, /const shown = services\.filter\(\(s\) => matchesSearch\(search, s\.name, s\.name_en\)\);/);
  assert.match(liste, /const groups = byCategory\(shown, lang, \{ withInactive: true \}\);/);
  assert.match(liste, /const titre = group\.category \|\| t\("prestation\.sans_categorie"\);/);
  assert.match(liste, /attenue=\{!svc\.active\}/);
  assert.match(liste, /onOpen=\{\(\) => openPanel\("service", svc\.id\)\}/);
  assert.doesNotMatch(liste, /<Table|Pencil|Trash2|updateService/, "plus d'icônes ni de bascule sur la ligne");
});

test("fiche : bascule « Active » en interrupteur de 48 px, inactive pendant l'enregistrement ; gestion pour la gérante seulement", () => {
  assert.match(fiche, /role="switch"\s*aria-checked=\{active\}\s*disabled=\{disabled\}/);
  assert.match(fiche, /<BasculeActive active=\{Boolean\(service\.active\)\} disabled=\{saving\} onToggle=\{toggle\} \/>/);
  assert.match(fiche, /updateService\(service\.id, \{ active: service\.active \? 0 : 1 \}\)/);
  assert.equal(fiche.match(/\{commands\.manage && \(/g)?.length, 2, "bascule et Modifier, Supprimer");
  assert.match(fiche, /\{!commands\.manage && <LigneDetail libelle=\{t\("colonne\.statut"\)\}>/, "les autres rôles lisent l'état");
  assert.match(fiche, /onDelete=\{\(\) => deleteService\(service\.id\)\}/);
});

test("prestation dont le compteur de rendez-vous n'est pas nul : pas de « Supprimer » proposé pour être refusé, l'explication à la place", () => {
  assert.match(fiche, /bloquee=\{\(service\.appointment_count \?\? 0\) > 0 \? t\("prestation\.suppression_impossible"\) : null\}/);
});

test("relecture finale : deleteService ferme le panneau tout de suite après la suppression, avant que la liste se recharge (plus de « fiche introuvable » furtif)", () => {
  const hook = read("../../hooks/use-app.ts");
  assert.match(hook, /const deleteService = useCallback\(async \(id: number\) => \{\s*await api\("DELETE", `\/api\/services\/\$\{id\}`\);[\s\S]*?closePanel\(\);\s*await fetchServices\(\);\s*await fetchStats\(\);\s*\}, \[closePanel, fetchServices, fetchStats\]\);/);
});
