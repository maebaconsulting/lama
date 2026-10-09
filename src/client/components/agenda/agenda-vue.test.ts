import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Écran de l'agenda (sous-projet 4 § 4.1 et § 4.2) : commandes selon le rôle,
 * heure de Douala, une praticienne à la fois sur téléphone.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const vue = read("../calendar-view.tsx");
const pastilles = read("./pastilles.tsx");

test("agenda : commandes selon le rôle, « Nouveau rendez-vous » dans la barre à partir de 768 px (le « + » sur téléphone)", () => {
  assert.match(vue, /const commands = appointmentCommands\(account\.role\);/);
  const bloquer = vue.indexOf('{t("agenda.bloquer")}');
  assert.match(vue.slice(bloquer - 400, bloquer), /\{commands\.block && \(/);
  // Revue impeccable (G6) : le blocage s'ouvre dans une fenêtre, rien ne s'insère dans l'agenda.
  assert.match(vue, /\{commands\.block && showBlockForm && <BloquerCreneau day=\{calendarDate\} onClose=\{\(\) => setShowBlockForm\(false\)\} \/>\}/);
  const nouveau = vue.indexOf('{t("agenda.nouveau_rdv")}');
  // Mode intégré : pas de « + » du cadre, le bouton de la barre reste donc sur écran étroit.
  assert.match(vue.slice(nouveau - 300, nouveau), /\{commands\.create && \(wide \|\| embedded\) && \(/);
  assert.match(vue, /import \{ embedded \} from "@clawnify\/app\/client";/);
  assert.match(vue, /const onSlot = commands\.create \? \(column: AgendaColumn, time: string\) => setCreate\(\{ staffId: column\.staffId, time \}\) : null;/);
  assert.match(vue, /defaultStaffId=\{create\.staffId\}\s+defaultTime=\{create\.time\}/);
});

test("agenda : jour et heure de Douala, relus chaque minute, « Aujourd'hui » y revient", () => {
  assert.match(vue, /setClock\(\{ day: todayAt\(\), time: timeAt\(\) \}\), MINUTE_MS\)/);
  assert.match(vue, /onClick=\{\(\) => chooseDate\(clock\.day\)\}/);
});

test("téléphone : une praticienne à la fois, pastilles, glissement latéral", () => {
  assert.match(vue, /const visible = wide \? columns : columns\.filter\(\(c\) => c\.key === shown\);/);
  assert.match(vue, /shownColumnKey\(chosen, columns, defaultColumnKey\(account\.role, account\.staff_id, columns, counts\)\)/);
  assert.match(vue, /\{!wide && columns\.length > 0 && <Pastilles /);
  assert.match(vue, /const step = swipeStep\(point\.clientX - start\.x, point\.clientY - start\.y\);/);
  assert.match(vue, /if \(step !== 0\) setChosen\(neighborColumn\(columns, shown, step\)\);/);
  assert.match(pastilles, /aria-pressed=\{active\}/);
  assert.match(pastilles, /min-h-11/, "pastilles de 44 px");
  assert.doesNotMatch(pastilles, /rounded-full/, "angles de la charte (1 px), revue impeccable D3");
  assert.match(pastilles, /tn\("commun\.nb_rdv", count\)/);
});

// Tâche 10 (vérification dans le navigateur) : à 820 px avec le panneau ouvert, l'agenda n'a
// plus que 350 px ; la date gardait 14rem et « Aujourd'hui » sortait sous le panneau. La barre
// suit la largeur réelle de l'agenda (`@container`), pas celle de l'écran.
test("agenda : barre du jour selon la largeur de l'agenda, « Aujourd'hui » jamais coupé par le panneau", () => {
  assert.match(vue, /<div className="@container flex h-full min-w-0 flex-col gap-3 p-4 sm:p-6">/);
  // Largeur fixe de la date seulement pour un agenda large (48 rem et plus) : panneau posé à 820 px,
  // la barre n'a que 348 px et la date passe sur deux lignes au lieu de rogner « Aujourd'hui ».
  assert.match(vue, /@3xl:min-w-\[14rem\]/);
  assert.doesNotMatch(vue, /[^@]md:hidden|[^@]md:inline-flex|min-w-\[14rem\](?<!@3xl:min-w-\[14rem\])/);
  // Revue impeccable (E1, F1) : un seul « Aujourd'hui », sur la ligne de la date, inactif le jour même ;
  // titre gardé pour les lecteurs d'écran mais masqué au téléphone (l'onglet actif le dit déjà).
  assert.equal(vue.match(/chooseDate\(clock\.day\)/g)?.length, 1);
  assert.match(vue, /disabled=\{calendarDate === clock\.day\} onClick=\{\(\) => chooseDate\(clock\.day\)\}/);
  assert.match(vue, /<h1 className="sr-only [^"]*md:not-sr-only/);
  // Revue impeccable (B2) : les boutons passent à la ligne au lieu d'être coupés.
  assert.match(vue, /md:flex md:w-auto md:flex-wrap/);
});
