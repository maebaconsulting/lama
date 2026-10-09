import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en } from "../../i18n/en.ts";
import { fr } from "../../i18n/fr.ts";
import { pinSlots } from "../../lib/pin-pad.ts";

/**
 * Écrans d'entrée (sous-projet 4 § 7.2) : couverture de cuir et logo blanc
 * gardés, zones sûres, fiche détachée du cuir en sombre ; « Qui êtes-vous ? »
 * en cartes (nom et rôle) ; pavé du PIN en boutons de 64 px.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const couverture = read("./couverture.tsx");
const poste = read("./poste.tsx");

test("cases du PIN : quatre au moins, une de plus par chiffre au-delà, six au plus", () => {
  assert.deepEqual(pinSlots(0), [false, false, false, false]);
  assert.deepEqual(pinSlots(2), [true, true, false, false]);
  assert.deepEqual(pinSlots(5), [true, true, true, true, true]);
  assert.deepEqual(pinSlots(9), [true, true, true, true, true, true]);
});

test("couverture : zones sûres de l'iPhone (encoche, bas, côtés en paysage), bouton FR / EN compris", () => {
  assert.match(couverture, /pt-\[calc\(4\.5rem\+env\(safe-area-inset-top\)\)\]/);
  assert.match(couverture, /pb-\[calc\(2\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  assert.match(couverture, /pl-\[max\(1rem,env\(safe-area-inset-left\)\)\] pr-\[max\(1rem,env\(safe-area-inset-right\)\)\]/);
  assert.match(couverture, /<LangSwitch className="absolute right-\[max\(1rem,env\(safe-area-inset-right\)\)\] top-\[calc\(1rem\+env\(safe-area-inset-top\)\)\]" \/>/);
  assert.match(couverture, /border border-sidebar-border bg-card/, "fiche bordée d'un filet, lisible sur le cuir sombre");
});

test("« Qui êtes-vous ? » : une carte de 64 px par personne, initiale, nom en grand et rôle", () => {
  assert.match(poste, /<Couverture titre=\{t\("poste\.qui"\)\} sousTitre=\{device\.name\} large>/);
  assert.match(poste, /"flex min-h-16 w-full items-center gap-3 rounded-sm border border-filet bg-card p-3/);
  assert.match(poste, /\{m\.display_name\.trim\(\)\.charAt\(0\)\.toUpperCase\(\)\}/);
  assert.match(poste, /<span className="truncate font-serif text-lg leading-tight">\{m\.display_name\}<\/span>/);
  assert.match(poste, /\{t\(ROLE_KEYS\[m\.role\]\)\}/);
});

test("PIN : pavé de boutons de 64 px, cases qui se remplissent, nombre de chiffres annoncé", () => {
  assert.match(poste, /className=\{cn\("h-16 min-w-16 px-2"/);
  assert.match(poste, /pinSlots\(pin\.length\)\.map/);
  assert.match(poste, /<p aria-live="polite" className="flex h-8 items-center justify-center gap-3">\s*<span className="sr-only">\{tn\("poste\.chiffres", pin\.length\)\}<\/span>/, "le nombre de chiffres est dans la région live, pas dans un aria-label sur un <p>");
  assert.doesNotMatch(poste, /aria-label=\{tn\("poste\.chiffres"/, "aria-label invalide sur un <p> : rien n'est annoncé");
  assert.doesNotMatch(poste, /"h-14 text-lg"/, "plus de touches de 56 px");
});

test("PIN refusé : « PIN incorrect », écrit près des cases, pas le message de mot de passe (retouche 6)", () => {
  assert.match(poste, /err instanceof ApiError && err\.status === 401 \? t\("poste\.pin_incorrect"\) : \(err as Error\)\.message/);
  assert.match(poste, /<\/p>\s*\{\/\* Message près des cases, avant le pavé[^\n]*\*\/\}\s*<div className="mt-2"><Erreur message=\{error\} \/><\/div>\s*\{\/\* Pavé numérique/, "l'erreur s'affiche entre les cases et le pavé, pas en dessous");
  assert.doesNotMatch(poste, /<div className="mt-3"><Erreur message=\{error\} \/><\/div>/, "plus d'erreur écrite sous le pavé");
  assert.ok("poste.pin_incorrect" in fr && "poste.pin_incorrect" in en, "clé à parité");
  assert.equal(fr["poste.pin_incorrect"], "PIN incorrect. Réessayez.");
});

test("« Qui êtes-vous ? » : carte d'un compte bloqué grisée, mention lisible, pavé jamais ouvert (V1-07)", () => {
  assert.match(poste, /type Membre = \{ id: number; display_name: string; role: Role; locked: boolean \};/);
  assert.match(poste, /aria-disabled=\{m\.locked \? "true" : undefined\}/);
  assert.match(poste, /onClick=\{\(\) => \{ if \(m\.locked\) return; setChoisi\(m\); setError\(null\); \}\}/);
  assert.match(poste, /m\.locked && "cursor-not-allowed opacity-60"/);
  assert.match(poste, /\{m\.locked && <span className="etiquette text-encre-rouge">\{t\("poste\.bloque"\)\}<\/span>\}/);
  assert.equal(fr["poste.bloque"], "Bloqué, voir la gérante");
  assert.equal(en["poste.bloque"], "Locked, see the manager");
});

test("« Qui êtes-vous ? » : l'équipe qui ne se charge pas propose « Réessayer » (V1-15)", () => {
  assert.match(poste, /import \{ EtatErreur \} from "\.\.\/comptoir";/);
  assert.match(poste, /const charger = \(\) => \{/);
  assert.match(poste, /\{loadError && <EtatErreur message=\{loadError\} onRetry=\{charger\} \/>\}/);
  assert.match(poste, /useEffect\(charger, \[\]\);/);
});
