import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fr } from "../i18n/fr.ts";
import { en } from "../i18n/en.ts";

/**
 * Sélecteurs de date et d'heure (fiche selecteurs-date, 29/09/2026) :
 * calendrier maison bilingue pour les dates, liste de créneaux de 15 minutes
 * pour les heures.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const champ = read("./champ-date.tsx");
const cal = read("./calendrier.tsx");

test("ChampHeure : liste déroulante native de créneaux (SELECT : 16 px, 44 px)", () => {
  assert.match(champ, /<select\b[^>]*className=\{cn\(SELECT,/);
  assert.match(champ, /timeSlots\(borne, value\)/);
  assert.match(champ, /borne\?: Borne/);
});

test("heure de fin du blocage : créneaux de fin (07:15 à 23:00)", () => {
  const view = read("./agenda/bloquer-creneau.tsx");
  assert.match(view, /<ChampHeure id="block-end" borne="fin"/);
  assert.match(read("./agenda/grille.tsx"), /DAY_START_HOUR/, "l'agenda lit les bornes de la journée dans lib/creneaux.ts");
  assert.doesNotMatch(view, /length: 14 \}, \(_, i\) => i \+ 7/, "plus de bornes écrites en dur");
});

test("ChampDate : saisie clavier conservée, calendrier au toucher, icône de 44 px", () => {
  assert.match(champ, /dateFromText/);
  assert.match(champ, /<Calendrier\b/);
  assert.match(champ, /\(pointer: coarse\)/, "détection des appareils tactiles");
  assert.match(champ, /inputMode=\{tactile \? "none" : "numeric"\}/, "le toucher n'ouvre pas le clavier");
  assert.match(champ, /aria-label=\{t\("calendrier\.ouvrir"\)\}/);
  assert.match(champ, /h-11 w-11/);
  assert.match(champ, /aria-haspopup="dialog"/);
  assert.match(champ, /aria-expanded=\{ouvert\}/);
});

test("calendrier : noms d'Intl, lundi en premier, aujourd'hui à Douala", () => {
  for (const fn of ["monthTitle", "weekdayInitials", "monthGrid", "todayAt", "formatLongDate"]) assert.match(cal, new RegExp(`\\b${fn}\\(`), fn);
});

test("calendrier : flèches de 44 px aux libellés traduits, bouton Aujourd'hui", () => {
  assert.match(cal, /aria-label=\{t\("calendrier\.mois_precedent"\)\}/);
  assert.match(cal, /aria-label=\{t\("calendrier\.mois_suivant"\)\}/);
  assert.match(cal, /\{t\("calendrier\.aujourdhui"\)\}/);
  assert.ok((cal.match(/h-11 w-11/g) ?? []).length >= 2);
});

test("calendrier : grille accessible au clavier, Échap, focus rendu au champ", () => {
  assert.match(cal, /role="grid"/);
  assert.match(cal, /role="gridcell"/);
  for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Escape"]) {
    assert.match(cal, new RegExp(`"${key}"`), key);
  }
  assert.match(cal, /aria-selected=/);
  assert.match(cal, /aria-current=\{[^}]*"date"/);
  assert.match(champ, /focus\(\)/, "le focus revient au champ à la fermeture");
});

test("calendrier : charte (carte, touche au survol, action principale pour la date choisie, filet pour aujourd'hui), dans les deux thèmes", () => {
  assert.match(cal, /bg-primary text-primary-foreground/);
  assert.match(cal, /hover:bg-muted/);
  assert.match(cal, /border-filet/);
  // Vague 2 : le filet (1,40:1 en sombre) ne suffisait pas, aujourd'hui prend l'encre grise (lisible dans les deux thèmes).
  assert.match(cal, /day === today && "border border-encre-grise"/);
  assert.match(cal, /bg-card/);
  assert.doesNotMatch(cal, /(?<!hover:|focus-visible:)bg-muted/, "touche ivoire seulement au survol et à la sélection");
});

test("calendrier : panneau fixe, hors du corps qui défile des fenêtres, feuille du bas en dernier recours", () => {
  assert.match(cal, /position: "fixed"|\bfixed\b/);
  assert.match(cal, /safe-area-inset-bottom/);
  assert.match(cal, /pointerdown/, "clic dehors");
});

test("fenêtre : Échap ferme d'abord le calendrier, pas la fenêtre", () => {
  const dialog = read("./ui/dialog.tsx");
  assert.match(dialog, /onEscapeKeyDown/);
  assert.match(dialog, /\[data-calendrier-ouvert\]/);
  assert.match(champ, /data-calendrier-ouvert=/);
});

test("clés du calendrier dans les deux langues", () => {
  for (const key of ["calendrier.ouvrir", "calendrier.mois_precedent", "calendrier.mois_suivant", "calendrier.aujourdhui", "calendrier.titre", "saisie.heure_choisir"]) {
    assert.ok(key in fr, `fr : ${key}`);
    assert.ok(key in en, `en : ${key}`);
  }
});

test("journal : Du et Au se bornent l'un l'autre (relecture, mineur 1)", () => {
  const journal = read("./reglages/journal.tsx");
  assert.match(journal, /<ChampDate id="journal-du" max=\{filtre\.to\}/);
  assert.match(journal, /<ChampDate id="journal-au" min=\{filtre\.from\}/);
  assert.match(champ, /dateWithin\(text, min, max\)/, "la saisie au clavier respecte les bornes");
  assert.match(champ, /"saisie\.date_hors_bornes"/);
});

test("calendrier : une date tapée pendant que le panneau est ouvert déplace la grille (relecture, mineur 2)", () => {
  assert.match(cal, /useEffect\(\(\) => \{\n\s*const month = monthOf\(value\);[\s\S]*?setView\(month\);[\s\S]*?\}, \[value\]\);/);
});

test("champ de date : quitter le champ avec Tab ferme le panneau (relecture, mineur 3)", () => {
  assert.match(champ, /onFocusOut=/);
  assert.match(champ, /relatedTarget/);
});

test("listes d'heures dans la police de l'interface, chiffres alignés, jamais le Garamond des chiffres de registre (sous-projet 7, vague 2)", () => {
  assert.match(champ, /className=\{cn\(SELECT, "tabular-nums", className\)\}/);
  assert.doesNotMatch(champ.slice(champ.indexOf("export function ChampHeure")), /chiffres/);
});
