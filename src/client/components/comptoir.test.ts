import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { annuler, appuyer, cibleFocus, confirmer, type EtatConfirmation } from "./confirmation-destructive.ts";

/** Registre « comptoir » (sous-projet 4 § 3.4). */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const comptoir = read("./comptoir.tsx");

test("chiffre clé : bloc ivoire (touche du thème), chiffre linéal en gras, libellé court, 44 px au moins", () => {
  const box = comptoir.match(/const box = "([^"]*)"/)?.[1] ?? "";
  assert.match(box, /\bbg-muted\b/);
  assert.match(box, /\bmin-h-11\b/);
  assert.match(comptoir, /font-sans text-2xl font-medium/);
  // Vague 3 : le libellé passe à la ligne au lieu d'être coupé (« Chiffre d'affaires … » à 1180 px).
  assert.match(comptoir, /etiquette max-w-full leading-snug/);
  assert.doesNotMatch(comptoir.slice(comptoir.indexOf("export function ChiffreCle"), comptoir.indexOf("export function ListeComptoir")), /truncate/);
});

// Relecture finale (constat 1, écart #7) : la même troncature que le tableau de bord guettait ce
// composant, promis à la vague 3 (§ 3.4). La valeur doit pouvoir passer à la ligne, jamais être coupée.
test("constat 1 : ChiffreCle ne tronque jamais la valeur", () => {
  const valueSpan = comptoir.match(/<span className={cn\("max-w-full[^"]*"/)?.[0] ?? "";
  assert.notEqual(valueSpan, "", "la balise de la valeur doit exister");
  assert.doesNotMatch(valueSpan, /\btruncate\b/, "la valeur ne doit jamais être coupée par troncature");
});

// Retour du contrôleur sur le constat 1 (constat 1 bis) : `break-words` coupait « FCFA » au
// milieu (« FC »/« FA ») à 820 px. Le nombre et la devise ne doivent jamais se couper eux-mêmes ;
// seul l'espace ordinaire entre les deux (posé par Montant) peut devenir un retour à la ligne.
test("constat 1 bis : aucun break-words ni overflow-wrap sur la valeur (ils coupent n'importe où)", () => {
  const montant = comptoir.slice(comptoir.indexOf("export function Montant"), comptoir.indexOf("export function ChiffreCle"));
  const valueSpan = comptoir.match(/<span className={cn\("max-w-full[^"]*"[^>]*>/)?.[0] ?? "";
  assert.doesNotMatch(montant, /break-words|overflow-wrap/, "Montant ne doit jamais couper un mot ou un nombre n'importe où");
  assert.doesNotMatch(valueSpan, /break-words|overflow-wrap/, "le bloc de la valeur ne doit jamais couper un mot ou un nombre n'importe où");
});

test("constat 1 bis : ChiffreCle affiche sa valeur par Montant", () => {
  assert.match(comptoir, /<Montant valeur=\{valeur\}\s*\/>/, "la valeur doit passer par Montant (nombre et devise dans deux blocs insécables)");
});

// Retouche 2 (critique du 30/09/2026) : « F » seul à la ligne sous « 133 000 » dans la tuile.
// Le nombre et « F » forment désormais un seul bloc insécable.
test("retouche 2 : Montant garde le nombre et « F » ensemble, dans un seul bloc insécable", () => {
  const montant = comptoir.slice(comptoir.indexOf("export function Montant"), comptoir.indexOf("export function ChiffreCle"));
  assert.match(comptoir, /import \{ amountFontSize, splitAmount \} from "@\/lib\/format"/, "Montant doit s'appuyer sur splitAmount (lib/format.ts)");
  assert.match(montant, /splitAmount\(valeur\)/, "Montant doit s'appuyer sur splitAmount");
  assert.match(
    montant,
    /<span className="whitespace-nowrap">\{parts\[0\]\}\{"\\u00a0"\}\{parts\[1\]\}<\/span>/,
    "le nombre et la devise vont dans un même bloc insécable, joints par une espace insécable",
  );
  assert.doesNotMatch(montant, /<\/span> <span/, "plus d'espace cassable entre le nombre et la devise");
});

test("retouche 2 : la tuile du chiffre clé est un conteneur, le chiffre rétrécit selon sa largeur réelle pour tenir sur une ligne", () => {
  const box = comptoir.match(/const box = "([^"]*)"/)?.[1] ?? "";
  assert.match(box, /(^| )@container( |$)/, "la tuile mesure sa largeur réelle (unités cqi)");
  const chiffre = comptoir.slice(comptoir.indexOf("export function ChiffreCle"), comptoir.indexOf("export function ListeComptoir"));
  assert.match(chiffre, /<span className=\{cn\("max-w-full font-sans text-2xl font-medium leading-none tabular-nums", alerte && "text-encre-rouge"\)\} style=\{\{ fontSize: amountFontSize\(valeur\) \}\}><Montant valeur=\{valeur\} \/><\/span>/);
});

test("liste : cartes sur téléphone, lignes de 48 px sur 768 px et plus, aucune colonne hors de l'écran", () => {
  const item = comptoir.slice(comptoir.indexOf("export function ElementListe"), comptoir.indexOf("export function EtatChargement"));
  assert.match(item, /"flex w-full min-w-0 flex-col gap-1 rounded-sm border border-filet bg-card p-4/);
  assert.match(item, /md:min-h-12 md:flex-row md:items-center/);
  assert.equal((item.match(/min-w-0/g) ?? []).length >= 3, true, "chaque texte doit pouvoir rétrécir");
  assert.doesNotMatch(item, /\bw-\[\d+px\]|\bmin-w-\[\d/, "aucune largeur fixe qui pousserait hors de l'écran");
});

test("états communs : chargement annoncé, vide avec l'action utile, erreur en alerte avec « Réessayer »", () => {
  assert.match(comptoir, /role="status" aria-live="polite"/);
  assert.match(comptoir, /t\("commun\.chargement"\)/);
  assert.match(comptoir, /action && <Button variant="outline" onClick=\{action\.onClick\}>/);
  assert.match(comptoir, /role="alert" className="[^"]*border-encre-rouge/);
  assert.match(comptoir, /t\("etat\.reessayer"\)/);
});

// Décision du contrôleur (D5) : l'assertion d'origine comparait des positions
// dans le texte source (« onConfirm() » après « asking »), ce qui est toujours
// vrai et ne prouve rien sur le comportement réel. La logique de confirmation
// est extraite dans `confirmation-destructive.ts`, un automate pur, et testée
// ici en exécution ; `BoutonDestructif` ne fait que l'appeler.
test("bouton destructif : automate de confirmation, exécuté en dehors du composant", () => {
  let etat: EtatConfirmation = "repos";

  // Premier appui : passe en demande de confirmation, sans jamais agir.
  const apresAppui = appuyer(etat);
  assert.equal(apresAppui.etat, "confirmation");
  assert.equal(apresAppui.declenche, false);
  etat = apresAppui.etat;

  // Confirmation : l'action part une seule fois, puis retour au repos.
  const apresConfirmation = confirmer(etat);
  assert.equal(apresConfirmation.etat, "repos");
  assert.equal(apresConfirmation.declenche, true);
  etat = apresConfirmation.etat;

  // Un second appel à confirmer(), sans nouvel appui, n'agit plus.
  const second = confirmer(etat);
  assert.equal(second.declenche, false);
  assert.equal(second.etat, "repos");
});

test("bouton destructif : l'annulation revient au repos sans jamais agir", () => {
  const etat = appuyer("repos").etat;
  const apresAnnulation = annuler(etat);
  assert.equal(apresAnnulation.etat, "repos");
  assert.equal(apresAnnulation.declenche, false);
});

test("bouton destructif : encre rouge, confirmation reliée à l'automate", () => {
  const destructif = comptoir.slice(comptoir.indexOf("export function BoutonDestructif"));
  assert.match(comptoir, /from "\.\/confirmation-destructive"/, "le composant utilise l'automate testé, pas une variable locale");
  assert.match(destructif, /variant="destructive"/);
  // Revue impeccable (C2) : au repos au trait rouge, l'aplat seulement sur le bouton qui confirme.
  assert.match(destructif, /<Button ref=\{declencheurRef\} variant="trait-rouge"/);
  assert.match(destructif, /text-encre-rouge/);
  assert.match(destructif, /t\("commun\.confirmer"\)/);
});

// Relecture (tour 1) : à l'entrée en confirmation, « Supprimer » disparaît
// sans que le focus suive ; à l'annulation, il n'est pas rendu. `cibleFocus`
// (confirmation-destructive.ts) calcule où le poser ; testée ici en
// exécution, indépendamment du DOM.
test("cibleFocus : « Annuler » à l'entrée en confirmation, le déclencheur après une annulation, rien après une confirmation qui agit", () => {
  assert.equal(cibleFocus("repos", "confirmation", false), "annuler");
  assert.equal(cibleFocus("confirmation", "repos", false), "declencheur");
  assert.equal(cibleFocus("confirmation", "repos", true), null, "une confirmation qui a agi ne force pas le focus (l'élément a pu disparaître)");
  assert.equal(cibleFocus("repos", "repos", false), null, "aucun changement d'état, aucune cible");
});

// DOM indisponible dans ces tests (pas de jsdom ni de bibliothèque de rendu
// dans ce dépôt, voir `package.json`) : le déplacement du focus est donc
// vérifié par la source, pas par une interaction réelle.
test("bouton destructif : le focus suit la confirmation et l'annulation (Échap comprise), par la source (DOM indisponible ici)", () => {
  const destructif = comptoir.slice(comptoir.indexOf("export function BoutonDestructif"));
  assert.match(destructif, /cibleFocus\(etatPrecedent\.current, etat, dernierDeclenche\.current\)/, "la cible est recalculée à chaque changement d'état");
  assert.match(destructif, /annulerRef\.current\?\.focus\(\)/, "le focus se pose sur « Annuler » à l'entrée en confirmation");
  assert.match(destructif, /declencheurRef\.current\?\.focus\(\)/, "le focus revient sur le déclencheur après une annulation");
  assert.match(destructif, /<Button ref=\{declencheurRef\}/, "le bouton d'origine porte bien la référence attendue");
  assert.match(destructif, /<Button ref=\{annulerRef\}/, "le bouton « Annuler » porte bien la référence attendue");
  assert.match(destructif, /e\.key === "Escape"/, "Échap annule aussi");
  assert.match(destructif, /onKeyDown=\{surEchap\}/, "le groupe de confirmation écoute Échap");
});

// Relecture finale (constat 3) : Échap dans la confirmation annulait, puis remontait jusqu'au
// onKeyDown du panneau (cadre/panneau.tsx:39) qui ferme la fiche. La propagation doit s'arrêter ici.
test("constat 3 : Échap dans la confirmation ne remonte pas jusqu'au panneau", () => {
  const surEchap = comptoir.slice(comptoir.indexOf("const surEchap ="), comptoir.indexOf('if (etat === "repos")'));
  assert.notEqual(surEchap.trim(), "", "le gestionnaire surEchap doit exister");
  assert.match(surEchap, /e\.stopPropagation\(\)/, "Échap ne doit pas se propager au-delà de la confirmation (ne doit pas fermer aussi le panneau)");
});

// Tâche 10 (décision D4, pas de double envoi) : « Confirmer » est lui aussi inactif
// pendant l'enregistrement, comme le bouton d'origine.
test("bouton destructif : « Confirmer » inactif pendant l'enregistrement", () => {
  const destructif = comptoir.slice(comptoir.indexOf("export function BoutonDestructif"));
  assert.match(destructif, /<Button variant="destructive" disabled=\{disabled\} onClick=\{\(\) => jouer\(confirmer\(etat\)\)\}>\{t\("commun\.confirmer"\)\}<\/Button>/);
});

test("la charte montre les composants du comptoir, en thème clair", () => {
  const charte = read("./charte.tsx");
  for (const name of ["ChiffreCle", "ListeComptoir", "ElementListe", "EtatChargement", "EtatVide", "EtatErreur", "BoutonDestructif"]) {
    assert.match(charte, new RegExp(`<${name}\\b`), name);
  }
});
