import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Crochets partagés de l'accueil (sous-projet 4 § 5) et du « + » : heure de
 * Douala et rendez-vous d'une période, indépendants du jour de l'agenda.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const hook = read("./use-journee.ts");

test("horloge : jour et heure de Douala relus à chaque minute pleine, jamais ceux de l'appareil", () => {
  assert.match(hook, /useState\(\(\) => \(\{ day: todayAt\(\), time: timeAt\(\) \}\)\)/);
  // Alignée sur hh:mm:00 (msToNextMinute, testée en exécution dans lib/cadre.test.ts), pas 60 s après l'ouverture.
  assert.match(hook, /const tick = \(\) => \{ setClock\(\{ day: todayAt\(\), time: timeAt\(\) \}\); timer = setTimeout\(tick, msToNextMinute\(Date\.now\(\)\)\); \};/);
  assert.match(hook, /return \(\) => clearTimeout\(timer\);/);
  assert.doesNotMatch(hook, /setInterval/);
  assert.doesNotMatch(hook, /new Date\(\)|today\(\)/, "pas de jour de l'appareil (lib/dates.ts)");
});

test("période : /api/calendar, rechargée par les signaux de l'agenda, seule la dernière réponse compte", () => {
  // Une seule requête quand le « + » et « Ma journée » demandent le même jour coup sur coup (lib/partage.ts) :
  // réponse récente reprise à l'ouverture seulement, rechargements (signal, Réessayer) toujours au serveur.
  assert.match(hook, /export const getCalendar = shareRequests\(\(url: string\) => api<\{ appointments: Appointment\[\]; blocked_slots: BlockedSlot\[\] \}>\("GET", url\), 5_000\);/);
  assert.match(hook, /getCalendar\(`\/api\/calendar\?start=\$\{start\}&end=\$\{end\}`, reuseRecent\)/);
  assert.match(hook, /load\(true\);\n    const stop = onRefresh\(\(keys\) => \{ if \(keys\.includes\("calendar"\) \|\| keys\.includes\("appointments"\)\) load\(\); \}\);/);
  assert.match(hook, /return \{ \.\.\.state, reload: \(\) => load\(\) \};/, "Réessayer ne reprend jamais une réponse gardée");
  assert.match(hook, /keys\.includes\("calendar"\) \|\| keys\.includes\("appointments"\)/);
  assert.match(hook, /const ticket = \+\+last\.current;/);
  assert.equal(hook.match(/if \(ticket === last\.current\)/g)?.length, 2, "succès et échec ignorés s'ils sont périmés");
  assert.match(hook, /return \(\) => \{ last\.current\+\+; stop\(\); \};/, "réponse arrivée après le démontage ou un changement de période : ignorée");
  // Réseau coupé : la liste reçue avant reste affichée, avec le message.
  assert.match(hook, /setState\(\(s\) => \(\{ \.\.\.s, error: err\.message \}\)\)/);
});

test("le « + » de la praticienne lit son prochain rendez-vous par les mêmes crochets", () => {
  const plus = read("../components/cadre/bouton-plus.tsx");
  assert.match(plus, /import \{ useCalendarRange, useDoualaClock \} from "\.\.\/\.\.\/hooks\/use-journee";/);
  assert.match(plus, /useCalendarRange\(staffId === null \? null : \{ start: clock\.day, end: clock\.day \}\)/);
  assert.doesNotMatch(plus, /setInterval|api</, "plus de chargement propre au « + »");
});
