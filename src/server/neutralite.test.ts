import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { EMPREINTE_NOM, EMPREINTE_SIGLE, empreinte, texteDOctets, traces } from "./neutralite-empreintes.ts";

/**
 * Distribution D-03 et D-04 : plus aucune trace de l'ancienne marque dans les fichiers suivis du dépôt.
 * Le repérage compare des empreintes (`neutralite-empreintes.ts`) : ni le sigle ni le nom ne s'écrivent
 * ni ne se recomposent ici, pour que ce garde-fou ne se dénonce pas lui-même.
 */
const ROOT = new URL("../../", import.meta.url).pathname;

/**
 * Seuls endroits permis (dans le dépôt local ; l'export public n'en a aucun, démo publique DP-12) :
 * - le dossier des spécifications et plans internes, hors du dépôt public (vague 5, D-33) ;
 * - docs/brand : ancienne charte, retirée de l'arbre public en vague 5 (D-04) ; plus rien ne la lit ;
 * - pnpm-lock.yaml : empreintes en base 64, où trois lettres peuvent tomber par hasard.
 */
const PERMIS = [/^docs\/superpowers\//, /^docs\/brand\//, /^pnpm-lock\.yaml$/];

/** Fichiers suivis par git, chemins relatifs à la racine. */
function tracked(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}

/** Lignes fautives d'un fichier texte (un fichier binaire, qui contient un octet nul, est ignoré). */
function offenders(file: string): string[] {
  const bytes = readFileSync(join(ROOT, file));
  if (bytes.includes(0)) return [];
  return bytes.toString("utf8").split("\n").flatMap((line, i) => (traces(line).length ? [`${file}:${i + 1} : ${traces(line).join(", ")}`] : []));
}

test("aucun fichier suivi ne porte l'ancienne marque, hors des documents internes et de l'ancienne charte (D-03, démo publique DP-12)", () => {
  const files = tracked().filter((f) => !PERMIS.some((p) => p.test(f)));
  assert.ok(files.length > 300, `${files.length} fichiers lus`);
  assert.deepEqual(files.flatMap(offenders), []);
});

test("ni l'application, ni la démonstration, ni le paquet ne lisent docs/brand (D-04 ; le dossier quitte l'arbre public en vague 5)", () => {
  // Code livré seulement : les essais citent docs/brand pour vérifier justement qu'on ne le lit plus.
  const code = tracked().filter((f) => (/^(src|deploy)\//.test(f) && !f.endsWith(".test.ts")) || ["index.html", "package.json", "vite.config.ts"].includes(f));
  const lecteurs = code.filter((f) => /docs\/brand|["']docs["'],\s*["']brand["']/.test(readFileSync(join(ROOT, f), "utf8")));
  assert.deepEqual(lecteurs, []);
});

/** Sigle (minuscules, capitales) et second mot du nom, fabriqués à l'exécution à partir d'octets. */
const s = texteDOctets([0x6f, 0x63, 0x70]);
const S = s.toUpperCase();
const e = texteDOctets([0x65, 0x6d, 0x70, 0x69, 0x72, 0x65]);
const E = e.charAt(0).toUpperCase() + e.slice(1);

test("les empreintes sont bien celles du sigle et du nom fabriqués à partir d'octets", () => {
  assert.equal(empreinte(S), EMPREINTE_SIGLE);
  assert.equal(empreinte(`${s}${e}`), EMPREINTE_NOM);
});

test("le garde-fou repère le sigle et le nom, toute casse, pas les mots qui les contiennent par hasard", () => {
  const sigles = [`${S}-2026-000001`, `'${S}'`, `"${S}"`, `"${s}"`, `d'${S}`, `X-${S}`, `${S}_DATA_DIR`, `${S}2026`, `/opt/${s}/donnees`];
  for (const faute of sigles) assert.ok(traces(faute).includes("sigle"), faute);
  const noms = [`${S} ${E}`, `${s}-${e}`, `${S}_${e.toUpperCase()}`, `${S}${E}`, `${s}${e}`, `Fait pour ${s.charAt(0).toUpperCase()}${s.slice(1)} ${E}.`];
  for (const faute of noms) assert.ok(traces(faute).includes("nom"), faute);
  for (const permis of ["FAC-2026-000001", "toCp858Text", "DEMO-2026-000001", "Institut Démo", "Maison Démo", `${E} State`, `x${S}y`, `${S}abc`]) {
    assert.deepEqual(traces(permis), [], permis);
  }
});
