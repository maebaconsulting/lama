import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { attemptThemeChange, createThemeChanger } from "./lib/theme-change.ts";

/** Sous-projet 4 § 3.2 : thème par compte, suivi de l'appareil, aucun éclair au chargement. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("aucun éclair du mauvais thème : le thème de l'appareil est posé avant le premier rendu", () => {
  const main = read("./main.tsx");
  const posed = main.indexOf("applyTheme(readDeviceTheme());");
  assert.ok(posed > 0, "applyTheme(readDeviceTheme()) absent de main.tsx");
  assert.ok(posed < main.indexOf("render("), "le thème doit être posé avant render()");
  assert.match(main, /<I18nProvider><ThemeProvider><Porte><App \/><\/Porte><\/ThemeProvider><\/I18nProvider>/);
  // Avant même l'exécution du module, un appareil en sombre n'affiche pas de fond blanc.
  assert.match(read("./styles.css"), /@media \(prefers-color-scheme: dark\) \{\s*html:not\(\[data-theme\]\) \{[^}]*background-color: #161514;/);
});

test("« Comme l'appareil » suit les changements de l'appareil en direct, et s'arrête pour un choix fixe", () => {
  const provider = read("./theme-provider.tsx");
  assert.match(provider, /matchMedia\(DARK_QUERY\)/);
  assert.match(provider, /media\.addEventListener\("change", follow\)/);
  assert.match(provider, /return \(\) => media\.removeEventListener\("change", follow\)/);
  assert.match(provider, /if \(pref !== "system"/);
  assert.match(provider, /document\.documentElement\.dataset\.theme = theme/);
});

test("le thème du compte s'applique dès le chargement de l'état de connexion et l'appareil le retient", () => {
  const hook = read("./hooks/use-auth.ts");
  assert.match(hook, /if \(next\.account\) setPref\(normalizeTheme\(next\.account\.theme\)\)/);
  assert.match(read("./theme-provider.tsx"), /writeDeviceTheme\(next\)/);
});

test("changer son thème : câblé sur attemptThemeChange (logique testée en exécution ci-dessous), Mon compte affiche le choix", () => {
  const choix = read("./components/choix-theme.tsx");
  assert.match(choix, /attemptThemeChange\(\s*pref,\s*next,/);
  assert.match(choix, /\(chosen\) => api\("PUT", "\/api\/auth\/me\/theme", \{ theme: chosen \}\)/);
  assert.match(choix, /setPref,\s*\(\) => onError\(t\("theme\.echec"\)\)/);
  assert.match(read("./components/reglages/mon-compte.tsx"), /<Theme \/>/);
});

/**
 * Décision D4 du contrôleur (hors fiche, point 3 des contraintes de relecture) :
 * le retour à l'ancien choix quand l'enregistrement échoue, et l'appel de
 * l'erreur, sont vérifiés en exécution plutôt que par relecture de la
 * source. `attemptThemeChange` (src/client/lib/theme-change.ts) est la
 * fonction extraite pour cela.
 */
test("attemptThemeChange : un échec de l'enregistrement rétablit l'ancien choix et appelle l'erreur une fois", async () => {
  const applied: string[] = [];
  let errors = 0;
  let saved = 0;
  await new Promise<void>((resolve) => {
    attemptThemeChange(
      "light",
      "dark",
      () => Promise.reject(new Error("hors ligne")),
      (pref) => applied.push(pref),
      () => { errors++; resolve(); },
      () => { saved++; },
    );
  });
  assert.deepEqual(applied, ["dark", "light"]);
  assert.equal(errors, 1);
  assert.equal(saved, 0);
});

test("attemptThemeChange : un succès garde le nouveau choix et n'appelle pas l'erreur", async () => {
  const applied: string[] = [];
  let errors = 0;
  let saved = 0;
  await new Promise<void>((resolve) => {
    attemptThemeChange(
      "light",
      "dark",
      () => Promise.resolve(),
      (pref) => applied.push(pref),
      () => { errors++; },
      () => { saved++; resolve(); },
    );
  });
  assert.deepEqual(applied, ["dark"]);
  assert.equal(errors, 0);
  assert.equal(saved, 1);
});

test("attemptThemeChange : un choix identique à l'actuel ne déclenche ni application ni enregistrement", () => {
  const applied: string[] = [];
  let called = false;
  attemptThemeChange(
    "light",
    "light",
    () => { called = true; return Promise.resolve(); },
    (pref) => applied.push(pref),
    () => {},
  );
  assert.deepEqual(applied, []);
  assert.equal(called, false);
});

/** Promesse que le test résout ou rejette quand il veut (réponse du serveur simulée). */
function later() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test("deux changements rapides, échec tardif du premier : le thème enregistré (le second) gagne, aucune erreur", async () => {
  const change = createThemeChanger();
  const applied: string[] = [];
  let errors = 0;
  const first = later();
  const second = later();
  change("light", "dark", () => first.promise, (p) => applied.push(p), () => errors++);
  change("dark", "system", () => second.promise, (p) => applied.push(p), () => errors++);
  second.resolve();
  await settle();
  first.reject(new Error("hors ligne"));
  await settle();
  assert.deepEqual(applied, ["dark", "system"]);
  assert.equal(errors, 0);
});

test("deux changements rapides, échec du second : retour au dernier thème accepté par le serveur, une erreur", async () => {
  const change = createThemeChanger();
  const applied: string[] = [];
  let errors = 0;
  const first = later();
  const second = later();
  change("light", "dark", () => first.promise, (p) => applied.push(p), () => errors++);
  change("dark", "system", () => second.promise, (p) => applied.push(p), () => errors++);
  first.resolve();
  await settle();
  second.reject(new Error("hors ligne"));
  await settle();
  assert.deepEqual(applied, ["dark", "system", "dark"], "sombre, enregistré, revient");
  assert.equal(errors, 1);
});

test("deux changements rapides, les deux échouent : retour au thème d'avant, une seule erreur", async () => {
  const change = createThemeChanger();
  const applied: string[] = [];
  let errors = 0;
  const first = later();
  const second = later();
  change("light", "dark", () => first.promise, (p) => applied.push(p), () => errors++);
  change("dark", "system", () => second.promise, (p) => applied.push(p), () => errors++);
  first.reject(new Error("hors ligne"));
  await settle();
  second.reject(new Error("hors ligne"));
  await settle();
  assert.deepEqual(applied, ["dark", "system", "light"]);
  assert.equal(errors, 1);
});
