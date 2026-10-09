import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en } from "../../i18n/en.ts";
import { fr } from "../../i18n/fr.ts";

/**
 * Mon compte à gros sélecteurs et journal en cartes (sous-projet 4 § 7.1) ;
 * filtre de date illisible dit et champ de date accessible (§ 7.3).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const monCompte = read("./mon-compte.tsx");
const journal = read("./journal.tsx");
const champDate = read("../champ-date.tsx");

test("Mon compte : langue en deux gros boutons de 64 px, chaque langue écrite dans sa propre langue", () => {
  assert.doesNotMatch(monCompte, /<select\b/, "plus de liste déroulante");
  assert.match(monCompte, /<div role="group" aria-label=\{t\("langue\.choix"\)\} className="grid max-w-md grid-cols-2 gap-2">/);
  assert.match(monCompte, /aria-pressed=\{lang === code\}/);
  assert.match(monCompte, /"min-h-16 rounded-sm border/);
  assert.match(monCompte, /\{translate\(code, code === "fr" \? "langue\.nom\.fr" : "langue\.nom\.en"\)\}/);
});

test("Mon compte : thème en trois gros boutons, PIN en grands chiffres", () => {
  assert.match(monCompte, /<ChoixTheme\s+grand\b/);
  assert.match(read("../choix-theme.tsx"), /grand && "min-h-16 text-base"/);
  assert.match(monCompte, /id="pin-nouveau" type="password" inputMode="numeric" maxLength=\{6\} className="h-14 text-center text-2xl tracking-\[0\.5em\]"/);
});

test("Mon compte : coche sur la langue active, lisible en thème sombre (retouche 9)", () => {
  assert.match(monCompte, /\{lang === code && <Check aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 text-foreground" \/>\}/);
});

test("Thème : coche sur le choix actif des gros sélecteurs (64 px) seulement, pas sur les petits (retouche 9)", () => {
  const choixTheme = read("../choix-theme.tsx");
  assert.match(choixTheme, /\{grand && active && <Check aria-hidden="true" className="absolute right-2 top-2 h-4 w-4 text-foreground" \/>\}/);
});

test("journal : une carte par entrée au téléphone, une ligne dense dès 36 rem, plus de tableau", () => {
  assert.doesNotMatch(journal, /<Table\b/);
  assert.match(journal, /<div className="@container space-y-4">/);
  assert.match(journal, /@xl:grid-cols-\[9\.5rem_minmax\(0,1fr\)_minmax\(0,1fr\)\]/);
  assert.match(journal, /className="grid gap-4 @xl:grid-cols-2 @3xl:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1fr\)_minmax\(0,1fr\)_auto\]"/, "filtres selon la largeur réelle, panneau et rubriques compris");
});

test("journal : « Du » et « Au » toujours sur la même ligne dès 36 rem, la personne au-dessus jusqu'à 48 rem (retouche 7)", () => {
  assert.doesNotMatch(journal, /@4xl:grid-cols-4/, "plus de période coupée en diagonale");
  assert.match(journal, /<div className="space-y-1\.5 @xl:col-span-2 @3xl:col-span-1">\s*<Label htmlFor="journal-personne">/);
  assert.match(journal, /<div className="@3xl:self-start @3xl:pt-7"><Button type="submit">/);
});

test("journal : les lignes denses gardent leur filet de séparation (retouche 4)", () => {
  const ul = journal.match(/<ul aria-label=\{t\("reglages\.rubrique\.journal"\)\} className="([^"]*)"/)?.[1] ?? "";
  assert.ok(ul, "liste du journal introuvable");
  assert.doesNotMatch(ul, /divide-/, "le filet est porté par chaque ligne, pas par la liste (spécificité nulle de divide-y)");
  const li = journal.match(/<li key=\{e\.id\} className="([^"]*)"/)?.[1] ?? "";
  const classes = li.split(/\s+/);
  for (const cls of ["border", "border-filet", "@xl:border-x-0", "@xl:border-t-0", "@xl:last:border-b-0"]) assert.ok(classes.includes(cls), cls);
  assert.ok(!classes.includes("@xl:border-0"), "@xl:border-0 effaçait le filet bas");
});

test("journal : une date illisible dans le filtre est dite, le filtre n'est pas appliqué (§ 7.3)", () => {
  assert.match(journal, /if \(!\(e\.currentTarget as HTMLFormElement\)\.checkValidity\(\)\) \{\s*setProbleme\(t\("journal\.date_illisible"\)\);\s*return;\s*\}/);
  assert.match(journal, /<Erreur message=\{probleme \?\? entrees\.error\} \/>/);
  assert.ok("journal.date_illisible" in fr && "journal.date_illisible" in en);
});

test("champ de date : rôle combobox, message d'erreur visible relié par aria-describedby, montré au départ du champ ou à l'envoi (§ 7.3)", () => {
  assert.match(champDate, /role="combobox"\s+aria-haspopup="dialog"/);
  assert.match(champDate, /aria-describedby=\{visible \? errorId : undefined\}/);
  assert.match(champDate, /<p id=\{errorId\} aria-hidden=\{!visible\} className="mt-1 min-h-5 text-sm text-encre-rouge">\{visible \? t\(format\.invalidKey\(text\)\) : ""\}<\/p>/);
  assert.match(champDate, /onInvalid=\{\(\) => setShown\(true\)\}/);
  assert.match(champDate, /setShown\(text\.trim\(\) !== "" && parsed === null\);/, "onBlur ne montre le message que si la saisie n'est pas vide et reste illisible");
});

test("champ de date : ligne du message réservée sous le champ, toujours rendue (retouche 1)", () => {
  assert.doesNotMatch(champDate, /\{visible && <p/, "le paragraphe n'est plus conditionné : il est toujours rendu, vide hors erreur");
  assert.match(champDate, /min-h-5/, "hauteur d'une ligne de texte-sm réservée, pour que rien ne se déplace au premier appui sur un bouton voisin");
});

test("champ de date : après un premier blur, une nouvelle saisie lisible réarme l'attente (relecture, mineur 2)", () => {
  assert.match(champDate, /if \(format\.parse\(next\) !== null\) setShown\(false\);/, "shown se remet à false dès que la saisie redevient lisible, pas à chaque frappe illisible");
});
