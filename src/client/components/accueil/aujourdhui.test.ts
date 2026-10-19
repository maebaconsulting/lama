import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { translatePlural } from "../../i18n/translate.ts";

/**
 * « Aujourd'hui » (sous-projet 4 § 5.2), câblé sur les règles de `lib/accueil.ts`
 * (testées en exécution dans `lib/accueil.test.ts`), `nextStep` (§ 4.3) et
 * `appointmentCommands` (droits inchangés).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const vue = read("./aujourdhui.tsx");

test("le jour de Douala, indépendant du jour affiché dans l'agenda", () => {
  assert.match(vue, /const clock = useDoualaClock\(\);/);
  assert.match(vue, /const range = useCalendarRange\(\{ start: clock\.day, end: clock\.day \}\);/);
  assert.doesNotMatch(vue, /calendarAppointments|calendarDate\b|today\(\)/, "plus les rendez-vous du jour de l'agenda ni le jour de l'appareil");
  // Aller à l'agenda ramène l'agenda sur aujourd'hui.
  assert.match(vue, /const toAgenda = \(\) => \{ setCalendarDate\(clock\.day\); navigate\(pathFor\("calendar", lang\)\); \};/);
});

test("chiffres clés : rendez-vous du jour, arrivées attendues, encore à venir, chiffre d'affaires prévu, stock bas", () => {
  assert.match(vue, /const figures = dayFigures\(range\.appointments, clock\.day, clock\.time\);/);
  for (const key of ["tableau.rdv_du_jour", "accueil.attendues", "accueil.encore_a_venir", "accueil.ca_prevu", "tableau.stock_bas"]) {
    assert.match(vue, new RegExp(`libelle=\\{t\\("${key.replace(".", "\\.")}"\\)\\}`), key);
  }
  assert.match(vue, /\{stats\.low_stock_products > 0 && \(\s*<ChiffreCle valeur=\{stats\.low_stock_products\} libelle=\{t\("tableau\.stock_bas"\)\} alerte/);
});

test("compteurs de l'ancien menu repris : clientes et rendez-vous à venir, qui mènent à leur liste", () => {
  assert.match(vue, /\{stats\.clients\}<\/span> <span className="etiquette text-encre-grise">\{t\("menu\.clientes"\)\}/);
  assert.match(vue, /\{stats\.upcoming_appointments\}<\/span> <span className="etiquette text-encre-grise">\{t\("accueil\.rdv_a_venir"\)\}/);
  assert.match(vue, /navigate\(pathFor\("clients", lang\)\)/);
  assert.match(vue, /navigate\(pathFor\("appointments", lang\)\)/);
});

test("liste du jour : toucher ouvre la fiche, geste suivant du § 4.3 pour les rôles qui changent le statut", () => {
  assert.match(vue, /const groups = todayGroups\(range\.appointments, clock\.day, clock\.time\);/);
  assert.match(vue, /onOpen=\{\(\) => openPanel\("appointment", apt\.id\)\}/);
  assert.match(vue, /onStep=\{commands\.changeStatus \? \(to\) => step\(apt, to\) : null\}/);
  assert.match(vue, /const step = onStep \? nextStep\(apt\.status\) : null;/);
  assert.match(vue, /\{t\(step\.labelKey\)\}/);
  // « En retard » : même règle que l'agenda (blockTone, awaitingArrival), en vrai badge de cuir.
  assert.match(vue, /blockTone\(apt, today, now\) === "retard"\s*\? <RetardBadge \/>/);
});

test("double appui et réseau coupé : le bouton du geste est inactif pendant l'enregistrement, l'échec est dit", () => {
  assert.match(vue, /disabled=\{saving\} onClick=\{\(\) => onStep\(step\.to\)\}/);
  assert.match(vue, /saving=\{saving === apt\.id\}/);
  assert.match(vue, /setSaving\(apt\.id\);[\s\S]*?finally \{\s*setSaving\(null\);/);
  assert.match(vue, /setError\(clashes \? conflictSentence\(lang, apt\.staff_name \?\? "", clashes\) : \(err as Error\)\.message\);/);
  assert.match(vue, /range\.error && !range\.loaded \? <EtatErreur message=\{range\.error\} onRetry=\{range\.reload\} \/>/);
});

test("lignes denses : chaque ligne garde son filet bas, sauf la dernière (même défaut que les listes de la vague 4)", () => {
  const ul = vue.match(/<ul aria-label=\{t\(labelKey\)\} className="([^"]*)"/)?.[1] ?? "";
  assert.doesNotMatch(ul, /divide-/, "divide-y (spécificité nulle) était écrasé par @2xl:border-0 de la ligne");
  const li = vue.match(/<li className="(flex min-w-0 flex-col gap-2 rounded-sm[^"]*)"/)?.[1] ?? "";
  const classes = li.split(/\s+/);
  for (const cls of ["border", "border-filet", "@2xl:border-x-0", "@2xl:border-t-0", "@2xl:last:border-b-0"]) assert.ok(classes.includes(cls), cls);
  assert.ok(!classes.includes("@2xl:border-0"), "@2xl:border-0 effaçait le filet bas");
});

test("cartes sur téléphone, lignes denses à partir de 42 rem de large (conteneur, panneau posé compris) ; jamais de colonne hors de l'écran", () => {
  assert.match(vue, /<li className="flex min-w-0 flex-col gap-2 rounded-sm border border-filet bg-card p-3 @2xl:flex-row @2xl:items-center/);
  assert.match(vue, /<ul aria-label=\{t\(labelKey\)\} className="flex min-w-0 flex-col gap-2 @2xl:gap-0 @2xl:rounded-sm @2xl:border @2xl:border-filet @2xl:bg-card">/);
  // Liste de moins de 56 rem (tablette en portrait) : la praticienne passe sous le nom, les noms ne sont plus coupés.
  assert.match(vue, /text-muted-foreground @4xl:hidden">\{praticienne\}<\/span>/);
  assert.match(vue, /hidden min-w-0 items-center gap-1\.5 text-sm text-muted-foreground @4xl:flex @4xl:w-40 @4xl:shrink-0">\{praticienne\}<\/span>/);
  // Sans geste (terminé, absente), la place du bouton est gardée : statuts alignés d'une ligne à l'autre.
  assert.match(vue, /<span className="hidden @2xl:block @2xl:w-32 @2xl:shrink-0" aria-hidden="true" \/>/);
});

// Constat du 29/09/2026 : la liste basculait selon la largeur de l'écran (md:), pas la largeur
// réelle du conteneur ; à 820 px avec le panneau posé, la liste n'a plus qu'environ 350 px et
// devait rester en carte. La liste se met en page selon sa largeur réelle, panneau posé compris.
test("la liste se met en page selon sa largeur réelle, panneau posé compris : aucune variante md: dans Ligne ni dans la classe de la liste", () => {
  const debutLigne = vue.indexOf("function Ligne(");
  const finLigne = vue.indexOf("\n}", debutLigne);
  const corpsLigne = vue.slice(debutLigne, finLigne);
  assert.doesNotMatch(corpsLigne, /\bmd:/, "la fonction Ligne ne doit plus dépendre de la largeur de l'écran");
  const ulMatch = vue.match(/<ul aria-label=\{t\(labelKey\)\} className="([^"]*)">/);
  assert.ok(ulMatch, "la classe de la liste doit être trouvée");
  assert.doesNotMatch(ulMatch[1], /\bmd:/, "la classe du <ul> de la liste ne doit plus dépendre de la largeur de l'écran");
});

test("gérante : les chiffres de la semaine, tirés des rendez-vous de la semaine (aucun calcul serveur nouveau)", () => {
  assert.match(vue, /\{account\.role === "manager" && <Semaine day=\{clock\.day\} \/>\}/);
  assert.match(vue, /const week = useCalendarRange\(weekBounds\(day\)\);/);
  assert.match(vue, /const figures = weekFigures\(week\.appointments\);/);
});

test("nouveau rendez-vous : bouton cuir à partir de 768 px (le « + » le fait au téléphone), pour les rôles qui en créent", () => {
  assert.match(vue, /\{commands\.create && \(wide \|\| embedded\) && \(/);
  assert.match(vue, /<CreateAppointment defaultDate=\{clock\.day\}/);
});

// Relecture finale, constat 2 (mineur) : le bandeau d'erreur de rechargement n'était rendu que
// dans la branche non vide ; sur une journée vide, un rechargement en échec ne disait rien.
test("liste vide et rechargement en échec : l'erreur est dite, pas seulement « aucun rendez-vous »", () => {
  const debut = vue.indexOf('h2 className="etiquette text-encre-grise">{t("tableau.planning")}');
  const section = vue.slice(debut, vue.indexOf("</section>", debut));
  const erreurIdx = section.indexOf("{range.error && <EtatErreur message={range.error} onRetry={range.reload} />}");
  const videIdx = section.indexOf("tableau.aucun_rdv");
  assert.match(section, /figures\.total === 0 \?/, "journée vide : aucun rendez-vous du jour, annulés exclus");
  assert.notEqual(erreurIdx, -1, "le bandeau d'erreur doit être rendu même si la liste est vide");
  assert.ok(erreurIdx < videIdx, "le bandeau d'erreur doit précéder l'état vide, pas être limité à la liste non vide");
  assert.equal(section.split("range.error && <EtatErreur").length - 1, 1, "un seul bandeau d'erreur partagé, pas un doublon limité à la liste non vide");
});

// Défaut constaté dans le navigateur (constat 4) : « IN PROGRESS » passait sur deux lignes à
// 1180 px dans une colonne de 112 px (md:w-28) ; élargie pour tenir sur une ligne dans les deux langues.
test("colonne du statut assez large pour « IN PROGRESS » sur une ligne, alignée d'une ligne à l'autre", () => {
  assert.match(vue, /<span className="hidden @2xl:block @2xl:w-36 @2xl:shrink-0 whitespace-nowrap">\{etat\}<\/span>/);
});

// Défaut constaté dans le navigateur (constat 5) : seul l'en-tête portait hors-panneau, si bien
// que les chiffres clés et la liste passaient sous le panneau posé entre 768 et 1279 px.
test("contenu sous le panneau posé (768 à 1279 px) : le conteneur racine s'arrête à son bord, pas seulement l'en-tête", () => {
  assert.match(vue, /<div className="hors-panneau @container flex flex-col gap-6 p-4 sm:p-6">/);
  assert.doesNotMatch(vue, /<header className="hors-panneau/, "hors-panneau doit être sur le conteneur racine, pas seulement sur l'en-tête");
});

// Décisions produit (29/09/2026) sur la critique de l'accueil.
test("liste du jour en trois groupes, dans cet ordre : à traiter, à venir, terminés ; groupe vide masqué", () => {
  const groupes = vue.slice(vue.indexOf("const GROUPES"), vue.indexOf("\n", vue.indexOf("const GROUPES") + 200));
  assert.ok(vue.indexOf('"accueil.groupe_a_traiter"') < vue.indexOf('"accueil.groupe_a_venir"'));
  assert.ok(vue.indexOf('"accueil.groupe_a_venir"') < vue.indexOf('"accueil.groupe_termines"'));
  assert.ok(groupes.length > 0);
  assert.match(vue, /list\.length > 0 &&/);
  // Terminés et absentes grisés.
  assert.match(vue, /estompe && "text-muted-foreground"/);
});

// Retouche 3 (critique du 30/09/2026) : la ligne « À encaisser » demande un geste, elle n'est
// jamais estompée comme une ligne terminée (heure et nom en encre pleine, nom en medium).
test("retouche 3 : une ligne à encaisser n'est pas estompée comme une ligne terminée", () => {
  assert.match(vue, /const estompe = done && !onCash;/);
  assert.match(vue, /FOCUS, estompe && "text-muted-foreground"\)/);
  assert.match(vue, /cn\("block truncate", !estompe && "font-medium"\)/);
  assert.doesNotMatch(vue, /\bdone && "text-muted-foreground"|!done && "font-medium"/);
});

test("« À venir, toutes dates » : le compteur de l'ancien menu dit qu'il ne se limite pas au jour", () => {
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"accueil\.rdv_a_venir": "À venir, toutes dates"/);
  assert.match(en, /"accueil\.rdv_a_venir": "Upcoming, all dates"/);
});

test("semaine de la gérante sous les chiffres du jour dès 42 rem de large (tablette, ordinateur), en bas sur téléphone", () => {
  const semaine = vue.indexOf("<Semaine day={clock.day} />");
  assert.ok(semaine > vue.indexOf("accueil.rdv_a_venir") && semaine < vue.indexOf('{t("tableau.planning")}'), "juste après les chiffres du jour dans le document");
  assert.match(vue, /<section className="order-last space-y-2 @2xl:order-none">/);
});

test("compteur « Demandes en ligne » : montré dès que la réservation en ligne est activée ou qu'une demande attend, mène à l'écran", () => {
  assert.match(vue, /useLoad\(\(\) => api<\{ active: boolean; a_traiter: number \}>\("GET", "\/api\/demandes-en-ligne\/compte"\), \["demandes"\]\)/);
  assert.match(vue, /enLigne\.data && \(enLigne\.data\.active \|\| enLigne\.data\.a_traiter > 0\)/);
  assert.match(vue, /libelle=\{tn\("accueil\.demandes_en_ligne", enLigne\.data\.a_traiter\)\} alerte=\{enLigne\.data\.a_traiter > 0\} onClick=\{\(\) => navigate\(pathFor\("demandes", lang\)\)\}/);
});

test("compteur « Demandes en ligne » : libellé accordé au nombre, en français et en anglais", () => {
  assert.equal(translatePlural("fr", "accueil.demandes_en_ligne", 1), "Demande en ligne");
  assert.equal(translatePlural("fr", "accueil.demandes_en_ligne", 2), "Demandes en ligne");
  assert.equal(translatePlural("en", "accueil.demandes_en_ligne", 1), "Online request");
  assert.equal(translatePlural("en", "accueil.demandes_en_ligne", 0), "Online requests");
});
