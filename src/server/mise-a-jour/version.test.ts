import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { runMigrations } from "../migrations.ts";
import { ecrireBase, lireBase } from "./base.ts";
import { lireVersionInstallee, plusRecente, VERSION_DEVELOPPEMENT, VERSION_PUBLIEE } from "./version.ts";

/** Version installée et ordre des versions (spec du 21/10/2026, M-1, M-2), état de la rubrique en base (M-12). */

const VERIFICATION = new URL("../../../deploy/verification.sh", import.meta.url).pathname;

/** Chaque cas est aussi posé à deploy/verification.sh : lama et le service root rangent les versions de la même façon. */
const CAS: [string, string, boolean][] = [
  ["1.10.0", "1.9.3", true], ["1.9.3", "1.10.0", false], ["2.0.0", "1.99.99", true], ["1.0.1", "1.0.0", true],
  ["1.0.0", "1.0.0", false], ["20261021-1030-abc", "1.0.0", false], ["1.0.0", "20261021-1030-abc", false], ["1.0.0-essai", "0.9.0", false],
];

test("ordre des versions : le même dans lama et dans le service root (M-1)", () => {
  for (const [a, b, attendu] of CAS) {
    assert.equal(plusRecente(a, b), attendu, `${a} > ${b}`);
    const shell = spawnSync("bash", ["-c", `source '${VERIFICATION}'; plus_recente "$1" "$2"`, "essai", a, b]).status === 0;
    assert.equal(shell, attendu, `shell : ${a} > ${b}`);
  }
  for (const v of ["0.0.1", "1.10.0", "9999.9999.9999"]) assert.ok(VERSION_PUBLIEE.test(v), v);
  for (const v of ["01.0.0", "1.0", "1.0.0-essai", "10000.0.0", "1.0.0\n"]) assert.ok(!VERSION_PUBLIEE.test(v), JSON.stringify(v));
  assert.ok(VERSION_DEVELOPPEMENT.test("20261021-1030-abc123"));
});

test("version installée : VERSION à la racine de la version et date du dossier ; sinon package.json, en développement (M-2)", () => {
  const publiee = mkdtempSync(join(tmpdir(), "lama-version-"));
  writeFileSync(join(publiee, "VERSION"), "1.2.0\n");
  const quand = new Date("2026-10-01T10:00:00Z");
  utimesSync(publiee, quand, quand);
  assert.deepEqual(lireVersionInstallee(publiee), { numero: "1.2.0", developpement: false, installee_le: quand.getTime() });
  const dev = mkdtempSync(join(tmpdir(), "lama-version-dev-"));
  writeFileSync(join(dev, "VERSION"), "20261021-1030-abc123\n");
  assert.deepEqual({ ...lireVersionInstallee(dev), installee_le: 0 }, { numero: "20261021-1030-abc123", developpement: true, installee_le: 0 });
  const depot = mkdtempSync(join(tmpdir(), "lama-version-depot-"));
  writeFileSync(join(depot, "package.json"), JSON.stringify({ version: "1.0.0" }));
  assert.deepEqual(lireVersionInstallee(depot), { numero: "1.0.0", developpement: true, installee_le: null });
  writeFileSync(join(depot, "VERSION"), "../../etc/passwd\n");
  assert.deepEqual(lireVersionInstallee(depot), { numero: "1.0.0", developpement: true, installee_le: null }, "VERSION hors format : comme le développement");
  assert.deepEqual(lireVersionInstallee(join(depot, "absent")), { numero: "0.0.0", developpement: true, installee_le: null });
});

test("migration 025 : une seule ligne d'état de la rubrique, écrite champ par champ (M-12, M-15)", () => {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  assert.deepEqual({ ...lireBase(db) }, { verifie_le: null, version: null, publiee_le: null, note_fr: null, note_en: null, erreur: null, operation_journalisee: null });
  ecrireBase(db, { version: "1.2.0", verifie_le: 5 });
  ecrireBase(db, { erreur: "@mise_a_jour.injoignable" });
  assert.deepEqual({ ...lireBase(db) }, { verifie_le: 5, version: "1.2.0", publiee_le: null, note_fr: null, note_en: null, erreur: "@mise_a_jour.injoignable", operation_journalisee: null });
  assert.throws(() => db.exec("INSERT INTO mise_a_jour_etat (id) VALUES (2)"));
});
