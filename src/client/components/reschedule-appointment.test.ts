import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("l'erreur du déplacement de rendez-vous passe par <Erreur>, masquée après une bascule de langue (M4, relecture finale)", () => {
  const text = read("./reschedule-appointment.tsx");
  assert.match(text, /import \{ Erreur(, useAmenerALaVue)? \} from "\.\/champ"/, "import de Erreur introuvable");
  assert.match(text, /<Erreur message=\{error\} \/>/, "l'erreur doit passer par le composant Erreur");
  assert.doesNotMatch(text, /\{error && <p role="alert"/, "l'erreur ne doit plus être affichée directement");
});

test("Déplacer : date, heure et praticienne (§ 4.3), seuls les champs changés partent", () => {
  const text = read("./reschedule-appointment.tsx");
  assert.match(text, /<select id="reschedule-staff" className=\{SELECT\}/);
  assert.match(text, /const patch = reschedulePatch\(appointment, \{ date, time: startTime, staffId: staffId \? Number\(staffId\) : null \}\);/);
  assert.match(text, /\.\.\.patch,/);
  assert.match(text, /qui: chosenName \|\| t\("conflit\.ce_membre"\)/, "conflit : le nom de la praticienne choisie");
});

test("Nouveau rendez-vous pré-rempli depuis un créneau de l'agenda : praticienne et heure (§ 4.1)", () => {
  const text = read("./create-appointment.tsx");
  // Relecture finale (point 1) : jamais une praticienne absente de la liste « Membre ».
  assert.match(text, /useState\(\(\) => offeredStaffId\(defaultStaffId, staffLookup\)\)/);
  assert.doesNotMatch(text, /String\(defaultStaffId\)/);
  assert.match(text, /useState\(defaultTime \|\| "09:00"\)/);
  assert.match(text, /useState\(defaultDate \|\| todayAt\(\)\)/, "jour de l'institut (Douala) par défaut");
});

test("Déplacer vers une autre praticienne : case « Prévenir la cliente », cochée par défaut, envoyée seulement quand elle est proposée", () => {
  const text = read("./reschedule-appointment.tsx");
  assert.match(text, /const \[notify, setNotify\] = useState\(true\);/);
  assert.match(text, /const notice = offersTransferNotice\(appointment\.staff_id, staffId \? Number\(staffId\) : null\);/);
  assert.match(text, /\.\.\.\(notice \? \{ notify_transfer: notify \} : \{\}\),/);
  assert.match(text, /\{notice && \(\s*<div className="col-span-2 min-w-0">\s*<Case id="reschedule-notify" label=\{t\("rdv\.prevenir_cliente"\)\}/);
});

test("autre praticienne choisie : « Prévenir la cliente » recochée à chaque changement du menu", () => {
  const text = read("./reschedule-appointment.tsx");
  assert.match(text, /setStaffId\(\(e\.target as HTMLSelectElement\)\.value\); setNotify\(true\); clearFeedback\(\);/);
});
