import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Grille de l'agenda (sous-projet 4 § 4.1) : câblage sur les règles de
 * `lib/agenda.ts` (testées en exécution dans `lib/agenda.test.ts`).
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const grille = read("./grille.tsx");

test("grille : noms collés en haut, heures collées à gauche, défilement dans la grille seulement", () => {
  // Heures (z-50) et noms (z-40) au-dessus des blocs (z-20) et de la ligne « maintenant » (z-30).
  assert.match(grille, /className="sticky left-0 z-50 w-14 shrink-0 border-r border-filet bg-card"/);
  assert.match(grille, /className="sticky top-0 z-40 flex h-11 items-center justify-center gap-2 border-b border-filet bg-card px-3"/);
  assert.match(grille, /className="isolate min-h-80 min-w-0 flex-1 overflow-auto rounded-sm border border-filet bg-card"/, "la page ne défile jamais de côté");
  assert.match(grille, /showHeaders && "min-w-\[11rem\]"/, "colonnes de 176 px au moins à partir de 768 px");
});

test("grille : ligne « maintenant » le jour même seulement, défilement jusqu'à l'heure courante à l'ouverture du jour", () => {
  assert.match(grille, /const nowTop = day === today \? nowLineTop\(now\) : null;/);
  assert.match(grille, /scroller\.current\.scrollTop = initialScrollTop\(day, today, now, HOUR_HEIGHT_PX, ongoing\);\s*\}, \[day\]\);/);
  // Soin en cours du jour, dans les colonnes montrées : son début reste en vue (revue impeccable, E2).
  assert.match(grille, /a\.scheduled_date === day && a\.status === "in_progress" && columns\.some\(\(c\) => inColumn\(c, a\.staff_id\)\)/);
  // Revue impeccable (D1) : trait cuir et repère carré, jamais l'encre rouge (réservée à la perte, au refus, au conflit).
  assert.match(grille, /pointer-events-none absolute left-0 right-0 z-30 border-t border-foreground/);
  assert.doesNotMatch(grille, /border-encre-rouge|bg-encre-rouge|rounded-full/);
});

test("grille : seul le fond d'une colonne est un créneau vide, l'heure vient de la grille de 15 minutes", () => {
  assert.match(grille, /if \(e\.target !== e\.currentTarget\) return;/);
  assert.match(grille, /onSlot\(column, slotAt\(e\.clientY - rect\.top\)\);/);
  assert.match(grille, /pointer-events-none absolute left-0 right-0 border-t border-dashed/, "les filets des heures laissent passer le toucher");
  // Appartenance à une colonne : la règle de `lib/agenda.ts`, pas une copie.
  assert.match(grille, /appointments\.filter\(\(a\) => inColumn\(column, a\.staff_id\)\)/);
  assert.match(grille, /blocked\.filter\(\(b\) => inColumn\(column, b\.staff_id\)\)/);
  assert.doesNotMatch(grille, /column\.staffId === null \?/);
});

