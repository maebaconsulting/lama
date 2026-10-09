import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createFirstPassSkip, type StartupKey } from "./demarrage.ts";
import { shareRequests } from "./partage.ts";

const DEPENDENT: StartupKey[] = ["appointments", "calendar", "clients", "products"];

test("garde du premier passage : vraie une seule fois par clé", () => {
  const skip = createFirstPassSkip();
  assert.equal(skip("appointments"), true);
  assert.equal(skip("appointments"), false);
  assert.equal(skip("calendar"), true, "chaque clé a son premier passage");
  assert.equal(skip("calendar"), false);
  assert.equal(createFirstPassSkip()("appointments"), true, "une nouvelle garde repart de zéro (nouveau montage)");
});

test("use-app.ts : les quatre effets dépendants ignorent leur premier passage", () => {
  const source = readFileSync(new URL("../hooks/use-app.ts", import.meta.url), "utf8");
  assert.match(source, /const skipFirst = useState\(\(\) => createFirstPassSkip\(\)\)\[0\];/);
  for (const key of DEPENDENT) {
    assert.match(source, new RegExp(`if \\(!activity \\|\\| skipFirst\\("${key}"\\)\\) return;`), key);
  }
  // Le chargement initial garde tout, pour que `loading` couvre aussi ces quatre listes.
  assert.match(source, /fetchAppointments\(appointmentsPag, "", ""\),\s*fetchCalendar\(calendarDate, true\),\s*fetchClients\(clientsPag, "", tagQuery\),/);
  assert.match(source, /fetchProducts\(productsPag, ""\),/);
});

/**
 * V1-73, deuxième appel du jour : le chargement initial de `useAppState` et
 * l'accueil « Aujourd'hui » (useCalendarRange) demandaient chacun
 * `/api/calendar?start=<jour>&end=<jour>`. Ils passent maintenant par le même
 * partage : une seule requête, que l'accueil demande avant (effet enfant, en
 * vol) ou après (monté à la fin du chargement, réponse récente reprise).
 */
test("démarrage : le jour demandé par useAppState et par l'accueil ne part qu'une fois au serveur", async () => {
  const url = "/api/calendar?start=2026-10-05&end=2026-10-05";
  for (const order of ["accueil d'abord", "useAppState d'abord, accueil monté après la réponse"] as const) {
    let calls = 0;
    let clock = 0;
    const get = shareRequests(async (u: string) => { calls++; return u; }, 5_000, () => clock);
    if (order === "accueil d'abord") {
      await Promise.all([get(url, true), get(url, true)]);
    } else {
      await get(url, true);
      clock += 300;
      await get(url, true);
    }
    assert.equal(calls, 1, order);
    // Plus tard, un changement de jour ou un signal repart au serveur.
    await get(url, false);
    assert.equal(calls, 2, `${order} : rechargement frais`);
  }
  const app = readFileSync(new URL("../hooks/use-app.ts", import.meta.url), "utf8");
  const journee = readFileSync(new URL("../hooks/use-journee.ts", import.meta.url), "utf8");
  assert.match(app, /import \{ getCalendar \} from "\.\/use-journee";/);
  assert.match(app, /const url = `\/api\/calendar\?start=\$\{date\}&end=\$\{date\}`;/);
  assert.match(app, /atStartup \? await getCalendar\(url, true\) : await api</);
  assert.match(journee, /getCalendar\(`\/api\/calendar\?start=\$\{start\}&end=\$\{end\}`, reuseRecent\)/, "même adresse, même partage");
});
