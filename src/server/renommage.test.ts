import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { texteDOctets, traces } from "./neutralite-empreintes.ts";

/**
 * Renommage lama (spec du renommage § 3) : plus aucun nom technique de l'ancienne marque dans le code,
 * les scripts du serveur et les fichiers de tête du dépôt (service, compte et dossiers, variables
 * d'environnement, base, sauvegardes, disque, cookies, en-têtes, préférences, bannière de l'assemblage).
 * Repérage par empreintes (`neutralite-empreintes.ts`) : les anciens noms ne s'écrivent ni ne se recomposent ici.
 */
const ROOT = new URL("../../", import.meta.url).pathname;

/** Fichiers texte d'un dossier, récursivement. */
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return walk(path);
    return /\.(ts|tsx|css|svg|sh|mjs|md|json|service|timer|html)$/.test(name) ? [path] : [];
  });
}

const FILES = [...walk("src"), ...walk("deploy"), "index.html", "package.json"];

/** Lignes qui portent un ancien nom, sous la forme `fichier:ligne : traces`. */
function offenders(files: string[]): string[] {
  return files.flatMap((file) =>
    readFileSync(join(ROOT, file), "utf8").split("\n").flatMap((line, i) => (traces(line).length ? [`${file}:${i + 1} : ${traces(line).join(", ")}`] : [])),
  );
}

test("renommage lama : plus aucun ancien nom technique dans le code, les scripts et les fichiers de tête", () => {
  assert.ok(FILES.length > 300, `${FILES.length} fichiers lus`);
  assert.deepEqual(offenders(FILES), []);
});

test("renommage lama : paquet npm « lama », services lama", () => {
  assert.equal(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).name, "lama");
  assert.deepEqual(readdirSync(join(ROOT, "deploy/systemd")).sort(), ["lama-certificat.service", "lama-certificat.timer", "lama-formation.service", "lama-sauvegarde.service", "lama-sauvegarde.timer", "lama.service"]);
});

test("le garde-fou repère les anciens noms techniques (fabriqués à partir d'octets), pas les nouveaux ni les numéros de facture", () => {
  const v = texteDOctets([0x6f, 0x63, 0x70]);
  const u = v.toUpperCase();
  const e = texteDOctets([0x65, 0x6d, 0x70, 0x69, 0x72, 0x65]);
  const anciens = [`/opt/${v}-${e}`, `${u}_DATA_DIR`, `${v}.db.restauration`, `${v}-20260928-0200.db.gz.age`, `/mnt/${v}-sauvegarde`, `${u}-SAUVEGARDE`, `${v}_session`, `${v}_poste`, `X-${u}`, `"${v}.langue"`, `${v}CreateRequire`, `${v}-tests-`];
  for (const ancien of anciens) assert.ok(traces(ancien).length > 0, ancien);
  const permis = ["/opt/lama", "LAMA_DATA_DIR", "lama.db", "lama-20260928-0200.db.gz.age", "lama_session", "X-Lama", "FAC-2026-000123", "lamaCreateRequire", "toCp858Text"];
  for (const nom of permis) assert.deepEqual(traces(nom), [], nom);
});