test("grille : bloc d'un rendez-vous, vrai bouton (clavier), focus visible, heure, cliente, prestation, statut, liseré", () => {
  const bloc = grille.slice(grille.indexOf("const apt = item.appointment!;"), grille.indexOf("{nowTop !== null"));
  assert.match(bloc, /<button\s+key=\{item\.key\}\s+type="button"/);
  assert.match(bloc, /focus-visible:outline focus-visible:outline-2/);
  assert.match(bloc, /column\.color \? "encre-lisere" : "border-l-encre-grise"/);
  assert.match(bloc, /aria-label=\{t\(blockLabelKey\(tone === "retard", apt\.client_name\), \{ plage, cliente: apt\.client_name \?\? "", statut \}\)\}/);
  assert.match(bloc, /\{plage\}<\/span> · \{etat\}/);
  // Revue impeccable (A1 à A3) : statut à l'encre de son statut, passé estompé sur l'ivoire,
  // cliente attendue « En retard » en cuir, bloc de la fiche ouverte entouré de cuir.
  assert.match(bloc, /const tone = blockTone\(apt, today, now\);/);
  assert.match(bloc, /<span className="encre" style=\{encreVars\(statusInk\(apt\.status\)\)\}>\{statut\}<\/span>/);
  assert.match(bloc, /tone === "passe" \? "border-filet bg-muted text-muted-foreground"/);
  assert.match(bloc, /\{t\("agenda\.en_retard"\)\}/);
  assert.match(bloc, /aria-current=\{open \? "true" : undefined\}/);
  assert.match(bloc, /open && "z-30 border-foreground outline outline-1 outline-foreground"/);
  assert.doesNotMatch(bloc, /text-\[11px\]/, "échelle de la charte : 12 px au plus petit");
  assert.match(bloc, /\{services && lines === 3 &&/);
  assert.match(bloc, /onClick=\{\(\) => openPanel\("appointment", apt\.id\)\}/);
});

test("grille : « Retirer ce créneau bloqué » seulement pour les rôles qui peuvent bloquer", () => {
  const at = grille.indexOf('aria-label={t("agenda.retirer_blocage")}');
  assert.match(grille.slice(at - 400, at), /\{canUnblock && \(/);
});

// Tâche 10 (vérification dans le navigateur) : sur téléphone, la colonne des heures (z-50)
// passait par-dessus le panneau plein écran (z-40). La grille isole ses z-index.
test("grille : ses z-index restent dedans, le panneau plein écran la couvre entièrement", () => {
  assert.match(grille, /role="region"/);
  assert.match(grille, /className="isolate [^"]*overflow-auto/);
});

// Tâche 10 : un rendez-vous de 15 min (28 px) coupait le nom de la cliente, un de 45 min la
// prestation. Le bloc n'écrit que les lignes qui tiennent (`blockLines`, lib/agenda.ts).
test("grille : bloc sur une, deux ou trois lignes selon sa hauteur, jamais une ligne coupée", () => {
  const bloc = grille.slice(grille.indexOf("const apt = item.appointment!;"), grille.indexOf("{nowTop !== null"));
  assert.match(bloc, /const height = Math\.max\(size, 28\);/);
  assert.match(bloc, /const lines = blockLines\(height\);/);
  assert.match(bloc, /lines === 1 \?/);
  assert.match(bloc, /\{services && lines === 3 &&/);
  assert.doesNotMatch(bloc, /size > 44/);
});

// Relecture finale (point 3) : le statut reste sur chaque bloc (§ 4.1), même court. Revue
// impeccable (A4) : la cliente passe avant l'heure, qui ne s'affiche que si les trois tiennent.
test("grille : bloc court sur une ligne, statut toujours montré, jamais coupé", () => {
  const court = grille.indexOf("{lines === 1 ?");
  const bloc = grille.slice(court, grille.indexOf(") : (", court));
  assert.match(bloc, /className="flex min-w-0 items-baseline gap-1 text-xs"/);
  assert.match(bloc, /className="chiffres hidden shrink-0 text-muted-foreground @\[12rem\]:inline">\{apt\.start_time\.slice\(0, 5\)\}<\/span>/);
  assert.match(bloc, /<span className=\{cn\("min-w-0 truncate", tone !== "passe" && "font-semibold"\)\}>\{apt\.client_name\}<\/span>/);
  assert.match(bloc, /<span className="shrink-0 whitespace-nowrap">· \{etat\}<\/span>/);
  const button = grille.slice(grille.indexOf("const apt = item.appointment!;"), grille.indexOf("{lines === 1 ?"));
  assert.match(button, /"@container absolute z-20 overflow-hidden/, "le bloc mesure sa propre largeur");
});

// Relecture finale (point 5) : un retrait de créneau bloqué refusé ou coupé par le réseau le dit.
test("grille : l'échec du retrait d'un créneau bloqué remonte dans le bandeau d'erreur", () => {
  assert.match(grille, /deleteBlockedSlot\(aRetirer\.id\)\.catch\(\(err: Error\) => setError\(err\.message\)\)/);
  assert.match(grille, /const \{ openPanel, deleteBlockedSlot, setError, selectedAppointment \} = useApp\(\);/);
});

test("heures fermées grisées sous les rendez-vous, sans bloquer le toucher d'un créneau", () => {
  assert.match(grille, /fermees\(column\)\.map\(/);
  assert.match(grille, /pointer-events-none absolute left-0 right-0 bg-muted/);
  const vue = read("../calendar-view.tsx");
  assert.match(vue, /api<\{ institut: Semaine \}>\("GET", "\/api\/horaires"\)/);
  assert.match(vue, /heuresFermees\(/);
});

test("grille : demandes en ligne à confirmer hachurées dans la colonne de la praticienne retenue ; « Réservé » pour la praticienne", () => {
  assert.match(grille, /demandes\.filter\(\(d\) => inColumn\(column, d\.staff_id\)\)/);
  const bloc = grille.slice(grille.indexOf("if (item.demande) {"), grille.indexOf("const apt = item.appointment!;"));
  assert.match(bloc, /className="hachure absolute z-20/);
  assert.match(bloc, /\{t\("agenda\.en_ligne_a_confirmer"\)\}/);
  assert.match(bloc, /d\.sans_preference \? ` · \$\{t\("agenda\.a_attribuer"\)\}` : ""/);
  assert.match(bloc, /\{t\("agenda\.reserve"\)\}/);
  assert.match(bloc, /onClick=\{onDemande\}/);
  assert.match(readFileSync(new URL("../../styles.css", import.meta.url), "utf8"), /\.hachure \{[^}]*repeating-linear-gradient/);
});

test("carte hachurée courte (demande de 30 min) : une seule ligne, comme un rendez-vous de même durée", () => {
  const bloc = grille.slice(grille.indexOf("if (item.demande) {"), grille.indexOf("const apt = item.appointment!;"));
  assert.match(bloc, /const lignes = blockLines\(hauteur\);/, "même règle que les rendez-vous");
  assert.match(bloc, /lignes === 1 \? \(/);
  assert.match(bloc, /<span className="min-w-0 truncate font-medium">\{d\.cliente_nom\}/, "la cliente d'abord");
  assert.match(bloc, /<span className="shrink-0 whitespace-nowrap">· \{t\("agenda\.en_ligne_a_confirmer"\)\}<\/span>/, "l'état jamais coupé");
});

test("agenda : demandes en ligne demandées une fois par jour affiché, réponse d'un autre jour ignorée", () => {
  const vue = read("../calendar-view.tsx");
  assert.doesNotMatch(vue, /useEffect\(\(\) => \{ void enLigne\.reload\(\); \}, \[calendarDate\]\)/, "plus de double requête au montage");
  assert.match(vue, /if \(date === jourAffiche\.current\) setEnLigne\(\{ date, demandes: r\.demandes \}\);/);
  assert.match(vue, /demandes=\{enLigne\?\.date === calendarDate \? enLigne\.demandes : \[\]\}/);
  assert.match(vue, /useRefresh\(\["demandes", "calendar"\]/);
});
