import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/** Équipe (sous-projet 4 § 6) : liste en cartes, fiche dans le panneau, « Voir son agenda ». */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const liste = read("../staff-list.tsx");
const fiche = read("./fiche-membre.tsx");

test("liste : couleur, nom, fonction dans la langue de l'écran, état ; désactivées en fin de liste et grisées", () => {
  assert.match(liste, /pastille=\{<PastilleEncre color=\{s\.color\} \/>\}/);
  assert.match(liste, /detail=\{pickText\(lang, s\.title, s\.title_en\) \|\| undefined\}/);
  assert.match(liste, /attenue=\{!s\.active\}/);
  assert.match(liste, /\.sort\(\(a, b\) => Number\(b\.active\) - Number\(a\.active\)\)/);
  assert.match(liste, /onOpen=\{\(\) => openPanel\("staff", s\.id\)\}/);
  assert.match(liste, /action=\{commands\.manage \? \{ libelle: t\("equipe\.ajouter"\)/, "« Nouveau membre » pour la gérante seulement");
});

test("fiche : fonction dans les deux langues, couleur, appel ; gestion pour la gérante seulement", () => {
  assert.match(fiche, /t\("equipe\.fonction"\)\}>\{staff\.title \|\| EMPTY\}/);
  assert.match(fiche, /t\("equipe\.fonction_anglais"\)\}>\{staff\.title_en \|\| EMPTY\}/);
  assert.match(fiche, /const call = telHref\(staff\.phone\);/);
  assert.equal(fiche.match(/\{commands\.manage && /g)?.length, 3, "Modifier, Désactiver ou Réactiver, Supprimer");
  assert.match(fiche, /updateStaff\(staff\.id, \{ active: staff\.active \? 0 : 1 \}\)/);
  assert.match(fiche, /onDelete=\{\(\) => deleteStaff\(staff\.id\)\}/);
});

test("« Voir son agenda » : l'agenda du jour, sa colonne montrée d'abord au téléphone ; la demande est consommée", () => {
  assert.match(fiche, /setCalendarDate\(todayAt\(\)\);\s*setAgendaStaffId\(staff\.id\);\s*navigate\(pathFor\("calendar", lang\)\);/);
  const agenda = read("../calendar-view.tsx");
  assert.match(agenda, /useState<string \| null>\(\(\) => \(agendaStaffId !== null \? `s-\$\{agendaStaffId\}` : null\)\)/);
  assert.match(agenda, /useEffect\(\(\) => \{ if \(agendaStaffId !== null\) setAgendaStaffId\(null\); \}, \[\]\);/);
});

test("fiche tirée de la liste chargée : introuvable dite (supprimée ailleurs, lien ancien), chargement tant que la liste arrive", () => {
  const app = read("../../app.tsx");
  assert.match(app, /found \? \{ kind: "fiche" \} : appState\.loading \? \{ kind: "chargement" \} : \{ kind: "erreur", message: t\("fiche\.introuvable"\) \}/);
  assert.match(app, /const staff = appState\.staffMembers\.find\(\(s\) => s\.id === itemId\);/);
});

test("membre dont le compteur de rendez-vous n'est pas nul : pas de « Supprimer » proposé pour être refusé, l'explication à la place", () => {
  assert.match(fiche, /bloquee=\{\(staff\.appointment_count \?\? 0\) > 0 \? t\("equipe\.suppression_impossible"\) : null\}/);
});

test("libellés anglais de la fonction : « Job title » (pas « Role »), le français reste inchangé", () => {
  const fr = read("../../i18n/fr.ts");
  const en = read("../../i18n/en.ts");
  assert.match(fr, /"equipe\.fonction": "Fonction",/);
  assert.match(fr, /"equipe\.fonction_anglais": "Fonction en anglais",/);
  assert.match(en, /"equipe\.fonction": "Job title",/);
  assert.match(en, /"equipe\.fonction_anglais": "Job title in English",/);
});

test("relecture finale : deleteStaff ferme le panneau tout de suite après la suppression, avant que la liste se recharge (plus de « fiche introuvable » furtif)", () => {
  const hook = read("../../hooks/use-app.ts");
  assert.match(hook, /const deleteStaff = useCallback\(async \(id: number\) => \{\s*await api\("DELETE", `\/api\/staff\/\$\{id\}`\);[\s\S]*?closePanel\(\);\s*await fetchStaff\(\);\s*await Promise\.all\(\[fetchStats\(\), fetchLookups\(\)\]\);\s*\}, \[closePanel, fetchStaff, fetchStats, fetchLookups\]\);/);
});
