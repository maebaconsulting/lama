import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Fiche d'un rendez-vous (sous-projet 4 § 4.3), câblée sur les règles de
 * `lib/fiche-rdv.ts` et `appointmentCommands` (testées en exécution dans
 * `lib/fiche-rdv.test.ts`). Remplace le garde-fou D1 de l'ancien en-tête.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const fiche = read("./appointment-detail.tsx");

test("en-tête : cliente en grand (lien vers sa fiche, 44 px), numéro APT jamais coupé, badge de statut, passage à la ligne", () => {
  // Revue impeccable : 44 px de haut avec ou sans « … », l'en-tête ne bouge pas d'un rôle à l'autre.
  assert.match(fiche, /<div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2">\s*<span className="chiffres whitespace-nowrap text-sm text-muted-foreground">\{apt\.identifier\}<\/span>\s*<StatusBadge status=\{apt\.status\} \/>/);
  assert.match(fiche, /className="flex min-h-11 max-w-full items-center break-words text-left font-serif text-3xl leading-tight hover:underline/);
  // Relecture finale : ouvre la fiche cliente dans le panneau (ne quitte pas l'agenda).
  assert.match(fiche, /onClick=\{\(\) => openPanel\("client", apt\.client_id\)\}/);
  assert.match(fiche, /className="space-y-5 p-4 sm:p-6"/);
});

test("geste suivant en gros bouton cuir, « Autre statut » avec confirmation pour Annuler et Absente", () => {
  assert.match(fiche, /\{commands\.changeStatus && step && \(\s*<Button size="lg" className="w-full" disabled=\{saving\} onClick=\{\(\) => changeStatus\(step\.to\)\}>\s*\{t\(step\.labelKey\)\}/);
  // Revue impeccable (C2, C4, G7) : choix en grille de deux, Annulé et Absente au trait rouge ;
  // leur confirmation remplace les choix, avec « Revenir » et le geste nommé en aplat rouge.
  assert.match(fiche, /variant=\{needsConfirmation\(status\) \? "trait-rouge" : "outline"\}/);
  assert.match(fiche, /onClick=\{\(\) => \(needsConfirmation\(status\) \? setPending\(status\) : changeStatus\(status\)\)\}/);
  assert.match(fiche, /\{pending \? \(/);
  assert.match(fiche, /\{t\("rdv\.confirmer_statut", \{ statut: statusLabel\(lang, pending\) \}\)\}/);
  assert.match(fiche, /<Button data-revenir="" variant="outline"[^>]*onClick=\{\(\) => setPending\(null\)\}>\{t\("commun\.revenir"\)\}/);
  assert.match(fiche, /<Button variant="destructive" className=\{ACTION\} disabled=\{saving\} onClick=\{\(\) => changeStatus\(pending\)\}>\s*\{t\("rdv\.passer_a"/);
  assert.match(fiche, /aria-expanded=\{showOther\} aria-controls="rdv-autres-statuts"/);
});

test("Appeler (tel:) seulement s'il existe un numéro, Déplacer ouvre le déplacement existant", () => {
  assert.match(fiche, /const call = telHref\(apt\.client_phone\);/);
  assert.match(fiche, /\{call && \(\s*<a href=\{call\}/);
  assert.match(fiche, /\{commands\.move && \(\s*<Button variant="outline" className=\{ACTION\} onClick=\{\(\) => setRescheduling\(true\)\}>\{t\("rdv\.deplacer"\)\}<\/Button>/);
  // Revue impeccable (C3) : une seule rangée, autant de colonnes que de boutons montrés.
  assert.match(fiche, /ACTION_COLUMNS\[\[commands\.changeStatus, Boolean\(call\), commands\.move\]\.filter\(Boolean\)\.length\]/);
  assert.match(fiche, /<RescheduleAppointment key=\{`deplacer-\$\{apt\.id\}`\} appointment=\{apt\}/);
});

test("Supprimer dans le menu « … », avec confirmation", () => {
  // Revue impeccable (C1) : vrai menu ancré au bouton, rien ne s'insère dans la fiche ; la
  // suppression se confirme dans une fenêtre d'alerte, « Revenir » à gauche.
  assert.match(fiche, /<DropdownMenu modal=\{false\}>/);
  assert.match(fiche, /aria-label=\{t\("rdv\.plus_actions"\)\}/);
  assert.match(fiche, /onSelect=\{\(\) => setConfirmDelete\(true\)\}/);
  // Correctif final (point 1) : une facture émise (même entièrement reprise par un avoir) masque toujours « Supprimer ».
  assert.match(fiche, /\{commands\.remove && !apt\.invoiced && \(/);
  assert.doesNotMatch(fiche, /commands\.remove && !apt\.paid && \(/);
  assert.match(fiche, /\{commands\.remove && confirmDelete && \(\s*<Dialog open/);
  assert.match(fiche, /<DialogContent compact role="alertdialog" onCloseAutoFocus=\{\(event: Event\) => \{ event\.preventDefault\(\); moreButton\.current\?\.focus\(\); \}\}>/, "carte centrée même au téléphone ; focus rendu à « … »");
  assert.doesNotMatch(fiche, /rdv-plus-actions|BoutonDestructif/);
});

test("corps : notes les plus récentes d'abord ; champ de note en bas, brouillon protégé d'Échap, gardé si l'envoi échoue", () => {
  assert.match(fiche, /const notes = newestFirst\(apt\.appointment_notes\);/);
  assert.ok(fiche.indexOf("<dl") < fiche.indexOf('<form className="flex gap-2 border-t border-filet pt-4"'), "champ de note après le corps");
  assert.match(fiche, /<Input\s+data-brouillon=""/);
  assert.match(fiche, /setNoteText\(""\);\s*\} catch \(err\) \{/);
  // D3 : brouillon gardé par rendez-vous hors du composant (changer de bloc ou d'écran ne le perd pas).
  assert.match(fiche, /^const drafts = new Map<number, string>\(\);$/m);
  assert.match(fiche, /const noteText = draftFor\(drafts, apt\.id\);/);
  assert.match(fiche, /keepDraft\(drafts, apt\.id, text\);/);
  assert.doesNotMatch(fiche, /localStorage/);
});

test("double appui : gros bouton, « Autre statut » et envoi de note inactifs pendant l'enregistrement", () => {
  const autres = fiche.slice(fiche.indexOf("otherStatuses(apt.status).map"), fiche.indexOf("</div>", fiche.indexOf("otherStatuses(apt.status).map")));
  assert.match(autres, /<Button\s+key=\{status\}[^>]*?disabled=\{saving\}/s, "choix des statuts");
  assert.match(fiche, /onClick=\{\(\) => changeStatus\(pending\)\}/);
  assert.match(fiche, /variant="destructive" className=\{ACTION\} disabled=\{saving\}/, "geste confirmé");
  assert.match(fiche, /setSending\(true\);[\s\S]*?finally \{\s*setSending\(false\);/);
  assert.match(fiche, /<Button type="submit" variant="outline" size="icon" disabled=\{sending \|\| !noteText\.trim\(\)\}/);
  assert.match(fiche, /if \(sending \|\| !text\.trim\(\)\) return;/);
});

test("droits inchangés : la praticienne lit et ajoute une note ; statut, déplacement, suppression masqués", () => {
  assert.match(fiche, /const commands = appointmentCommands\(account\.role\);/);
  for (const [commande, garde] of [
    ["changeStatus(step.to)", "commands.changeStatus"],
    ["setShowOther(!showOther)", "commands.changeStatus"],
    ["setRescheduling(true)", "commands.move"],
    ["setConfirmDelete(true)", "commands.remove"],
    ["deleteAppointment(apt.id)", "commands.remove"],
    ["setNoteASupprimer({ id: note.id", "commands.deleteNote"],
    ["deleteAppointmentNote(noteASupprimer.id)", "commands.deleteNote"],
    ["onSubmit={handleAddNote}", "commands.addNote"],
  ]) {
    const at = fiche.indexOf(commande);
    assert.ok(at > 0, commande);
    assert.ok(fiche.slice(Math.max(0, at - 1100), at).includes(`{${garde} &&`), `${commande} : garde ${garde} absente`);
  }
  assert.doesNotMatch(fiche, /<select/, "plus de listes de statut ou de praticienne dans la fiche");
});

// Tâche 10 : tablette partagée. Verrouiller, se déconnecter ou la mise en veille démontent
// l'app (écran du poste ou de connexion) : les brouillons de note sont oubliés à ce moment,
// la personne suivante ne voit jamais la note en cours de la précédente.
test("brouillons de note oubliés quand l'app se démonte (Verrouiller, déconnexion, veille)", () => {
  assert.match(fiche, /export function clearNoteDrafts\(\): void \{\s*drafts\.clear\(\);\s*\}/);
  const app = read("../app.tsx");
  assert.match(app, /import \{ AppointmentDetail, clearNoteDrafts \} from "\.\/components\/appointment-detail";/);
  assert.match(app, /useEffect\(\(\) => clearNoteDrafts, \[\]\);/, "nettoyage au démontage de l'app");
});

// Relecture finale (point 4) : une suppression de note refusée ou coupée par le réseau le dit.
test("l'échec de la suppression d'une note remonte dans le bandeau d'erreur", () => {
  assert.match(fiche, /onConfirm=\{\(\) => deleteAppointmentNote\(noteASupprimer\.id\)\.catch\(\(err: Error\) => setError\(err\.message\)\)\}/);
});

test("fiche du rendez-vous : mention « En ligne » pour un rendez-vous venu d'une demande", () => {
  const fiche = readFileSync(new URL("./appointment-detail.tsx", import.meta.url), "utf8");
  assert.match(fiche, /\{Boolean\(apt\.en_ligne\) && <span className="etiquette text-encre-grise">\{t\("rdv\.en_ligne"\)\}<\/span>\}/);
});
