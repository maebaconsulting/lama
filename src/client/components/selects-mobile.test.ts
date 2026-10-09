import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Garde-fou D7 (audit-responsive.md) : une liste déroulante en moins de 16 px
 * fait zoomer iOS au toucher. Toutes les listes déroulantes natives doivent
 * reprendre le style de `reglages/elements.tsx` (SELECT) : 44 px de haut,
 * texte en 16 px sur téléphone (`text-base`, `md:text-sm` seulement à partir
 * du bureau).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("D7 : les listes déroulantes ont un texte d'au moins 16 px et 44 px de haut sur téléphone", () => {
  const files = [
    "./create-appointment.tsx",
    "./reschedule-appointment.tsx",
    "./appointment-list.tsx",
    "./agenda/bloquer-creneau.tsx",
  ];
  let total = 0;
  for (const f of files) {
    const text = read(f);
    const selects = text.match(/<select\b[^>]*className=\{?[^>]*\}?/g) ?? [];
    const withClass = text.match(/<select\b[^>]*>/g) ?? [];
    assert.ok(withClass.length > 0, `${f} : aucun <select> trouvé`);
    for (const tag of withClass) {
      total += 1;
      // Un select doit référencer la constante SELECT partagée (44 px, text-base md:text-sm),
      // seule ou combinée via cn(SELECT, ...).
      assert.match(tag, /className=\{(SELECT|cn\(SELECT,)/, `${f} : liste déroulante qui ne reprend pas SELECT : ${tag}`);
    }
    void selects;
  }
  assert.ok(total >= 5, "au moins 5 listes déroulantes attendues dans ces fichiers");
  assert.match(read("./create-appointment.tsx"), /grid-cols-1[^"]*md:grid-cols-2/, "cliente et membre sur une colonne tant que la fenêtre occupe tout l'écran (sous 768 px)");
});

test("D7 : SELECT (reglages/elements.tsx) fait 44 px de haut et 16 px sur téléphone", () => {
  const text = read("./reglages/elements.tsx");
  const select = text.match(/export const SELECT = "([^"]*)"/);
  assert.ok(select, "constante SELECT introuvable");
  assert.match(select![1], /\bh-11\b/);
  assert.match(select![1], /\btext-base\b/);
  assert.match(select![1], /\bmd:text-sm\b/);
});

test("nouveau rendez-vous : prestations en liste par catégorie, nom à gauche, durée et prix à droite (revue impeccable G4)", () => {
  const form = read("./create-appointment.tsx");
  assert.match(form, /\{byCategory\(services, lang\)\.map\(\(group\) =>/);
  assert.match(form, /<legend className="etiquette mb-1\.5 text-encre-grise">\{t\("menu\.prestations"\)\}<\/legend>/);
  assert.match(form, /aria-pressed=\{on\}/);
  assert.match(form, /className="chiffres-tabulaires shrink-0 text-right text-muted-foreground"/);
  assert.doesNotMatch(form, /text-\[10px\]|flex flex-wrap gap-2/, "plus de pavés de largeurs inégales ni de texte minuscule");
});
