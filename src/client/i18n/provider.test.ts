import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("la langue enveloppe toute l'app, porte d'entrée comprise (le thème juste dessous, sous-projet 4)", () => {
  assert.match(read("main.tsx"), /<I18nProvider>\s*<ThemeProvider>\s*<Porte>\s*<App \/>\s*<\/Porte>\s*<\/ThemeProvider>\s*<\/I18nProvider>/);
});

test("la bascule ne remonte aucun écran : aucune clé de composant tirée de la langue (Review Focus 1)", () => {
  const offenders = sources(ROOT).filter((f) => /key=\{\s*(lang|t\()/.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test("setLang applique la langue à la page, à l'API et à l'appareil", () => {
  const provider = read("i18n/provider.tsx");
  assert.match(provider, /document\.documentElement\.lang = lang/);
  assert.match(provider, /setApiLang\(lang\)/);
  assert.match(provider, /writeDeviceLang\(next\)/);
});

test("à chaque chargement de l'état de connexion, l'écran prend la langue du compte (spec § 3.1)", () => {
  const hook = read("hooks/use-auth.ts");
  assert.match(hook, /if \(next\.account\) setLang\(normalizeLang\(next\.account\.language\)\)/);
  assert.match(read("lib/auth-types.ts"), /language: Lang/);
});
