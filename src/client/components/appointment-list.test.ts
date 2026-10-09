import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Liste des rendez-vous (reports de la vague 1) : commandes refusées à la
 * praticienne masquées, lignes atteignables et activables au clavier.
 *
 * Ruling D5 (contrôle préalable) : source unique des droits = `appointmentCommands`
 * (lib de la tâche 2), pas `canManageAppointments` ; deux gardes distinctes,
 * `commands.create` et `commands.remove`.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liste = read("./appointment-list.tsx");

test("praticienne : ni « Nouveau rendez-vous » ni « Supprimer » (le serveur les lui refuse)", () => {
  assert.match(liste, /const commands = appointmentCommands\(account\.role\);/);
  assert.doesNotMatch(liste, /canManageAppointments/, "D5 : source unique appointmentCommands, pas canManageAppointments");

  let at = liste.indexOf("setShowCreate(true)");
  assert.ok(at > 0, "setShowCreate(true)");
  while (at > 0) {
    assert.match(liste.slice(Math.max(0, at - 700), at), /\{commands\.create && /, "setShowCreate(true) : garde par commands.create absente");
    at = liste.indexOf("setShowCreate(true)", at + 1);
  }

  let at2 = liste.indexOf("setASupprimer(apt)");
  assert.ok(at2 > 0, "setASupprimer(apt)");
  while (at2 > 0) {
    assert.match(liste.slice(Math.max(0, at2 - 700), at2), /\{commands\.remove && /, "setASupprimer(apt) : garde par commands.remove absente");
    at2 = liste.indexOf("setASupprimer(apt)", at2 + 1);
  }
});

test("tableau : chaque ligne s'ouvre par un vrai bouton (Tab, Entrée, Espace), focus visible, 44 px", () => {
  const bouton = liste.match(/<button\s+type="button"\s+aria-label=\{t\("rdv\.ouvrir", \{ ref: apt\.identifier, cliente: apt\.client_name \?\? "" \}\)\}\s+className="([^"]*)"\s+onClick=\{\(e: Event\) => \{ e\.stopPropagation\(\); openPanel\("appointment", apt\.id\); \}\}/);
  assert.ok(bouton, "bouton d'ouverture de la ligne introuvable");
  for (const cls of ["min-h-11", "focus-visible:outline", "focus-visible:outline-ring"]) assert.ok(bouton![1].split(/\s+/).includes(cls), cls);
});

test("cartes du téléphone : déjà des boutons, avec focus visible ; corbeille masquée à la praticienne", () => {
  assert.match(liste, /focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"\s+onClick=\{\(\) => openPanel\("appointment", apt\.id\)\}/);
  // Renforcement (ruling D5) : ce test passait déjà avant la correction sans rien
  // affirmer sur la corbeille de la carte téléphone ; il échoue désormais tant que
  // la corbeille de la carte n'est pas gardée par commands.remove.
  assert.match(
    liste,
    /\{commands\.remove && !apt\.invoiced && <button\s+type="button"\s+aria-label=\{t\("rdv\.supprimer", \{ ref: apt\.identifier \}\)\}\s+className="[^"]*focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"\s+onClick=\{\(\) => setASupprimer\(apt\)\}/,
    "corbeille de la carte téléphone non gardée par commands.remove",
  );
});
