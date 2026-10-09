import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * « Ma journée » (sous-projet 4 § 5.1), câblée sur les règles de `lib/accueil.ts`
 * (testées en exécution dans `lib/accueil.test.ts`) et les crochets partagés.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const vue = read("./ma-journee.tsx");

test("sa journée à l'heure de Douala, par le lien entre son compte et sa fiche de l'équipe", () => {
  assert.match(vue, /const clock = useDoualaClock\(\);/);
  assert.match(vue, /const staffId = account\.staff_id;/);
  assert.match(vue, /useCalendarRange\(staffId === null \? null : \{ start: clock\.day, end: clock\.day \}\)/);
  assert.match(vue, /journee\(range\.appointments, staffId, clock\.day, clock\.time\)/);
});

test("sans fiche reliée : le message qui invite à demander à la gérante, aucune requête", () => {
  assert.match(vue, /if \(staffId === null\) return <EtatVide message=\{t\("journee\.sans_fiche"\)\} \/>;/);
});

test("journée vide : le message et le lien vers l'agenda de l'équipe, qui ramène l'agenda sur aujourd'hui", () => {
  assert.match(vue, /<EtatVide message=\{t\("journee\.vide"\)\} action=\{\{ libelle: t\("journee\.voir_agenda"\), onClick: \(\) => \{ setCalendarDate\(clock\.day\); navigate\(pathFor\("calendar", lang\)\); \} \}\} \/>/);
});

// Relecture finale, constat 2 (mineur) : le bandeau d'erreur de rechargement n'était rendu que
// dans la branche non vide ; sur une journée vide, un rechargement en échec ne disait rien.
test("liste vide et rechargement en échec : l'erreur est dite, pas seulement « aucun rendez-vous »", () => {
  const corps = vue.slice(vue.indexOf("const body = () => {"), vue.indexOf("return (\n    <div", vue.indexOf("const body = () => {")));
  const erreurIdx = corps.indexOf("{range.error && <EtatErreur message={range.error} onRetry={range.reload} />}");
  const videIdx = corps.indexOf("journee.vide");
  assert.notEqual(erreurIdx, -1, "le bandeau d'erreur doit être rendu même si la liste est vide");
  assert.ok(erreurIdx < videIdx, "le bandeau d'erreur doit précéder l'état vide, pas être limité à la liste non vide");
  assert.equal(corps.split("range.error && <EtatErreur").length - 1, 1, "un seul bandeau d'erreur partagé, pas un doublon limité à la liste non vide");
});

// Relecture finale, constat 3 (mineur) : « Voir l'agenda de l'équipe » depuis une journée vide
// n'ouvrait pas l'agenda sur aujourd'hui (même règle que « Aujourd'hui », toAgenda).
test("« Voir l'agenda de l'équipe » ramène l'agenda sur aujourd'hui avant d'y aller", () => {
  assert.match(vue, /const \{ openPanel, navigate, setCalendarDate \} = useApp\(\);/);
});

// Relecture finale, constat 5 (défaut navigateur) : seul l'en-tête portait hors-panneau ; entre
// 768 et 1279 px, les notes et la liste passaient sous le panneau posé.
test("contenu sous le panneau posé (768 à 1279 px) : le conteneur racine s'arrête à son bord", () => {
  assert.match(vue, /<div className="hors-panneau mx-auto max-w-3xl space-y-5 p-4 sm:p-6">/);
});

test("prochain rendez-vous sur fond ivoire : heure, cliente, prestations, durée, notes ; journée finie dite", () => {
  const prochain = vue.slice(vue.indexOf("function Prochain("), vue.indexOf("function Ligne("));
  assert.match(prochain, /<section aria-label=\{libelle\} className="rounded-sm bg-muted">/);
  assert.match(prochain, /formatRange\(apt\.start_time, apt\.end_time\)/);
  assert.match(prochain, /t\("commun\.minutes", \{ min: durationOf\(apt\) \}\)/);
  assert.match(prochain, /const \{ notes, error, retry \} = useNotesDuProchain\(apt\);/);
  assert.match(vue, /prochainesNotes\(\{ notes: detail\.appointment\.appointment_notes, bookingNote: detail\.appointment\.notes, clientNotes: fiche\.client\.notes \}\)/);
  assert.match(vue, /\{next \? <Prochain apt=\{next\} onOpen=\{\(\) => open\(next\)\} \/> : <p className="rounded-sm bg-muted p-5 font-serif text-xl">\{t\("journee\.finie"\)\}<\/p>\}/);
});

// Relecture finale, constat 1 (important) : un échec de rechargement des notes du prochain
// rendez-vous ne doit jamais effacer des notes déjà reçues (ex. « Peau sensible : éviter les
// huiles essentielles ») en les remplaçant par « Aucune note. ».
test("réseau coupé pendant le rechargement des notes : les notes déjà reçues restent affichées", () => {
  const hook = vue.slice(vue.indexOf("function useNotesDuProchain("), vue.indexOf("function Prochain("));
  assert.doesNotMatch(hook, /setNotes\(\[\]\)/, "un échec ne doit plus remplacer les notes déjà reçues par une liste vide");
  assert.match(hook, /setState\(\(s\) => \(\{ \.\.\.s, error: err\.message \}\)\)/, "l'échec doit garder l'état précédent (notes) et seulement poser l'erreur");
  const prochain = vue.slice(vue.indexOf("function Prochain("), vue.indexOf("function Ligne("));
  assert.match(prochain, /notes === null \? \(\s*error \? <EtatErreur message=\{error\} onRetry=\{retry\} \/> : <EtatChargement \/>/, "premier chargement en échec, sans notes reçues : EtatErreur avec Réessayer, jamais « Aucune note »");
  assert.match(prochain, /notes\.length === 0 \? \(/, "« Aucune note » seulement quand les notes reçues sont vides");
});

test("toute la journée en lignes : toucher ouvre la fiche dans le panneau, passé grisé, terminé marqué", () => {
  assert.match(vue, /const open = \(apt: Appointment\) => openPanel\("appointment", apt\.id\);/);
  const ligne = vue.slice(vue.indexOf("function Ligne("), vue.indexOf("export function MaJournee"));
  assert.match(ligne, /const done = etat === "termine" \|\| etat === "absente" \|\| etat === "passe";/);
  assert.match(ligne, /done && "text-muted-foreground"/);
  assert.match(ligne, /\{etat === "termine" && <Check/);
  assert.match(ligne, /min-h-12/, "lignes de 48 px");
});

test("aucun montant sur l'écran de la praticienne (retirés par le serveur, jamais affichés)", () => {
  assert.doesNotMatch(vue, /formatPrice|total_price/);
});

test("l'accueil suit le rôle : « Ma journée » pour la praticienne", () => {
  const accueil = read("../dashboard.tsx");
  assert.match(accueil, /return account\.role === "practitioner" \? <MaJournee \/> : <Aujourdhui \/>;/);
});

// Report de la vague 3 : le nom lu du bloc « Prochain » (aria-label) remplaçait tout son texte
// visible (heure, prestations, durée) ; le bouton prend désormais pour nom ce qu'il affiche.
test("bloc du prochain rendez-vous : le nom lu est le texte affiché (heure, cliente, prestations, durée)", () => {
  const prochain = vue.slice(vue.indexOf("function Prochain("), vue.indexOf("function Ligne("));
  assert.match(prochain, /<button type="button" onClick=\{onOpen\} className=/);
  assert.doesNotMatch(prochain, /journee\.ouvrir_fiche/);
});
